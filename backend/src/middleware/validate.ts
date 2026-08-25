import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export interface RequestValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Express middleware for validating request body, query params, and route params using Zod.
 */
export function validateRequest(schemas: RequestValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(error);
      } else {
        next(error);
      }
    }
  };
}

export function validateBody<T>(schema: ZodSchema<T>) {
  return validateRequest({ body: schema });
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return validateRequest({ query: schema });
}

export function validateParams<T>(schema: ZodSchema<T>) {
  return validateRequest({ params: schema });
}
