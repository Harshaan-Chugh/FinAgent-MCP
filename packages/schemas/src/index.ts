import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Banking schemas
export const ListAccountsSchema = z.object({
  includeBalances: z.boolean().optional().default(true),
  accountTypes: z.array(z.enum(['depository', 'credit', 'loan', 'investment', 'other'])).optional(),
});

export const ListTransactionsSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  merchant: z.string().optional(),
  category: z.string().optional(),
  accountIds: z.array(z.string()).optional(),
  limit: z.number().min(1).max(1000).optional().default(100),
  includeAccountInfo: z.boolean().optional().default(true),
});

export const SpendingSummarySchema = z.object({
  window: z.enum(['7d', '30d', '90d', '1y']).optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  groupBy: z.enum(['category', 'merchant', 'month', 'week']).optional().default('category'),
  includeIncome: z.boolean().optional().default(false),
  minAmount: z.number().optional(),
  topN: z.number().min(1).max(50).optional().default(10),
}).refine(
  (data) => data.window || (data.start && data.end),
  "Either 'window' or both 'start' and 'end' must be provided"
);

// Investment schemas  
export const GetHoldingsSchema = z.object({
  accountIds: z.array(z.string()).optional(),
  securityTypes: z.array(z.enum(['equity', 'bond', 'etf', 'mutual_fund', 'cash_equivalent', 'derivative'])).optional(),
  includeClosedPositions: z.boolean().optional().default(false),
  sortBy: z.enum(['value', 'quantity', 'symbol', 'unrealized_pnl']).optional().default('value'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const GetInvestmentTransactionsSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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

// Crypto schemas
export const GetCryptoPositionsSchema = z.object({
  symbols: z.array(z.string()).optional(),
  includeZeroBalances: z.boolean().optional().default(false),
  sortBy: z.enum(['value', 'quantity', 'symbol', 'pnl', 'pnl_percent']).optional().default('value'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  includePriceData: z.boolean().optional().default(true),
});

export const PlaceCryptoOrderSchema = z.object({
  symbol: z.string().min(1).max(10).regex(/^[A-Z]+$/, 'Symbol must be uppercase letters only'),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().positive(),
  orderType: z.enum(['market', 'limit']).optional().default('market'),
  price: z.number().positive().optional(),
  dry_run: z.boolean().optional().default(true),
  timeInForce: z.enum(['GTC', 'IOC', 'FOK']).optional().default('GTC'),
}).refine(
  (data) => data.orderType !== 'limit' || data.price !== undefined,
  { message: "Price is required for limit orders", path: ["price"] }
);

// Meta schemas
export const GetContextCardSchema = z.object({
  query: z.string().min(1).max(500),
  data: z.array(z.any()).optional().default([]),
  tokenBudget: z.number().min(100).max(4000).optional().default(2500),
  maxItems: z.number().min(1).max(100).optional().default(50),
  includeAggregates: z.boolean().optional().default(true),
  timeWindow: z.object({
    start: z.string().optional(),
    end: z.string().optional(),
  }).optional(),
});

// Export JSON schemas
export const schemas = {
  list_accounts: zodToJsonSchema(ListAccountsSchema, 'ListAccountsSchema'),
  list_transactions: zodToJsonSchema(ListTransactionsSchema, 'ListTransactionsSchema'),
  spending_summary: zodToJsonSchema(SpendingSummarySchema, 'SpendingSummarySchema'),
  get_holdings: zodToJsonSchema(GetHoldingsSchema, 'GetHoldingsSchema'),
  get_investment_transactions: zodToJsonSchema(GetInvestmentTransactionsSchema, 'GetInvestmentTransactionsSchema'),
  get_crypto_positions: zodToJsonSchema(GetCryptoPositionsSchema, 'GetCryptoPositionsSchema'),
  place_crypto_order: zodToJsonSchema(PlaceCryptoOrderSchema, 'PlaceCryptoOrderSchema'),
  get_context_card: zodToJsonSchema(GetContextCardSchema, 'GetContextCardSchema'),
};

// Export types
export type ListAccountsInput = z.infer<typeof ListAccountsSchema>;
export type ListTransactionsInput = z.infer<typeof ListTransactionsSchema>;
export type SpendingSummaryInput = z.infer<typeof SpendingSummarySchema>;
export type GetHoldingsInput = z.infer<typeof GetHoldingsSchema>;
export type GetInvestmentTransactionsInput = z.infer<typeof GetInvestmentTransactionsSchema>;
export type GetCryptoPositionsInput = z.infer<typeof GetCryptoPositionsSchema>;
export type PlaceCryptoOrderInput = z.infer<typeof PlaceCryptoOrderSchema>;
export type GetContextCardInput = z.infer<typeof GetContextCardSchema>;