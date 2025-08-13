import { z } from 'zod';
import { logger } from '../utils/logger';
import { withSpan } from '../utils/tracing';

// Import working tools only
import { listAccountsTool } from '../tools/plaid/listAccounts';
import { getCryptoPositionsTool } from '../tools/robinhood/getCryptoPositions';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<any>;
  handler: (args: any, context: { userId: string }) => Promise<any>;
  metadata?: {
    category: 'banking' | 'investments' | 'crypto' | 'meta';
    requiresAuth: boolean;
    rateLimit?: {
      requests: number;
      window: number; // in milliseconds
    };
  };
}

export interface ToolMetrics {
  name: string;
  callCount: number;
  totalLatency: number;
  avgLatency: number;
  errorCount: number;
  lastCalled?: Date;
}

class ToolRegistry {
  private tools: Map<string, MCPTool> = new Map();
  private metrics: Map<string, ToolMetrics> = new Map();

  constructor() {
    this.registerTools();
  }

  private registerTools() {
    const toolsToRegister = [
      // Banking tools
      listAccountsTool,
      
      // Crypto tools  
      getCryptoPositionsTool,
    ];

    for (const tool of toolsToRegister) {
      this.register(tool);
    }

    logger.info(`Registered ${this.tools.size} MCP tools`);
  }

  register(tool: MCPTool) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' is already registered`);
    }

    this.tools.set(tool.name, tool);
    this.metrics.set(tool.name, {
      name: tool.name,
      callCount: 0,
      totalLatency: 0,
      avgLatency: 0,
      errorCount: 0,
    });

    logger.debug(`Registered tool: ${tool.name}`);
  }

  getTool(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  getTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  async execute(name: string, args: any, context: { userId: string }): Promise<any> {
    const tool = this.getTool(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }

    return withSpan(`tool.${name}`, async (span) => {
      const startTime = Date.now();
      
      try {
        // Validate input
        const validatedArgs = tool.inputSchema.parse(args);
        
        span.setAttributes({
          'tool.name': name,
          'tool.category': tool.metadata?.category || 'unknown',
          'user.id': context.userId,
          'args.keys': Object.keys(validatedArgs).join(','),
        });

        // Execute tool
        const result = await tool.handler(validatedArgs, context);
        
        // Update metrics
        this.updateMetrics(name, Date.now() - startTime, false);
        
        span.setAttributes({
          'tool.result.hasData': !!result.data,
          'tool.result.dataLength': Array.isArray(result.data) ? result.data.length : -1,
        });

        return result;
      } catch (error: any) {
        // Update error metrics
        this.updateMetrics(name, Date.now() - startTime, true);
        
        span.recordException(error);
        span.setAttributes({
          'tool.error': error.message,
        });
        
        logger.error(`Tool execution failed: ${name}`, {
          error: error.message,
          userId: context.userId,
          args: Object.keys(args),
        });
        
        throw error;
      }
    });
  }

  private updateMetrics(toolName: string, latency: number, isError: boolean) {
    const metrics = this.metrics.get(toolName);
    if (!metrics) return;

    metrics.callCount++;
    metrics.totalLatency += latency;
    metrics.avgLatency = metrics.totalLatency / metrics.callCount;
    metrics.lastCalled = new Date();
    
    if (isError) {
      metrics.errorCount++;
    }
  }

  getMetrics(): ToolMetrics[] {
    return Array.from(this.metrics.values());
  }

  getToolsByCategory(category: string): MCPTool[] {
    return Array.from(this.tools.values()).filter(
      tool => tool.metadata?.category === category
    );
  }
}

export const toolRegistry = new ToolRegistry();