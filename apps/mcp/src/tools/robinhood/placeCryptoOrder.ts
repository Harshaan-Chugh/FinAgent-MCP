import { z } from 'zod';
import fetch from 'node-fetch';
import { MCPTool } from '../../core/registry';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const inputSchema = z.object({
  symbol: z.string().min(1).max(10).regex(/^[A-Z]+$/, 'Symbol must be uppercase letters only'),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().positive(),
  orderType: z.enum(['market', 'limit']).optional().default('market'),
  price: z.number().positive().optional(),
  dry_run: z.boolean().optional().default(true),
  timeInForce: z.enum(['GTC', 'IOC', 'FOK']).optional().default('GTC'),
}).refine(
  (data) => data.orderType !== 'limit' || data.price !== undefined,
  {
    message: "Price is required for limit orders",
    path: ["price"],
  }
).refine(
  (data) => data.quantity <= 1000000,
  {
    message: "Quantity cannot exceed 1,000,000",
    path: ["quantity"],
  }
);

type PlaceCryptoOrderInput = z.infer<typeof inputSchema>;

const SUPPORTED_SYMBOLS = [
  'BTC', 'ETH', 'DOGE', 'LTC', 'BCH', 'ETC', 'BSV',
  'ADA', 'XRP', 'SOL', 'MATIC', 'AVAX', 'DOT', 'LINK',
  'UNI', 'ALGO', 'ATOM', 'XLM', 'COMP', 'AAVE'
];

const MIN_ORDER_AMOUNTS: Record<string, number> = {
  'BTC': 0.000001,
  'ETH': 0.00001,
  'DOGE': 1,
  'LTC': 0.001,
  'BCH': 0.001,
  'ETC': 0.01,
  'BSV': 0.001,
  'ADA': 1,
  'XRP': 1,
  'SOL': 0.01,
  'MATIC': 1,
  'AVAX': 0.01,
  'DOT': 0.01,
  'LINK': 0.01,
  'UNI': 0.01,
  'ALGO': 1,
  'ATOM': 0.01,
  'XLM': 1,
  'COMP': 0.001,
  'AAVE': 0.001,
};

export const placeCryptoOrderTool: MCPTool = {
  name: 'place_crypto_order',
  description: 'Place a cryptocurrency order (buy or sell) with safety guardrails. Orders default to dry_run=true for safety.',
  inputSchema,
  metadata: {
    category: 'crypto',
    requiresAuth: true,
    rateLimit: {
      requests: 5,
      window: 60000, // 1 minute
    },
  },
  handler: async (args: PlaceCryptoOrderInput, context: { userId: string }) => {
    try {
      logger.info('Placing crypto order', { 
        userId: context.userId,
        symbol: args.symbol,
        side: args.side,
        quantity: args.quantity,
        orderType: args.orderType,
        dryRun: args.dry_run,
      });

      // Validate symbol
      if (!SUPPORTED_SYMBOLS.includes(args.symbol)) {
        throw new Error(`Unsupported symbol: ${args.symbol}. Supported symbols: ${SUPPORTED_SYMBOLS.join(', ')}`);
      }

      // Validate minimum order amount
      const minAmount = MIN_ORDER_AMOUNTS[args.symbol] || 0.01;
      if (args.quantity < minAmount) {
        throw new Error(`Minimum order quantity for ${args.symbol} is ${minAmount}`);
      }

      // Safety check: Force dry_run for large orders
      let isDryRun = args.dry_run;
      const USD_VALUE_THRESHOLD = 10000; // $10k threshold for forced dry run

      // Estimate USD value (simplified)
      const estimatedPrices: Record<string, number> = {
        'BTC': 45000,
        'ETH': 3200,
        'DOGE': 0.08,
        'LTC': 150,
        'BCH': 400,
        // ... other prices would be fetched from a real price API
      };
      
      const estimatedPrice = args.price || estimatedPrices[args.symbol] || 100;
      const estimatedUSDValue = args.quantity * estimatedPrice;
      
      if (estimatedUSDValue > USD_VALUE_THRESHOLD && !isDryRun) {
        logger.warn('Large order detected, forcing dry_run', {
          userId: context.userId,
          symbol: args.symbol,
          estimatedUSDValue,
          threshold: USD_VALUE_THRESHOLD,
        });
        isDryRun = true;
      }

      // Additional validation for sell orders
      if (args.side === 'sell' && !isDryRun) {
        // In a real implementation, we would check the user's actual position
        // For now, we'll just log a warning
        logger.warn('Real sell order - would need to verify position', {
          userId: context.userId,
          symbol: args.symbol,
          quantity: args.quantity,
        });
      }

      // Prepare order request
      const orderRequest = {
        user_id: context.userId,
        symbol: args.symbol,
        side: args.side,
        quantity: args.quantity,
        order_type: args.orderType,
        price: args.price,
        dry_run: isDryRun,
        time_in_force: args.timeInForce,
      };

      // Call Go ingestion service
      const response = await fetch(`${config.goServiceUrl}/rh/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Go service error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json() as any;
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to place crypto order');
      }

      const order = result.data.order;

      // Calculate estimated fees and total
      const estimatedFee = estimatedUSDValue * 0.005; // 0.5% fee estimate
      const estimatedTotal = args.side === 'buy' 
        ? estimatedUSDValue + estimatedFee
        : estimatedUSDValue - estimatedFee;

      // Build risk assessment
      const riskAssessment = {
        riskLevel: estimatedUSDValue > 5000 ? 'high' : estimatedUSDValue > 1000 ? 'medium' : 'low',
        estimatedUSDValue: Math.round(estimatedUSDValue * 100) / 100,
        estimatedFee: Math.round(estimatedFee * 100) / 100,
        estimatedTotal: Math.round(estimatedTotal * 100) / 100,
        priceSource: args.price ? 'user_specified' : 'estimated',
        warnings: [] as string[],
      };

      // Add warnings
      if (isDryRun !== args.dry_run) {
        riskAssessment.warnings.push('Order automatically converted to dry_run due to large value');
      }
      
      if (args.orderType === 'market') {
        riskAssessment.warnings.push('Market orders execute immediately at current market price');
      }
      
      if (estimatedUSDValue > 1000) {
        riskAssessment.warnings.push('Large order - consider splitting into smaller orders');
      }

      // Build evidence
      const evidence = [
        {
          table: 'crypto_orders',
          id: order.id,
          fields: ['id', 'symbol', 'side', 'quantity', 'status', 'dry_run'],
        },
      ];

      // Generate appropriate message
      const statusMessage = isDryRun 
        ? `Simulated ${args.side} order for ${args.quantity} ${args.symbol} created successfully`
        : `Real ${args.side} order for ${args.quantity} ${args.symbol} submitted to Robinhood`;

      return {
        data: {
          order,
          riskAssessment,
          executionDetails: {
            orderId: order.id,
            status: order.status,
            dryRun: isDryRun,
            forcedDryRun: isDryRun !== args.dry_run,
            estimatedExecutionTime: order.status === 'pending' ? '1-5 seconds' : 'immediate',
          },
        },
        meta: {
          symbol: args.symbol,
          side: args.side,
          quantity: args.quantity,
          orderType: args.orderType,
          dryRun: isDryRun,
          originalDryRunIntent: args.dry_run,
          estimatedUSDValue: Math.round(estimatedUSDValue * 100) / 100,
          statusMessage,
          source: 'go-ingestion-service',
          timestamp: new Date().toISOString(),
          safety: {
            guardrailsApplied: isDryRun !== args.dry_run,
            riskLevel: riskAssessment.riskLevel,
            warningCount: riskAssessment.warnings.length,
          },
        },
        evidence,
      };
    } catch (error: any) {
      logger.error('Failed to place crypto order', {
        userId: context.userId,
        error: error.message,
        args,
      });
      throw error;
    }
  },
};