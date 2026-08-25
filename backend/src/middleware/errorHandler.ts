import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // 1. Zod Schema Validation Errors
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation Error',
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      details: err.issues
    });
    return;
  }

  // 2. Controlled Domain/Application Errors
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(`AppError [${err.code}]: ${err.message}`, err);
    }
    res.status(err.statusCode).json({
      error: err.message,
      statusCode: err.statusCode,
      code: err.code,
      ...(err.details !== undefined ? { details: err.details } : {})
    });
    return;
  }

  // 3. Fallback for unexpected runtime errors
  const errorObj = err instanceof Error ? err : new Error(String(err));
  logger.error(`Unhandled Server Error: ${errorObj.message}`, errorObj);

  res.status(500).json({
    error: 'Internal Server Error',
    statusCode: 500,
    code: 'INTERNAL_SERVER_ERROR'
  });
}
