import { logger } from '../utils/logger';
import { config } from '../config';

export interface ContextPackingOptions {
  query: string;
  tokenBudget: number;
  maxItems?: number;
  includeAggregates?: boolean;
  timeWindow?: {
    start?: string;
    end?: string;
  };
}

export interface ContextSnippet {
  type: 'transaction' | 'account' | 'holding' | 'position' | 'summary';
  content: string;
  relevanceScore: number;
  tokenCount: number;
  metadata: {
    id?: string;
    amount?: number;
    date?: string;
    category?: string;
    symbol?: string;
  };
}

export interface ContextCard {
  query: string;
  snippets: ContextSnippet[];
  totalTokens: number;
  compressionRatio: number;
  metadata: {
    originalItemCount: number;
    includedItemCount: number;
    tokenBudget: number;
    packingStrategy: string;
    timestamp: string;
  };
}

class ContextPacker {
  private readonly TOKEN_PER_WORD = 1.3; // Average tokens per word
  private readonly SUMMARY_TOKEN_RATIO = 0.3; // Reserve 30% for summaries

  async pack(data: any[], options: ContextPackingOptions): Promise<ContextCard> {
    try {
      logger.info('Packing context', {
        query: options.query,
        dataCount: data.length,
        tokenBudget: options.tokenBudget,
      });

      // Initialize context card
      const contextCard: ContextCard = {
        query: options.query,
        snippets: [],
        totalTokens: 0,
        compressionRatio: 0,
        metadata: {
          originalItemCount: data.length,
          includedItemCount: 0,
          tokenBudget: options.tokenBudget,
          packingStrategy: 'mmr_temporal',
          timestamp: new Date().toISOString(),
        },
      };

      if (!data || data.length === 0) {
        return contextCard;
      }

      // Determine data type and create appropriate snippets
      const snippets = await this.createSnippets(data, options);
      
      // Calculate relevance scores
      const scoredSnippets = this.calculateRelevanceScores(snippets, options.query);
      
      // Pack snippets using MMR (Maximal Marginal Relevance) algorithm
      const packedSnippets = this.packWithMMR(scoredSnippets, options);
      
      // Add aggregates if requested and budget allows
      if (options.includeAggregates && this.getRemainingTokens(packedSnippets, options.tokenBudget) > 100) {
        const aggregateSnippets = this.createAggregateSnippets(data, options);
        packedSnippets.unshift(...aggregateSnippets);
      }

      // Final token count and trimming
      const finalSnippets = this.trimToTokenBudget(packedSnippets, options.tokenBudget);
      
      contextCard.snippets = finalSnippets;
      contextCard.totalTokens = finalSnippets.reduce((sum, s) => sum + s.tokenCount, 0);
      contextCard.compressionRatio = data.length > 0 ? finalSnippets.length / data.length : 0;
      contextCard.metadata.includedItemCount = finalSnippets.length;

      return contextCard;
    } catch (error: any) {
      logger.error('Failed to pack context', {
        error: error.message,
        query: options.query,
        dataCount: data.length,
      });
      
      // Return empty context card on error
      return {
        query: options.query,
        snippets: [],
        totalTokens: 0,
        compressionRatio: 0,
        metadata: {
          originalItemCount: data.length,
          includedItemCount: 0,
          tokenBudget: options.tokenBudget,
          packingStrategy: 'error',
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  private async createSnippets(data: any[], options: ContextPackingOptions): Promise<ContextSnippet[]> {
    const snippets: ContextSnippet[] = [];

    for (const item of data) {
      let snippet: ContextSnippet;

      // Determine item type and create appropriate snippet
      if (item.amount !== undefined && item.date) {
        // Transaction-like item
        snippet = this.createTransactionSnippet(item);
      } else if (item.balance_current !== undefined || item.balance_available !== undefined) {
        // Account-like item
        snippet = this.createAccountSnippet(item);
      } else if (item.quantity !== undefined && item.symbol) {
        // Holding/Position-like item
        snippet = this.createHoldingSnippet(item);
      } else {
        // Generic item
        snippet = this.createGenericSnippet(item);
      }

      snippets.push(snippet);
    }

    return snippets;
  }

  private createTransactionSnippet(item: any): ContextSnippet {
    const amount = Math.abs(item.amount || 0);
    const merchant = item.merchant_name || item.description || 'Unknown';
    const category = Array.isArray(item.category) ? item.category[0] : item.category || 'Other';
    const date = item.date || 'Unknown date';
    
    const content = `$${amount.toFixed(2)} at ${merchant} (${category}) on ${date}`;
    
    return {
      type: 'transaction',
      content,
      relevanceScore: 0, // Will be calculated later
      tokenCount: this.estimateTokenCount(content),
      metadata: {
        id: item.id,
        amount: item.amount,
        date: item.date,
        category,
      },
    };
  }

  private createAccountSnippet(item: any): ContextSnippet {
    const name = item.name || 'Unknown Account';
    const type = item.type || 'account';
    const balance = item.balance_current || item.balance_available || 0;
    const mask = item.mask ? `(***${item.mask})` : '';
    
    const content = `${name} ${mask}: $${balance.toFixed(2)} ${type} account`;
    
    return {
      type: 'account',
      content,
      relevanceScore: 0,
      tokenCount: this.estimateTokenCount(content),
      metadata: {
        id: item.id,
        amount: balance,
      },
    };
  }

  private createHoldingSnippet(item: any): ContextSnippet {
    const symbol = item.symbol || 'Unknown';
    const name = item.security_name || item.name || symbol;
    const quantity = item.quantity || 0;
    const value = item.institution_value || item.market_value || 0;
    const unrealizedPnL = item.unrealized_pnl;
    
    let content = `${symbol}: ${quantity} shares of ${name}, value $${value.toFixed(2)}`;
    if (unrealizedPnL) {
      const sign = unrealizedPnL >= 0 ? '+' : '';
      content += `, P&L ${sign}$${unrealizedPnL.toFixed(2)}`;
    }
    
    return {
      type: item.symbol ? 'holding' : 'position',
      content,
      relevanceScore: 0,
      tokenCount: this.estimateTokenCount(content),
      metadata: {
        id: item.id,
        amount: value,
        symbol: symbol,
      },
    };
  }

  private createGenericSnippet(item: any): ContextSnippet {
    // Create a generic representation
    const keyValues = Object.entries(item)
      .filter(([key, value]) => value !== null && value !== undefined)
      .slice(0, 3) // Limit to first 3 key-value pairs
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
    
    const content = keyValues || 'No data available';
    
    return {
      type: 'summary',
      content,
      relevanceScore: 0,
      tokenCount: this.estimateTokenCount(content),
      metadata: {
        id: item.id,
      },
    };
  }

  private calculateRelevanceScores(snippets: ContextSnippet[], query: string): ContextSnippet[] {
    const queryTokens = this.tokenize(query.toLowerCase());
    
    return snippets.map(snippet => {
      const contentTokens = this.tokenize(snippet.content.toLowerCase());
      
      // Calculate relevance using simple TF-IDF-like scoring
      let score = 0;
      
      for (const queryToken of queryTokens) {
        if (contentTokens.includes(queryToken)) {
          score += 1;
        }
        
        // Boost score for partial matches
        for (const contentToken of contentTokens) {
          if (contentToken.includes(queryToken) || queryToken.includes(contentToken)) {
            score += 0.5;
          }
        }
      }
      
      // Boost recent items (if date available)
      if (snippet.metadata.date) {
        const itemDate = new Date(snippet.metadata.date);
        const daysSinceItem = (Date.now() - itemDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceItem <= 30) { // Recent items (last 30 days)
          score += 0.5;
        }
      }
      
      // Boost high-value items
      if (snippet.metadata.amount && Math.abs(snippet.metadata.amount) > 1000) {
        score += 0.3;
      }
      
      return {
        ...snippet,
        relevanceScore: score,
      };
    });
  }

  private packWithMMR(snippets: ContextSnippet[], options: ContextPackingOptions): ContextSnippet[] {
    // Sort by relevance score
    const sortedSnippets = [...snippets].sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    const selected: ContextSnippet[] = [];
    let totalTokens = 0;
    const maxItems = options.maxItems || Math.min(50, sortedSnippets.length);
    
    // Reserve tokens for potential aggregates
    const reservedTokens = options.includeAggregates ? options.tokenBudget * this.SUMMARY_TOKEN_RATIO : 0;
    const availableTokens = options.tokenBudget - reservedTokens;
    
    for (let i = 0; i < Math.min(maxItems, sortedSnippets.length); i++) {
      const candidate = sortedSnippets[i];
      
      if (totalTokens + candidate.tokenCount > availableTokens) {
        break;
      }
      
      // Calculate diversity score (avoid too similar items)
      const diversityScore = this.calculateDiversityScore(candidate, selected);
      
      // Combined score = relevance * diversity
      const combinedScore = candidate.relevanceScore * diversityScore;
      
      if (combinedScore > 0.1) { // Minimum threshold
        selected.push(candidate);
        totalTokens += candidate.tokenCount;
      }
    }
    
    return selected;
  }

  private calculateDiversityScore(candidate: ContextSnippet, selected: ContextSnippet[]): number {
    if (selected.length === 0) return 1.0;
    
    let diversityScore = 1.0;
    
    for (const selectedSnippet of selected) {
      // Penalize similar types
      if (selectedSnippet.type === candidate.type) {
        diversityScore *= 0.8;
      }
      
      // Penalize similar amounts
      if (selectedSnippet.metadata.amount && candidate.metadata.amount) {
        const amountDiff = Math.abs(selectedSnippet.metadata.amount - candidate.metadata.amount);
        if (amountDiff < 50) { // Very similar amounts
          diversityScore *= 0.7;
        }
      }
      
      // Penalize similar categories/symbols
      if (selectedSnippet.metadata.category === candidate.metadata.category ||
          selectedSnippet.metadata.symbol === candidate.metadata.symbol) {
        diversityScore *= 0.6;
      }
    }
    
    return Math.max(0.1, diversityScore); // Minimum diversity score
  }

  private createAggregateSnippets(data: any[], options: ContextPackingOptions): ContextSnippet[] {
    const aggregates: ContextSnippet[] = [];
    
    // Create spending summary if data contains transactions
    const transactions = data.filter(item => item.amount !== undefined && item.date);
    if (transactions.length > 0) {
      const totalSpending = transactions
        .filter(t => t.amount > 0)
        .reduce((sum, t) => sum + t.amount, 0);
      
      const totalIncome = transactions
        .filter(t => t.amount < 0)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      
      const content = `Summary: $${totalSpending.toFixed(2)} spent, $${totalIncome.toFixed(2)} income from ${transactions.length} transactions`;
      
      aggregates.push({
        type: 'summary',
        content,
        relevanceScore: 10, // High relevance for summaries
        tokenCount: this.estimateTokenCount(content),
        metadata: {
          amount: totalSpending,
        },
      });
    }
    
    return aggregates;
  }

  private trimToTokenBudget(snippets: ContextSnippet[], budget: number): ContextSnippet[] {
    const result: ContextSnippet[] = [];
    let totalTokens = 0;
    
    for (const snippet of snippets) {
      if (totalTokens + snippet.tokenCount <= budget) {
        result.push(snippet);
        totalTokens += snippet.tokenCount;
      } else {
        break;
      }
    }
    
    return result;
  }

  private getRemainingTokens(snippets: ContextSnippet[], budget: number): number {
    const usedTokens = snippets.reduce((sum, s) => sum + s.tokenCount, 0);
    return Math.max(0, budget - usedTokens);
  }

  private estimateTokenCount(text: string): number {
    return Math.ceil(text.split(/\s+/).length * this.TOKEN_PER_WORD);
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 0);
  }
}

export const contextPacker = new ContextPacker();