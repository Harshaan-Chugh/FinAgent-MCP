import { z } from 'zod';
import axios from 'axios';
import { MCPTool } from '../../core/registry';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const inputSchema = z.object({
  symbols: z.array(z.string()).optional(),
  includeZeroBalances: z.boolean().optional().default(false),
  sortBy: z.enum(['value', 'quantity', 'symbol', 'pnl', 'pnl_percent']).optional().default('value'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  includePriceData: z.boolean().optional().default(true),
});

type GetCryptoPositionsInput = z.infer<typeof inputSchema>;

interface CryptoPositionWithCalculations {
  id: string;
  symbol: string;
  name?: string;
  quantity: number;
  average_price?: number;
  market_value?: number;
  cost_basis?: number;
  unrealized_pnl?: number;
  unrealized_pnl_percent?: number;
  last_price?: number;
  price_change_24h?: number;
  price_change_percent_24h?: number;
  allocation_percent?: number;
  last_refresh: string;
}

export const getCryptoPositionsTool: MCPTool = {
  name: 'get_crypto_positions',
  description: 'Get cryptocurrency positions and portfolio from Robinhood, including current values and performance metrics',
  inputSchema,
  metadata: {
    category: 'crypto',
    requiresAuth: true,
    rateLimit: {
      requests: 10,
      window: 60000, // 1 minute
    },
  },
  handler: async (args: GetCryptoPositionsInput, context: { userId: string }) => {
    try {
      logger.info('Fetching crypto positions', { 
        userId: context.userId,
        filters: {
          symbols: args.symbols,
          includeZeroBalances: args.includeZeroBalances,
        }
      });

      // Call Go ingestion service
      const url = new URL('/rh/positions', config.goServiceUrl);
      url.searchParams.set('user_id', context.userId);

      const response = await axios.get(url.toString(), {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = response.data;
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch crypto positions');
      }

      let positions: CryptoPositionWithCalculations[] = result.data.positions || [];

      // Filter by symbols if specified
      if (args.symbols && args.symbols.length > 0) {
        positions = positions.filter(position => 
          args.symbols!.includes(position.symbol)
        );
      }

      // Filter out zero balances unless explicitly requested
      if (!args.includeZeroBalances) {
        positions = positions.filter(position => 
          position.quantity > 0
        );
      }

      // Calculate additional metrics
      const totalPortfolioValue = positions.reduce((sum, position) => 
        sum + (position.market_value || 0), 0
      );

      positions = positions.map(position => {
        const calculatedPosition = { ...position };
        
        // Calculate allocation percentage
        if (totalPortfolioValue > 0 && position.market_value) {
          calculatedPosition.allocation_percent = 
            (position.market_value / totalPortfolioValue) * 100;
        }

        // Calculate unrealized P&L if not already present
        if (!calculatedPosition.unrealized_pnl && calculatedPosition.cost_basis && calculatedPosition.market_value) {
          calculatedPosition.unrealized_pnl = calculatedPosition.market_value - calculatedPosition.cost_basis;
        }

        // Calculate unrealized P&L percentage if not already present
        if (!calculatedPosition.unrealized_pnl_percent && calculatedPosition.cost_basis && calculatedPosition.unrealized_pnl) {
          calculatedPosition.unrealized_pnl_percent = 
            (calculatedPosition.unrealized_pnl / calculatedPosition.cost_basis) * 100;
        }

        // Round monetary values
        if (calculatedPosition.average_price) {
          calculatedPosition.average_price = Math.round(calculatedPosition.average_price * 100) / 100;
        }
        if (calculatedPosition.market_value) {
          calculatedPosition.market_value = Math.round(calculatedPosition.market_value * 100) / 100;
        }
        if (calculatedPosition.cost_basis) {
          calculatedPosition.cost_basis = Math.round(calculatedPosition.cost_basis * 100) / 100;
        }
        if (calculatedPosition.unrealized_pnl) {
          calculatedPosition.unrealized_pnl = Math.round(calculatedPosition.unrealized_pnl * 100) / 100;
        }
        if (calculatedPosition.unrealized_pnl_percent) {
          calculatedPosition.unrealized_pnl_percent = Math.round(calculatedPosition.unrealized_pnl_percent * 100) / 100;
        }
        if (calculatedPosition.allocation_percent) {
          calculatedPosition.allocation_percent = Math.round(calculatedPosition.allocation_percent * 100) / 100;
        }
        if (calculatedPosition.last_price) {
          calculatedPosition.last_price = Math.round(calculatedPosition.last_price * 100) / 100;
        }
        if (calculatedPosition.price_change_24h) {
          calculatedPosition.price_change_24h = Math.round(calculatedPosition.price_change_24h * 100) / 100;
        }
        if (calculatedPosition.price_change_percent_24h) {
          calculatedPosition.price_change_percent_24h = Math.round(calculatedPosition.price_change_percent_24h * 100) / 100;
        }

        return calculatedPosition;
      });

      // Sort positions
      positions.sort((a, b) => {
        let aValue: number, bValue: number;
        
        switch (args.sortBy) {
          case 'value':
            aValue = a.market_value || 0;
            bValue = b.market_value || 0;
            break;
          case 'quantity':
            aValue = a.quantity;
            bValue = b.quantity;
            break;
          case 'symbol':
            aValue = a.symbol.localeCompare(b.symbol);
            bValue = 0;
            break;
          case 'pnl':
            aValue = a.unrealized_pnl || 0;
            bValue = b.unrealized_pnl || 0;
            break;
          case 'pnl_percent':
            aValue = a.unrealized_pnl_percent || 0;
            bValue = b.unrealized_pnl_percent || 0;
            break;
          default:
            aValue = a.market_value || 0;
            bValue = b.market_value || 0;
        }
        
        return args.sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
      });

      // Remove price data if not requested
      if (!args.includePriceData) {
        positions = positions.map(position => ({
          ...position,
          last_price: undefined,
          price_change_24h: undefined,
          price_change_percent_24h: undefined,
        }));
      }

      // Calculate portfolio summary
      const totalCostBasis = positions.reduce((sum, position) => 
        sum + (position.cost_basis || 0), 0
      );
      
      const totalUnrealizedPnL = positions.reduce((sum, position) => 
        sum + (position.unrealized_pnl || 0), 0
      );

      const portfolioReturn = totalCostBasis > 0 
        ? (totalUnrealizedPnL / totalCostBasis) * 100 
        : 0;

      // Top and bottom performers
      const sortedByPnLPercent = [...positions].sort((a, b) => 
        (b.unrealized_pnl_percent || 0) - (a.unrealized_pnl_percent || 0)
      );

      const topPerformers = sortedByPnLPercent.slice(0, 3).filter(p => (p.unrealized_pnl_percent || 0) > 0);
      const bottomPerformers = sortedByPnLPercent.slice(-3).reverse().filter(p => (p.unrealized_pnl_percent || 0) < 0);

      // Build evidence
      const evidence = positions.map(position => ({
        table: 'crypto_positions',
        id: position.id,
        fields: ['id', 'symbol', 'quantity', 'market_value', 'unrealized_pnl'],
      }));

      return {
        data: {
          positions,
          summary: {
            totalValue: Math.round(totalPortfolioValue * 100) / 100,
            totalCostBasis: Math.round(totalCostBasis * 100) / 100,
            totalUnrealizedPnL: Math.round(totalUnrealizedPnL * 100) / 100,
            portfolioReturn: Math.round(portfolioReturn * 100) / 100,
            positionCount: positions.length,
            topPerformers,
            bottomPerformers,
          },
        },
        meta: {
          count: positions.length,
          totalValue: Math.round(totalPortfolioValue * 100) / 100,
          filters: {
            symbols: args.symbols,
            includeZeroBalances: args.includeZeroBalances,
          },
          sorting: {
            sortBy: args.sortBy,
            sortOrder: args.sortOrder,
          },
          options: {
            includePriceData: args.includePriceData,
          },
          source: 'go-ingestion-service',
          timestamp: new Date().toISOString(),
        },
        evidence,
      };
    } catch (error: any) {
      logger.error('Failed to get crypto positions', {
        userId: context.userId,
        error: error.message,
        args,
      });
      throw error;
    }
  },
};