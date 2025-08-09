import { NodeSDK } from '@opentelemetry/sdk-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { trace, SpanStatusCode } from '@opentelemetry/api';

import { config } from '../config';
import { logger } from './logger';

let sdk: NodeSDK | null = null;

export function initializeTracing(): void {
  try {
    // Create Jaeger exporter
    const jaegerExporter = new JaegerExporter({
      endpoint: config.jaegerEndpoint,
    });

    // Initialize the SDK
    sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'finagent-mcp-server',
        [SemanticResourceAttributes.SERVICE_VERSION]: '0.1.0',
      }),
      traceExporter: jaegerExporter,
      instrumentations: [
        new HttpInstrumentation({
          requestHook: (span, request) => {
            span.setAttributes({
              'http.request.header.user_agent': request.getHeader?.('user-agent') || 'unknown',
              'http.request.header.x_user_id': request.getHeader?.('x-user-id') || 'unknown',
            });
          },
        }),
        new ExpressInstrumentation(),
      ],
    });

    sdk.start();
    logger.info('Tracing initialized with Jaeger exporter');
  } catch (error) {
    logger.error('Failed to initialize tracing:', error);
  }
}

export function createSpan(name: string, attributes?: Record<string, any>) {
  const tracer = trace.getTracer('finagent-mcp-server');
  return tracer.startSpan(name, {
    attributes,
  });
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
      return result
        .then((value) => {
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return value;
        })
        .catch((error) => {
          span.recordException(error);
          span.setStatus({ 
            code: SpanStatusCode.ERROR, 
            message: error.message 
          });
          span.end();
          throw error;
        });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return Promise.resolve(result);
    }
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ 
      code: SpanStatusCode.ERROR, 
      message: (error as Error).message 
    });
    span.end();
    throw error;
  }
}

export function shutdown(): Promise<void> {
  return new Promise((resolve) => {
    if (sdk) {
      sdk.shutdown()
        .then(() => {
          logger.info('Tracing SDK shut down successfully');
          resolve();
        })
        .catch((error) => {
          logger.error('Error shutting down tracing SDK:', error);
          resolve();
        });
    } else {
      resolve();
    }
  });
}