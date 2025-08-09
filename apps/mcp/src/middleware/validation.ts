import { Request, Response, NextFunction } from 'express';
import { toolRegistry } from '../core/registry';
import { createError } from './errorHandler';

export function validateToolRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const { toolName } = req.params;
    
    if (!toolName) {
      throw createError('Tool name is required', 400);
    }

    // Check if tool exists
    const tool = toolRegistry.getTool(toolName);
    if (!tool) {
      throw createError(`Tool '${toolName}' not found`, 404);
    }

    // Validate input against schema
    if (tool.inputSchema) {
      try {
        tool.inputSchema.parse(req.body);
      } catch (error: any) {
        throw createError(`Invalid input: ${error.message}`, 400);
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}