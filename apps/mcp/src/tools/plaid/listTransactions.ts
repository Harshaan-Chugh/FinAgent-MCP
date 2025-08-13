import { z } from 'zod';
import axios from 'axios';
import { MCPTool } from '../../core/registry';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const inputSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  merchant: z.string().optional(),
  category: z.string().optional(),
  accountIds: z.array(z.string()).optional(),
  limit: z.number().min(1).max(1000).optional().default(100),
  includeAccountInfo: z.boolean().optional().default(true),
});

type ListTransactionsInput = z.infer<typeof inputSchema>;

export const listTransactionsTool: MCPTool = {
  name: 'list_transactions',
  description: 'List financial transactions within a date range, with optional filtering by merchant, category, or account',
  inputSchema,
  metadata: {
    category: 'banking',
    requiresAuth: true,
    rateLimit: {
      requests: 20,
      window: 60000, // 1 minute
    },
  },
  handler: async (args: ListTransactionsInput, context: { userId: string }) => {
    try {
      logger.info('Fetching transactions', { 
        userId: context.userId,
        dateRange: `${args.start} to ${args.end}`,
        filters: { 
          merchant: args.merchant, 
          category: args.category,
          limit: args.limit 
        }
      });

      // Validate date range
      const startDate = new Date(args.start);
      const endDate = new Date(args.end);
      
      if (startDate > endDate) {
        throw new Error('Start date must be before or equal to end date');
      }

      // Check if date range is reasonable (not more than 2 years)
      const daysDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24);
      if (daysDiff > 730) {
        throw new Error('Date range cannot exceed 2 years');
      }

      // Call Go ingestion service
      const url = new URL('/read/transactions', config.goServiceUrl);
      url.searchParams.set('user_id', context.userId);
      url.searchParams.set('start', args.start);
      url.searchParams.set('end', args.end);
      url.searchParams.set('limit', args.limit.toString());
      
      if (args.merchant) {
        url.searchParams.set('merchant', args.merchant);
      }
      
      if (args.category) {
        url.searchParams.set('category', args.category);
      }

      const response = await axios.get(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });


      const result = await response.data as any;
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch transactions');
      }

      let transactions = result.data.transactions || [];

      // Filter by account IDs if specified
      if (args.accountIds && args.accountIds.length > 0) {
        transactions = transactions.filter((txn: any) => 
          args.accountIds!.includes(txn.account_id)
        );
      }

      // Remove account info if not requested
      if (!args.includeAccountInfo) {
        transactions = transactions.map((txn: any) => ({
          ...txn,
          account_name: undefined,
          account_mask: undefined,
        }));
      }

      // Calculate summary statistics
      const totalAmount = transactions.reduce((sum: number, txn: any) => sum + Math.abs(txn.amount), 0);
      const income = transactions
        .filter((txn: any) => txn.amount < 0) // Plaid uses negative for income
        .reduce((sum: number, txn: any) => sum + Math.abs(txn.amount), 0);
      const expenses = transactions
        .filter((txn: any) => txn.amount > 0) // Plaid uses positive for expenses
        .reduce((sum: number, txn: any) => sum + txn.amount, 0);

      // Build evidence
      const evidence = transactions.map((txn: any) => ({
        table: 'transactions',
        id: txn.id,
        fields: ['id', 'date', 'amount', 'merchant_name', 'category', 'account_id'],
      }));

      return {
        data: transactions,
        meta: {
          count: transactions.length,
          dateRange: { start: args.start, end: args.end },
          filters: { 
            merchant: args.merchant, 
            category: args.category,
            accountIds: args.accountIds 
          },
          summary: {
            totalAmount: Math.round(totalAmount * 100) / 100,
            income: Math.round(income * 100) / 100,
            expenses: Math.round(expenses * 100) / 100,
            netCashFlow: Math.round((income - expenses) * 100) / 100,
          },
          source: 'go-ingestion-service',
          timestamp: new Date().toISOString(),
        },
        evidence,
      };
    } catch (error: any) {
      logger.error('Failed to list transactions', {
        userId: context.userId,
        error: error.message,
        args,
      });
      throw error;
    }
  },
};