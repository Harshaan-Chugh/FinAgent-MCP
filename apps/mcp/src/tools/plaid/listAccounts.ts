import { z } from 'zod';
import fetch from 'node-fetch';
import { MCPTool } from '../../core/registry';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const inputSchema = z.object({
  includeBalances: z.boolean().optional().default(true),
  accountTypes: z.array(z.enum(['depository', 'credit', 'loan', 'investment', 'other'])).optional(),
});

type ListAccountsInput = z.infer<typeof inputSchema>;

export const listAccountsTool: MCPTool = {
  name: 'list_accounts',
  description: 'List all financial accounts for the user, including checking, savings, credit cards, and investment accounts',
  inputSchema,
  metadata: {
    category: 'banking',
    requiresAuth: true,
    rateLimit: {
      requests: 10,
      window: 60000, // 1 minute
    },
  },
  handler: async (args: ListAccountsInput, context: { userId: string }) => {
    try {
      logger.info('Fetching accounts', { 
        userId: context.userId, 
        includeBalances: args.includeBalances 
      });

      // Call Go ingestion service
      const url = new URL('/read/accounts', config.goServiceUrl);
      url.searchParams.set('user_id', context.userId);
      
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Go service error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as any;
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch accounts');
      }

      let accounts = result.data.accounts || [];

      // Filter by account types if specified
      if (args.accountTypes && args.accountTypes.length > 0) {
        accounts = accounts.filter((account: any) => 
          args.accountTypes!.includes(account.type as any)
        );
      }

      // Remove sensitive data if balances not requested
      if (!args.includeBalances) {
        accounts = accounts.map((account: any) => ({
          ...account,
          balance_current: undefined,
          balance_available: undefined,
          balance_limit: undefined,
        }));
      }

      // Build evidence
      const evidence = accounts.map((account: any) => ({
        table: 'accounts',
        id: account.id,
        fields: ['id', 'name', 'type', 'subtype', 'mask'],
      }));

      return {
        data: accounts,
        meta: {
          count: accounts.length,
          includeBalances: args.includeBalances,
          accountTypes: args.accountTypes,
          source: 'go-ingestion-service',
          timestamp: new Date().toISOString(),
        },
        evidence,
      };
    } catch (error: any) {
      logger.error('Failed to list accounts', {
        userId: context.userId,
        error: error.message,
      });
      throw error;
    }
  },
};