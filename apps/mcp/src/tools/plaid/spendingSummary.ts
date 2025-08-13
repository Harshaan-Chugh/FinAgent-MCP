import { z } from 'zod';
import axios from 'axios';
import { MCPTool } from '../../core/registry';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const inputSchema = z.object({
  window: z.enum(['7d', '30d', '90d', '1y']).optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  groupBy: z.enum(['category', 'merchant', 'month', 'week']).optional().default('category'),
  includeIncome: z.boolean().optional().default(false),
  minAmount: z.number().optional(),
  topN: z.number().min(1).max(50).optional().default(10),
}).refine(
  (data) => data.window || (data.start && data.end),
  "Either 'window' or both 'start' and 'end' must be provided"
);

type SpendingSummaryInput = z.infer<typeof inputSchema>;

interface CategorySummary {
  category: string;
  amount: number;
  transactionCount: number;
  percentage: number;
  avgTransactionAmount: number;
}

interface MerchantSummary {
  merchant: string;
  amount: number;
  transactionCount: number;
  categories: string[];
}

export const spendingSummaryTool: MCPTool = {
  name: 'spending_summary',
  description: 'Get spending analysis and summary for a time period, grouped by category, merchant, or time period',
  inputSchema,
  metadata: {
    category: 'banking',
    requiresAuth: true,
    rateLimit: {
      requests: 15,
      window: 60000, // 1 minute
    },
  },
  handler: async (args: SpendingSummaryInput, context: { userId: string }) => {
    try {
      // Calculate date range
      let startDate: string, endDate: string;
      
      if (args.window) {
        const end = new Date();
        const start = new Date();
        
        switch (args.window) {
          case '7d':
            start.setDate(end.getDate() - 7);
            break;
          case '30d':
            start.setDate(end.getDate() - 30);
            break;
          case '90d':
            start.setDate(end.getDate() - 90);
            break;
          case '1y':
            start.setFullYear(end.getFullYear() - 1);
            break;
        }
        
        startDate = start.toISOString().split('T')[0];
        endDate = end.toISOString().split('T')[0];
      } else {
        startDate = args.start!;
        endDate = args.end!;
      }

      logger.info('Generating spending summary', { 
        userId: context.userId,
        dateRange: `${startDate} to ${endDate}`,
        groupBy: args.groupBy,
        includeIncome: args.includeIncome,
      });

      // Fetch transactions
      const url = new URL('/read/transactions', config.goServiceUrl);
      url.searchParams.set('user_id', context.userId);
      url.searchParams.set('start', startDate);
      url.searchParams.set('end', endDate);
      url.searchParams.set('limit', '1000'); // Get more for analysis

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

      // Filter transactions
      if (!args.includeIncome) {
        transactions = transactions.filter((txn: any) => txn.amount > 0); // Positive = expense in Plaid
      }

      if (args.minAmount) {
        transactions = transactions.filter((txn: any) => Math.abs(txn.amount) >= args.minAmount!);
      }

      // Calculate totals
      const totalSpent = transactions
        .filter((txn: any) => txn.amount > 0)
        .reduce((sum: number, txn: any) => sum + txn.amount, 0);
      
      const totalIncome = transactions
        .filter((txn: any) => txn.amount < 0)
        .reduce((sum: number, txn: any) => sum + Math.abs(txn.amount), 0);

      // Group by specified field
      let groupedData: any[] = [];
      
      if (args.groupBy === 'category') {
        const categoryMap = new Map<string, CategorySummary>();
        
        for (const txn of transactions) {
          if (txn.amount <= 0 && !args.includeIncome) continue; // Skip income unless requested
          
          const categories = txn.category || ['Other'];
          const primaryCategory = categories[0] || 'Other';
          
          if (!categoryMap.has(primaryCategory)) {
            categoryMap.set(primaryCategory, {
              category: primaryCategory,
              amount: 0,
              transactionCount: 0,
              percentage: 0,
              avgTransactionAmount: 0,
            });
          }
          
          const summary = categoryMap.get(primaryCategory)!;
          summary.amount += Math.abs(txn.amount);
          summary.transactionCount++;
        }
        
        // Calculate percentages and averages
        for (const summary of categoryMap.values()) {
          summary.percentage = (summary.amount / (totalSpent || 1)) * 100;
          summary.avgTransactionAmount = summary.amount / summary.transactionCount;
          summary.amount = Math.round(summary.amount * 100) / 100;
          summary.percentage = Math.round(summary.percentage * 100) / 100;
          summary.avgTransactionAmount = Math.round(summary.avgTransactionAmount * 100) / 100;
        }
        
        groupedData = Array.from(categoryMap.values())
          .sort((a, b) => b.amount - a.amount)
          .slice(0, args.topN);
          
      } else if (args.groupBy === 'merchant') {
        const merchantMap = new Map<string, MerchantSummary>();
        
        for (const txn of transactions) {
          if (txn.amount <= 0 && !args.includeIncome) continue;
          
          const merchant = txn.merchant_name || 'Unknown';
          
          if (!merchantMap.has(merchant)) {
            merchantMap.set(merchant, {
              merchant,
              amount: 0,
              transactionCount: 0,
              categories: [],
            });
          }
          
          const summary = merchantMap.get(merchant)!;
          summary.amount += Math.abs(txn.amount);
          summary.transactionCount++;
          
          // Add unique categories
          const category = (txn.category && txn.category[0]) || 'Other';
          if (!summary.categories.includes(category)) {
            summary.categories.push(category);
          }
        }
        
        groupedData = Array.from(merchantMap.values())
          .map(summary => ({
            ...summary,
            amount: Math.round(summary.amount * 100) / 100,
          }))
          .sort((a, b) => b.amount - a.amount)
          .slice(0, args.topN);
      }

      // Calculate period info
      const periodStart = new Date(startDate);
      const periodEnd = new Date(endDate);
      const daysDiff = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 3600 * 24));

      // Build evidence
      const evidence = transactions.map((txn: any) => ({
        table: 'transactions',
        id: txn.id,
        fields: ['id', 'date', 'amount', 'merchant_name', 'category'],
      }));

      return {
        data: {
          summary: {
            totalSpent: Math.round(totalSpent * 100) / 100,
            totalIncome: Math.round(totalIncome * 100) / 100,
            netCashFlow: Math.round((totalIncome - totalSpent) * 100) / 100,
            transactionCount: transactions.length,
            avgDailySpending: Math.round((totalSpent / daysDiff) * 100) / 100,
          },
          groupedData,
          period: {
            startDate,
            endDate,
            days: daysDiff,
            window: args.window,
          },
          filters: {
            groupBy: args.groupBy,
            includeIncome: args.includeIncome,
            minAmount: args.minAmount,
            topN: args.topN,
          },
        },
        meta: {
          transactionCount: transactions.length,
          groupBy: args.groupBy,
          periodDays: daysDiff,
          source: 'go-ingestion-service',
          timestamp: new Date().toISOString(),
        },
        evidence,
      };
    } catch (error: any) {
      logger.error('Failed to generate spending summary', {
        userId: context.userId,
        error: error.message,
        args,
      });
      throw error;
    }
  },
};