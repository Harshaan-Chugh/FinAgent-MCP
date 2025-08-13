import { trace, SpanStatusCode } from '@opentelemetry/api';

import { logger } from './logger';

export function initializeTracing(): void {
  try {
    logger.info('Tracing disabled for development');
  } catch (error) {
    logger.error('Failed to initialize tracing:', error);
  }
}

export function createSpan(name: string, attributes?: Record<string, any>) {
  // No-op span for development
  return {
    setAttributes: () => {},
    setStatus: () => {},
    end: () => {},
    recordException: () => {}
  };
}

export function withSpan<T>(
  name: string,
  fn: (span: any) => Promise<T> | T,
  attributes?: Record<string, any>
): Promise<T> {
  const span = createSpan(name, attributes);
  
  try {
    const result = fn(span);
    
    if (result instanceof Promise) {
      return result;
    } else {
      return Promise.resolve(result);
    }
  } catch (error) {
    throw error;
  }
}

export function shutdown(): Promise<void> {
  return Promise.resolve();
}