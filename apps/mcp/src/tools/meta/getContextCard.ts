import { z } from 'zod';
import { MCPTool } from '../../core/registry';
import { contextPacker } from '../../core/context';
import { logger } from '../../utils/logger';

const inputSchema = z.object({
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

type GetContextCardInput = z.infer<typeof inputSchema>;

export const getContextCardTool: MCPTool = {
  name: 'get_context_card',
  description: 'Generate a context-aware summary card from financial data using intelligent ranking and compression',
  inputSchema,
  metadata: {
    category: 'meta',
    requiresAuth: true,
    rateLimit: {
      requests: 20,
      window: 60000, // 1 minute
    },
  },
  handler: async (args: GetContextCardInput, context: { userId: string }) => {
    try {
      logger.info('Generating context card', { 
        userId: context.userId,
        query: args.query,
        dataCount: args.data.length,
        tokenBudget: args.tokenBudget,
      });

      // Pack the context using the context packer
      const contextCard = await contextPacker.pack(args.data, {
        query: args.query,
        tokenBudget: args.tokenBudget,
        maxItems: args.maxItems,
        includeAggregates: args.includeAggregates,
        timeWindow: args.timeWindow,
      });

      // Analyze query intent
      const queryIntent = analyzeQueryIntent(args.query);

      // Generate insights based on the packed context
      const insights = generateInsights(contextCard, queryIntent);

      // Calculate quality metrics
      const qualityMetrics = calculateQualityMetrics(contextCard, args);

      // Build evidence
      const evidence = [{
        table: 'context_operations',
        id: `context_${Date.now()}`,
        fields: ['query', 'token_count', 'compression_ratio', 'snippet_count'],
      }];

      return {
        data: {
          contextCard,
          insights,
          qualityMetrics,
          queryAnalysis: queryIntent,
        },
        meta: {
          originalQuery: args.query,
          tokenBudget: args.tokenBudget,
          actualTokens: contextCard.totalTokens,
          tokenUtilization: (contextCard.totalTokens / args.tokenBudget) * 100,
          compressionRatio: contextCard.compressionRatio,
          snippetCount: contextCard.snippets.length,
          packingStrategy: contextCard.metadata.packingStrategy,
          source: 'context-packer',
          timestamp: new Date().toISOString(),
        },
        evidence,
      };
    } catch (error: any) {
      logger.error('Failed to generate context card', {
        userId: context.userId,
        error: error.message,
        query: args.query,
      });
      throw error;
    }
  },
};

function analyzeQueryIntent(query: string): {
  type: 'search' | 'summary' | 'analysis' | 'comparison';
  entities: string[];
  timeframe: 'recent' | 'historical' | 'specific' | 'any';
  confidence: number;
} {
  const lowercaseQuery = query.toLowerCase();
  
  // Determine query type
  let type: 'search' | 'summary' | 'analysis' | 'comparison' = 'search';
  
  if (lowercaseQuery.includes('summary') || lowercaseQuery.includes('total') || lowercaseQuery.includes('how much')) {
    type = 'summary';
  } else if (lowercaseQuery.includes('analyze') || lowercaseQuery.includes('trend') || lowercaseQuery.includes('pattern')) {
    type = 'analysis';
  } else if (lowercaseQuery.includes('compare') || lowercaseQuery.includes('vs') || lowercaseQuery.includes('versus')) {
    type = 'comparison';
  }

  // Extract entities (merchants, categories, symbols)
  const entities: string[] = [];
  const commonEntities = ['starbucks', 'amazon', 'grocery', 'gas', 'dining', 'btc', 'eth', 'stock', 'investment'];
  
  for (const entity of commonEntities) {
    if (lowercaseQuery.includes(entity)) {
      entities.push(entity);
    }
  }

  // Determine timeframe
  let timeframe: 'recent' | 'historical' | 'specific' | 'any' = 'any';
  
  if (lowercaseQuery.includes('last') || lowercaseQuery.includes('recent') || lowercaseQuery.includes('this month')) {
    timeframe = 'recent';
  } else if (lowercaseQuery.includes('year') || lowercaseQuery.includes('2023') || lowercaseQuery.includes('2024')) {
    timeframe = 'historical';
  } else if (lowercaseQuery.match(/\d{4}-\d{2}-\d{2}/)) {
    timeframe = 'specific';
  }

  // Calculate confidence based on clarity of intent
  let confidence = 0.5;
  if (entities.length > 0) confidence += 0.2;
  if (timeframe !== 'any') confidence += 0.2;
  if (type !== 'search') confidence += 0.1;

  return { type, entities, timeframe, confidence };
}

function generateInsights(contextCard: any, queryIntent: any): string[] {
  const insights: string[] = [];
  
  if (contextCard.snippets.length === 0) {
    insights.push('No relevant data found for this query');
    return insights;
  }

  // Token efficiency insight
  if (contextCard.totalTokens < contextCard.metadata.tokenBudget * 0.5) {
    insights.push(`Efficiently packed context using only ${contextCard.totalTokens} of ${contextCard.metadata.tokenBudget} available tokens`);
  } else if (contextCard.totalTokens > contextCard.metadata.tokenBudget * 0.9) {
    insights.push('Context is near token limit - consider narrowing your query for more detailed results');
  }

  // Compression insight
  if (contextCard.compressionRatio < 0.3) {
    insights.push('High compression applied - showing most relevant subset of available data');
  }

  // Data diversity insight
  const snippetTypes = new Set(contextCard.snippets.map((s: any) => s.type));
  if (snippetTypes.size > 2) {
    insights.push(`Found ${snippetTypes.size} different types of financial data (${Array.from(snippetTypes).join(', ')})`);
  }

  // Relevance insight
  const highRelevanceCount = contextCard.snippets.filter((s: any) => s.relevanceScore > 2).length;
  if (highRelevanceCount > 0) {
    insights.push(`${highRelevanceCount} items have high relevance to your query`);
  }

  // Query-specific insights
  if (queryIntent.type === 'summary' && contextCard.snippets.some((s: any) => s.type === 'summary')) {
    insights.push('Summary data available in context');
  }

  if (queryIntent.entities.length > 0) {
    const foundEntities = queryIntent.entities.filter((entity: string) => 
      contextCard.snippets.some((s: any) => s.content.toLowerCase().includes(entity))
    );
    if (foundEntities.length > 0) {
      insights.push(`Found data related to: ${foundEntities.join(', ')}`);
    }
  }

  return insights;
}

function calculateQualityMetrics(contextCard: any, args: GetContextCardInput): {
  relevanceScore: number;
  diversityScore: number;
  completenessScore: number;
  efficiencyScore: number;
  overallQuality: number;
} {
  // Relevance: average relevance score of snippets
  const avgRelevance = contextCard.snippets.length > 0 
    ? contextCard.snippets.reduce((sum: number, s: any) => sum + s.relevanceScore, 0) / contextCard.snippets.length
    : 0;
  const relevanceScore = Math.min(1, avgRelevance / 3); // Normalize to 0-1

  // Diversity: variety of snippet types and content
  const typeSet = new Set(contextCard.snippets.map((s: any) => s.type));
  const diversityScore = Math.min(1, typeSet.size / 4); // Max 4 types expected

  // Completeness: how much of requested data is included
  const requestedItems = Math.min(args.maxItems || 50, args.data.length);
  const completenessScore = requestedItems > 0 
    ? Math.min(1, contextCard.snippets.length / requestedItems)
    : 1;

  // Efficiency: token usage efficiency
  const tokenUtilization = contextCard.totalTokens / args.tokenBudget;
  const efficiencyScore = tokenUtilization > 0.9 ? 1 : tokenUtilization > 0.5 ? 0.8 : 0.6;

  // Overall quality
  const overallQuality = (relevanceScore + diversityScore + completenessScore + efficiencyScore) / 4;

  return {
    relevanceScore: Math.round(relevanceScore * 100) / 100,
    diversityScore: Math.round(diversityScore * 100) / 100,
    completenessScore: Math.round(completenessScore * 100) / 100,
    efficiencyScore: Math.round(efficiencyScore * 100) / 100,
    overallQuality: Math.round(overallQuality * 100) / 100,
  };
}