import { z } from 'zod';
import axios from 'axios';
import { MCPTool } from '../../core/registry';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const inputSchema = z.object({
  accountIds: z.array(z.string()).optional(),
  securityTypes: z.array(z.enum(['equity', 'bond', 'etf', 'mutual_fund', 'cash_equivalent', 'derivative'])).optional(),
  includeClosedPositions: z.boolean().optional().default(false),
  sortBy: z.enum(['value', 'quantity', 'symbol', 'unrealized_pnl']).optional().default('value'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

type GetHoldingsInput = z.infer<typeof inputSchema>;

interface HoldingWithCalculations {
  id: string;
  account_id: string;
  symbol?: string;
  security_name: string;
  quantity: number;
  institution_price?: number;
  institution_value?: number;
  cost_basis?: number;
  unrealized_pnl?: number;
  unrealized_pnl_percent?: number;
  account_name: string;
  account_mask?: string;
  currency: string;
  last_refresh: string;
}

export const getHoldingsTool: MCPTool = {
  name: 'get_holdings',
  description: 'Get investment holdings and positions, including stocks, bonds, ETFs, and mutual funds with performance metrics',
  inputSchema,
  metadata: {
    category: 'investments',
    requiresAuth: true,
    rateLimit: {
      requests: 10,
      window: 60000, // 1 minute
    },
  },
  handler: async (args: GetHoldingsInput, context: { userId: string }) => {
    try {
      logger.info('Fetching investment holdings', { 
        userId: context.userId,
        filters: {
          accountIds: args.accountIds,
          securityTypes: args.securityTypes,
          includeClosedPositions: args.includeClosedPositions,
        }
      });

      // Call Go ingestion service
      const url = new URL('/read/holdings', config.goServiceUrl);
      url.searchParams.set('user_id', context.userId);

      const response = await axios.get(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });


      const result = await response.data as any;
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch holdings');
      }

      let holdings: HoldingWithCalculations[] = result.data.holdings || [];

      // Filter by account IDs if specified
      if (args.accountIds && args.accountIds.length > 0) {
        holdings = holdings.filter(holding => 
          args.accountIds!.includes(holding.account_id)
        );
      }

      // Filter out closed positions unless explicitly requested
      if (!args.includeClosedPositions) {
        holdings = holdings.filter(holding => 
          holding.quantity > 0
        );
      }

      // Calculate additional metrics
      holdings = holdings.map(holding => {
        const calculatedHolding = { ...holding };
        
        // Calculate unrealized P&L if we have both cost basis and current value
        if (holding.cost_basis && holding.institution_value) {
          calculatedHolding.unrealized_pnl = holding.institution_value - holding.cost_basis;
          calculatedHolding.unrealized_pnl_percent = 
            (calculatedHolding.unrealized_pnl / holding.cost_basis) * 100;
        }

        // Round monetary values
        if (calculatedHolding.institution_value) {
          calculatedHolding.institution_value = Math.round(calculatedHolding.institution_value * 100) / 100;
        }
        if (calculatedHolding.cost_basis) {
          calculatedHolding.cost_basis = Math.round(calculatedHolding.cost_basis * 100) / 100;
        }
        if (calculatedHolding.unrealized_pnl) {
          calculatedHolding.unrealized_pnl = Math.round(calculatedHolding.unrealized_pnl * 100) / 100;
        }
        if (calculatedHolding.unrealized_pnl_percent) {
          calculatedHolding.unrealized_pnl_percent = Math.round(calculatedHolding.unrealized_pnl_percent * 100) / 100;
        }

        return calculatedHolding;
      });

      // Sort holdings
      holdings.sort((a, b) => {
        let aValue: number, bValue: number;
        
        switch (args.sortBy) {
          case 'value':
            aValue = a.institution_value || 0;
            bValue = b.institution_value || 0;
            break;
          case 'quantity':
            aValue = a.quantity;
            bValue = b.quantity;
            break;
          case 'symbol':
            aValue = (a.symbol || a.security_name).localeCompare(b.symbol || b.security_name);
            bValue = 0;
            break;
          case 'unrealized_pnl':
            aValue = a.unrealized_pnl || 0;
            bValue = b.unrealized_pnl || 0;
            break;
          default:
            aValue = a.institution_value || 0;
            bValue = b.institution_value || 0;
        }
        
        return args.sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
      });

      // Calculate portfolio summary
      const totalValue = holdings.reduce((sum, holding) => 
        sum + (holding.institution_value || 0), 0
      );
      
      const totalCostBasis = holdings.reduce((sum, holding) => 
        sum + (holding.cost_basis || 0), 0
      );
      
      const totalUnrealizedPnL = holdings.reduce((sum, holding) => 
        sum + (holding.unrealized_pnl || 0), 0
      );

      const portfolioReturn = totalCostBasis > 0 
        ? (totalUnrealizedPnL / totalCostBasis) * 100 
        : 0;

      // Group by account for summary
      const accountSummary = holdings.reduce((acc, holding) => {
        const accountKey = holding.account_id;
        if (!acc[accountKey]) {
          acc[accountKey] = {
            account_id: holding.account_id,
            account_name: holding.account_name,
            account_mask: holding.account_mask,
            total_value: 0,
            holding_count: 0,
          };
        }
        
        acc[accountKey].total_value += holding.institution_value || 0;
        acc[accountKey].holding_count++;
        
        return acc;
      }, {} as Record<string, any>);

      // Build evidence
      const evidence = holdings.map(holding => ({
        table: 'holdings',
        id: holding.id,
        fields: ['id', 'symbol', 'security_name', 'quantity', 'institution_value', 'account_id'],
      }));

      return {
        data: {
          holdings,
          summary: {
            totalValue: Math.round(totalValue * 100) / 100,
            totalCostBasis: Math.round(totalCostBasis * 100) / 100,
            totalUnrealizedPnL: Math.round(totalUnrealizedPnL * 100) / 100,
            portfolioReturn: Math.round(portfolioReturn * 100) / 100,
            holdingCount: holdings.length,
            accountSummary: Object.values(accountSummary),
          },
        },
        meta: {
          count: holdings.length,
          filters: {
            accountIds: args.accountIds,
            securityTypes: args.securityTypes,
            includeClosedPositions: args.includeClosedPositions,
          },
          sorting: {
            sortBy: args.sortBy,
            sortOrder: args.sortOrder,
          },
          source: 'go-ingestion-service',
          timestamp: new Date().toISOString(),
        },
        evidence,
      };
    } catch (error: any) {
      logger.error('Failed to get holdings', {
        userId: context.userId,
        error: error.message,
        args,
      });
      throw error;
    }
  },
};