import { z } from 'zod';

const configSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3001),
  goServiceUrl: z.string().default('http://localhost:8081'),
  corsOrigins: z.string().transform(val => val.split(',')).default('http://localhost:3000,http://localhost:3001'),
  redisUrl: z.string().default('redis://localhost:6379'),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  jaegerEndpoint: z.string().default('http://localhost:14268/api/traces'),
  rateLimitWindow: z.coerce.number().default(15 * 60 * 1000), // 15 minutes
  rateLimitMax: z.coerce.number().default(100),
  maxTokenBudget: z.coerce.number().default(4000),
  defaultTokenBudget: z.coerce.number().default(2500),
});

type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const env = {
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    goServiceUrl: process.env.GO_SERVICE_URL,
    corsOrigins: process.env.CORS_ORIGINS,
    redisUrl: process.env.REDIS_URL,
    logLevel: process.env.LOG_LEVEL,
    jaegerEndpoint: process.env.JAEGER_ENDPOINT,
    rateLimitWindow: process.env.RATE_LIMIT_WINDOW,
    rateLimitMax: process.env.RATE_LIMIT_MAX,
    maxTokenBudget: process.env.MAX_TOKEN_BUDGET,
    defaultTokenBudget: process.env.DEFAULT_TOKEN_BUDGET,
  };

  try {
    return configSchema.parse(env);
  } catch (error) {
    console.error('Configuration validation failed:', error);
    throw new Error('Invalid configuration');
  }
}

export const config = loadConfig();

export type { Config };