import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  
  // Log request start
  logger.info('Request started', {
    method: req.method,
    path: req.path,
    userId: req.headers['x-user-id'],
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });

  // Override res.end to log completion
  const originalEnd = res.end;
  res.end = function(chunk: any, encoding?: any) {
    const duration = Date.now() - start;
    
    logger.info('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      userId: req.headers['x-user-id'],
      ip: req.ip,
    });

    // Call the original end method
    originalEnd.call(this, chunk, encoding);
  };

  next();
}