import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation Error',
      details: err.issues
    });
    return;
  }

  const statusCode = (err as any).statusCode || 500;
  const message = err.message || 'Internal Server Error';

  if (process.env.NODE_ENV !== 'test') {
    console.error('Unhandled Server Error:', err);
  }

  res.status(statusCode).json({
    error: message,
    status: statusCode
  });
}
