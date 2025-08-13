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

  // Log completion when response finishes
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    logger.info('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      userId: req.headers['x-user-id'],
      ip: req.ip,
    });
  });

  next();
}