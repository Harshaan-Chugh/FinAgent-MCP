import { logger } from '../utils/logger';

export interface EvidenceItem {
  table: string;
  id: string;
  fields: string[];
  metadata?: {
    aggregationType?: 'sum' | 'count' | 'avg' | 'max' | 'min';
    groupBy?: string;
    filters?: Record<string, any>;
    dateRange?: {
      start: string;
      end: string;
    };
  };
}

export interface EvidencePackage {
  query: string;
  evidence: EvidenceItem[];
  aggregations: AggregationSummary[];
  dataLineage: DataLineageInfo;
  auditTrail: AuditTrailEntry[];
  metadata: {
    totalRecords: number;
    uniqueTables: string[];
    confidenceScore: number;
    timestamp: string;
    toolsUsed: string[];
  };
}

export interface AggregationSummary {
  table: string;
  operation: string;
  field: string;
  value: number;
  count: number;
  groupBy?: string;
}

export interface DataLineageInfo {
  sources: {
    name: string;
    type: 'database' | 'api' | 'cache';
    lastRefresh: string;
    recordCount: number;
  }[];
  transformations: string[];
  dependencies: string[];
}

export interface AuditTrailEntry {
  action: string;
  timestamp: string;
  userId: string;
  tool: string;
  parameters: Record<string, any>;
  recordsAffected: number;
}

export interface EvidenceBuildingOptions {
  toolName: string;
  userId: string;
  timestamp: string;
  includeAggregations?: boolean;
  includeLineage?: boolean;
  includeAuditTrail?: boolean;
  confidenceThreshold?: number;
}

class EvidenceBuilder {
  build(data: any, options: EvidenceBuildingOptions): EvidencePackage {
    try {
      logger.debug('Building evidence package', {
        toolName: options.toolName,
        userId: options.userId,
        dataType: typeof data,
        includeAggregations: options.includeAggregations,
      });

      // Initialize evidence package
      const evidencePackage: EvidencePackage = {
        query: this.generateQueryDescription(options.toolName, data),
        evidence: [],
        aggregations: [],
        dataLineage: this.buildDataLineage(data, options),
        auditTrail: [],
        metadata: {
          totalRecords: 0,
          uniqueTables: [],
          confidenceScore: 0,
          timestamp: options.timestamp,
          toolsUsed: [options.toolName],
        },
      };

      // Extract evidence from data
      if (Array.isArray(data)) {
        evidencePackage.evidence = this.extractEvidenceFromArray(data);
        evidencePackage.metadata.totalRecords = data.length;
      } else if (data && typeof data === 'object') {
        evidencePackage.evidence = this.extractEvidenceFromObject(data);
        evidencePackage.metadata.totalRecords = 1;
      }

      // Build aggregations if requested
      if (options.includeAggregations && Array.isArray(data)) {
        evidencePackage.aggregations = this.buildAggregations(data);
      }

      // Build audit trail if requested
      if (options.includeAuditTrail) {
        evidencePackage.auditTrail = this.buildAuditTrail(options);
      }

      // Calculate metadata
      evidencePackage.metadata.uniqueTables = [...new Set(
        evidencePackage.evidence.map(item => item.table)
      )];
      
      evidencePackage.metadata.confidenceScore = this.calculateConfidenceScore(
        evidencePackage,
        options.confidenceThreshold || 0.8
      );

      return evidencePackage;
    } catch (error: any) {
      logger.error('Failed to build evidence package', {
        error: error.message,
        toolName: options.toolName,
        userId: options.userId,
      });

      // Return minimal evidence package on error
      return {
        query: options.toolName,
        evidence: [],
        aggregations: [],
        dataLineage: { sources: [], transformations: [], dependencies: [] },
        auditTrail: [],
        metadata: {
          totalRecords: 0,
          uniqueTables: [],
          confidenceScore: 0,
          timestamp: options.timestamp,
          toolsUsed: [options.toolName],
        },
      };
    }
  }

  private extractEvidenceFromArray(data: any[]): EvidenceItem[] {
    const evidence: EvidenceItem[] = [];
    
    for (const item of data) {
      const evidenceItem = this.extractEvidenceFromObject(item);
      evidence.push(...evidenceItem);
    }
    
    return evidence;
  }

  private extractEvidenceFromObject(data: any): EvidenceItem[] {
    if (!data || typeof data !== 'object') {
      return [];
    }

    // Determine table name based on object structure
    let tableName = 'unknown';
    let itemId = data.id || data._id || 'unknown';
    let fields: string[] = [];

    // Identify data type and extract relevant fields
    if (data.amount !== undefined && data.date) {
      // Transaction-like data
      tableName = data.investment_transaction_id ? 'investment_transactions' : 'transactions';
      fields = ['id', 'date', 'amount', 'merchant_name', 'category', 'account_id'];
    } else if (data.balance_current !== undefined || data.balance_available !== undefined) {
      // Account data
      tableName = 'accounts';
      fields = ['id', 'name', 'type', 'subtype', 'balance_current'];
    } else if (data.quantity !== undefined && data.symbol) {
      // Holding or position data
      tableName = data.security_id ? 'holdings' : 'crypto_positions';
      fields = data.security_id 
        ? ['id', 'symbol', 'quantity', 'institution_value', 'account_id']
        : ['id', 'symbol', 'quantity', 'market_value'];
    } else if (data.side && data.quantity) {
      // Order data
      tableName = 'crypto_orders';
      fields = ['id', 'symbol', 'side', 'quantity', 'status', 'dry_run'];
    }

    // Filter fields to only include those present in the data
    const presentFields = fields.filter(field => data[field] !== undefined);

    return [{
      table: tableName,
      id: String(itemId),
      fields: presentFields.length > 0 ? presentFields : Object.keys(data).slice(0, 5),
    }];
  }

  private buildAggregations(data: any[]): AggregationSummary[] {
    const aggregations: AggregationSummary[] = [];
    
    if (data.length === 0) return aggregations;

    // Detect data type and create appropriate aggregations
    const firstItem = data[0];
    
    if (firstItem.amount !== undefined) {
      // Transaction or order data
      const tableName = firstItem.investment_transaction_id ? 'investment_transactions' : 
                       firstItem.side ? 'crypto_orders' : 'transactions';
      
      // Sum of amounts
      const totalAmount = data.reduce((sum, item) => sum + Math.abs(item.amount || 0), 0);
      aggregations.push({
        table: tableName,
        operation: 'sum',
        field: 'amount',
        value: Math.round(totalAmount * 100) / 100,
        count: data.length,
      });

      // Count by category (if available)
      if (firstItem.category) {
        const categoryCounts = data.reduce((acc, item) => {
          const category = Array.isArray(item.category) ? item.category[0] : item.category;
          acc[category] = (acc[category] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        Object.entries(categoryCounts).forEach(([category, count]) => {
          aggregations.push({
            table: tableName,
            operation: 'count',
            field: 'category',
            value: count,
            count: data.length,
            groupBy: category,
          });
        });
      }
    }

    if (firstItem.quantity !== undefined && firstItem.market_value) {
      // Position data
      const totalValue = data.reduce((sum, item) => sum + (item.market_value || 0), 0);
      aggregations.push({
        table: 'crypto_positions',
        operation: 'sum',
        field: 'market_value',
        value: Math.round(totalValue * 100) / 100,
        count: data.length,
      });
    }

    if (firstItem.institution_value) {
      // Holdings data
      const totalValue = data.reduce((sum, item) => sum + (item.institution_value || 0), 0);
      aggregations.push({
        table: 'holdings',
        operation: 'sum',
        field: 'institution_value',
        value: Math.round(totalValue * 100) / 100,
        count: data.length,
      });
    }

    return aggregations;
  }

  private buildDataLineage(data: any, options: EvidenceBuildingOptions): DataLineageInfo {
    const lineage: DataLineageInfo = {
      sources: [],
      transformations: [],
      dependencies: ['go-ingestion-service'],
    };

    // Add primary data source
    lineage.sources.push({
      name: 'finagent-database',
      type: 'database',
      lastRefresh: options.timestamp,
      recordCount: Array.isArray(data) ? data.length : 1,
    });

    // Add transformations based on tool type
    const transformations: string[] = [];
    
    if (options.toolName.includes('summary')) {
      transformations.push('aggregation', 'grouping');
    }
    
    if (options.toolName.includes('crypto')) {
      transformations.push('price_calculation', 'pnl_calculation');
      lineage.dependencies.push('robinhood-api');
    }
    
    if (options.toolName.includes('investment') || options.toolName.includes('holdings')) {
      transformations.push('valuation', 'performance_metrics');
      lineage.dependencies.push('plaid-api');
    }

    lineage.transformations = transformations;

    return lineage;
  }

  private buildAuditTrail(options: EvidenceBuildingOptions): AuditTrailEntry[] {
    return [{
      action: `execute_tool_${options.toolName}`,
      timestamp: options.timestamp,
      userId: options.userId,
      tool: options.toolName,
      parameters: {}, // Would include actual parameters in real implementation
      recordsAffected: 0, // Would be calculated based on actual operation
    }];
  }

  private calculateConfidenceScore(evidence: EvidencePackage, threshold: number): number {
    let score = 0;

    // Base score from data completeness
    if (evidence.evidence.length > 0) {
      score += 0.4;
    }

    // Bonus for having multiple data sources
    if (evidence.metadata.uniqueTables.length > 1) {
      score += 0.2;
    }

    // Bonus for having aggregations
    if (evidence.aggregations.length > 0) {
      score += 0.2;
    }

    // Bonus for data freshness (within last hour)
    const timestamp = new Date(evidence.metadata.timestamp);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (timestamp > hourAgo) {
      score += 0.2;
    }

    return Math.min(1, score);
  }

  private generateQueryDescription(toolName: string, data: any): string {
    const recordCount = Array.isArray(data) ? data.length : 1;
    
    const descriptions: Record<string, string> = {
      'list_accounts': `Retrieved ${recordCount} financial accounts`,
      'list_transactions': `Retrieved ${recordCount} financial transactions`,
      'spending_summary': `Generated spending analysis from ${recordCount} transactions`,
      'get_holdings': `Retrieved ${recordCount} investment holdings`,
      'get_investment_transactions': `Retrieved ${recordCount} investment transactions`,
      'get_crypto_positions': `Retrieved ${recordCount} cryptocurrency positions`,
      'place_crypto_order': `Placed cryptocurrency order`,
    };

    return descriptions[toolName] || `Executed ${toolName} returning ${recordCount} records`;
  }
}

export const evidenceBuilder = new EvidenceBuilder();