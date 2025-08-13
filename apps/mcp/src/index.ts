import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { config } from './config';
import { logger } from './utils/logger';
import { initializeTracing } from './utils/tracing';
import { toolRegistry } from './core/registry';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { validateToolRequest } from './middleware/validation';
import { contextPacker } from './core/context';
import { evidenceBuilder } from './core/evidence';

// Initialize tracing
initializeTracing();

const app: express.Application = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: config.corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-User-ID'],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Body parsing and compression
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Custom middleware
app.use(requestLogger);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'finagent-mcp-server',
    version: '0.1.0'
  });
});

// MCP Tools registry endpoint
app.get('/tools', (req, res) => {
  const tools = toolRegistry.getTools();
  res.json({
    tools: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    })),
    count: tools.length
  });
});

// MCP Tool execution endpoint
app.post('/tools/:toolName', validateToolRequest, async (req, res, next) => {
  try {
    const { toolName } = req.params;
    const userId = req.headers['x-user-id'] as string;
    const args = req.body;

    if (!userId) {
      return res.status(400).json({
        error: 'User ID is required in X-User-ID header'
      });
    }

    logger.info('Executing tool', {
      tool: toolName,
      userId,
      args: Object.keys(args)
    });

    // Execute the tool
    const result = await toolRegistry.execute(toolName, args, { userId });

    // Add context information if it's a data retrieval tool
    if (result.data && Array.isArray(result.data)) {
      const contextCard = await contextPacker.pack(result.data, {
        query: `${toolName} results`,
        tokenBudget: 2500
      });

      result.context = contextCard;
    }

    // Build evidence
    const evidence = evidenceBuilder.build(result.data, {
      toolName,
      userId,
      timestamp: new Date().toISOString()
    });

    res.json({
      tool: toolName,
      success: true,
      data: result.data,
      evidence,
      meta: result.meta,
      context: result.context
    });

  } catch (error) {
    next(error);
  }
});

// Context card endpoint
app.post('/context', async (req, res, next) => {
  try {
    const { query, data, tokenBudget = 2500 } = req.body;
    
    if (!query) {
      return res.status(400).json({
        error: 'Query is required'
      });
    }

    const contextCard = await contextPacker.pack(data || [], {
      query,
      tokenBudget
    });

    res.json({
      query,
      context: contextCard,
      tokenBudget
    });

  } catch (error) {
    next(error);
  }
});

// Evidence endpoint
app.post('/evidence', (req, res, next) => {
  try {
    const { data, metadata } = req.body;
    
    const evidence = evidenceBuilder.build(data, metadata);
    
    res.json({
      evidence,
      metadata
    });

  } catch (error) {
    next(error);
  }
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  const metrics = await toolRegistry.getMetrics();
  res.json(metrics);
});

// Debug endpoint (development only)
if (config.nodeEnv === 'development') {
  app.get('/debug/last-trace', (req, res) => {
    // This would return the last trace information
    res.json({
      message: 'Debug endpoint - last trace info would go here',
      env: 'development'
    });
  });
}

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.originalUrl
  });
});

// Start server
const server = app.listen(config.port, () => {
  logger.info(`MCP server running on port ${config.port}`, {
    environment: config.nodeEnv,
    corsOrigins: config.corsOrigins,
    goServiceUrl: config.goServiceUrl
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

export { app };