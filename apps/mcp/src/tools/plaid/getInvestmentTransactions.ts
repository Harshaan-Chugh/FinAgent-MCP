import { z } from 'zod';
import axios from 'axios';
import { MCPTool } from '../../core/registry';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const inputSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  accountIds: z.array(z.string()).optional(),
  symbols: z.array(z.string()).optional(),
  transactionTypes: z.array(z.enum([
    'buy', 'sell', 'dividend', 'interest', 'fee', 'tax', 'transfer',
    'deposit', 'withdrawal', 'split', 'spin_off', 'merger'
  ])).optional(),
  limit: z.number().min(1).max(500).optional().default(100),
  includeAccountInfo: z.boolean().optional().default(true),
  includeSecurityInfo: z.boolean().optional().default(true),
});

type GetInvestmentTransactionsInput = z.infer<typeof inputSchema>;

interface InvestmentTransactionWithCalculations {
  id: string;
  account_id: string;
  date: string;
  name: string;
  quantity?: number;
  amount: number;
  price?: number;
  fees?: number;
  net_amount?: number;
  type: string;
  subtype?: string;
  symbol?: string;
  security_name?: string;
  account_name?: string;
  account_mask?: string;
}

export const getInvestmentTransactionsTool: MCPTool = {
  name: 'get_investment_transactions',
  description: 'Get investment transactions including buys, sells, dividends, and other investment activity',
  inputSchema,
  metadata: {
    category: 'investments',
    requiresAuth: true,
    rateLimit: {
      requests: 15,
      window: 60000, // 1 minute
    },
  },
  handler: async (args: GetInvestmentTransactionsInput, context: { userId: string }) => {
    try {
      logger.info('Fetching investment transactions', { 
        userId: context.userId,
        dateRange: `${args.start} to ${args.end}`,
        filters: {
          accountIds: args.accountIds,
          symbols: args.symbols,
          transactionTypes: args.transactionTypes,
          limit: args.limit,
        }
      });

      // Validate date range
      const startDate = new Date(args.start);
      const endDate = new Date(args.end);
      
      if (startDate > endDate) {
        throw new Error('Start date must be before or equal to end date');
      }

      // Check if date range is reasonable (not more than 5 years)
      const daysDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24);
      if (daysDiff > 1825) {
        throw new Error('Date range cannot exceed 5 years');
      }

      // Call Go ingestion service
      const url = new URL('/read/investment-transactions', config.goServiceUrl);
      url.searchParams.set('user_id', context.userId);
      url.searchParams.set('start', args.start);
      url.searchParams.set('end', args.end);
      url.searchParams.set('limit', args.limit.toString());

      const response = await axios.get(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });


      const result = await response.data as any;
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch investment transactions');
      }

      let transactions: InvestmentTransactionWithCalculations[] = 
        result.data.investment_transactions || [];

      // Filter by account IDs if specified
      if (args.accountIds && args.accountIds.length > 0) {
        transactions = transactions.filter(txn => 
          args.accountIds!.includes(txn.account_id)
        );
      }

      // Filter by symbols if specified
      if (args.symbols && args.symbols.length > 0) {
        transactions = transactions.filter(txn => 
          txn.symbol && args.symbols!.includes(txn.symbol)
        );
      }

      // Filter by transaction types if specified
      if (args.transactionTypes && args.transactionTypes.length > 0) {
        transactions = transactions.filter(txn => 
          args.transactionTypes!.includes(txn.type as any)
        );
      }

      // Calculate additional fields and round monetary values
      transactions = transactions.map(txn => {
        const calculatedTxn = { ...txn };
        
        // Calculate net amount (amount - fees)
        if (txn.amount && txn.fees) {
          calculatedTxn.net_amount = txn.amount - txn.fees;
        } else {
          calculatedTxn.net_amount = txn.amount;
        }

        // Round monetary values
        if (calculatedTxn.amount) {
          calculatedTxn.amount = Math.round(calculatedTxn.amount * 100) / 100;
        }
        if (calculatedTxn.price) {
          calculatedTxn.price = Math.round(calculatedTxn.price * 100) / 100;
        }
        if (calculatedTxn.fees) {
          calculatedTxn.fees = Math.round(calculatedTxn.fees * 100) / 100;
        }
        if (calculatedTxn.net_amount) {
          calculatedTxn.net_amount = Math.round(calculatedTxn.net_amount * 100) / 100;
        }

        return calculatedTxn;
      });

      // Remove account/security info if not requested
      if (!args.includeAccountInfo) {
        transactions = transactions.map(txn => ({
          ...txn,
          account_name: undefined,
          account_mask: undefined,
        }));
      }

      if (!args.includeSecurityInfo) {
        transactions = transactions.map(txn => ({
          ...txn,
          symbol: undefined,
          security_name: undefined,
        }));
      }

      // Calculate summary statistics
      const summary = {
        totalTransactions: transactions.length,
        totalAmount: 0,
        totalFees: 0,
        totalNetAmount: 0,
        byType: {} as Record<string, { count: number; amount: number }>,
        byAccount: {} as Record<string, { account_name: string; count: number; amount: number }>,
        dateRange: { start: args.start, end: args.end, days: Math.ceil(daysDiff) },
      };

      transactions.forEach(txn => {
        summary.totalAmount += txn.amount || 0;
        summary.totalFees += txn.fees || 0;
        summary.totalNetAmount += txn.net_amount || 0;

        // Group by type
        if (!summary.byType[txn.type]) {
          summary.byType[txn.type] = { count: 0, amount: 0 };
        }
        summary.byType[txn.type].count++;
        summary.byType[txn.type].amount += txn.amount || 0;

        // Group by account
        const accountKey = txn.account_id;
        if (!summary.byAccount[accountKey]) {
          summary.byAccount[accountKey] = {
            account_name: txn.account_name || 'Unknown',
            count: 0,
            amount: 0,
          };
        }
        summary.byAccount[accountKey].count++;
        summary.byAccount[accountKey].amount += txn.amount || 0;
      });

      // Round summary values
      summary.totalAmount = Math.round(summary.totalAmount * 100) / 100;
      summary.totalFees = Math.round(summary.totalFees * 100) / 100;
      summary.totalNetAmount = Math.round(summary.totalNetAmount * 100) / 100;

      // Round grouped amounts
      Object.values(summary.byType).forEach(group => {
        group.amount = Math.round(group.amount * 100) / 100;
      });
      Object.values(summary.byAccount).forEach(group => {
        group.amount = Math.round(group.amount * 100) / 100;
      });

      // Build evidence
      const evidence = transactions.map(txn => ({
        table: 'investment_transactions',
        id: txn.id,
        fields: ['id', 'date', 'name', 'type', 'amount', 'symbol', 'account_id'],
      }));

      return {
        data: {
          transactions,
          summary,
        },
        meta: {
          count: transactions.length,
          dateRange: { start: args.start, end: args.end },
          filters: {
            accountIds: args.accountIds,
            symbols: args.symbols,
            transactionTypes: args.transactionTypes,
          },
          options: {
            includeAccountInfo: args.includeAccountInfo,
            includeSecurityInfo: args.includeSecurityInfo,
            limit: args.limit,
          },
          source: 'go-ingestion-service',
          timestamp: new Date().toISOString(),
        },
        evidence,
      };
    } catch (error: any) {
      logger.error('Failed to get investment transactions', {
        userId: context.userId,
        error: error.message,
        args,
      });
      throw error;
    }
  },
};