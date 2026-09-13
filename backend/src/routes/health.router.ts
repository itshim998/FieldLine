import { Router, Request, Response, NextFunction } from 'express';
import { healthService, HealthService } from '../services/health.service.js';
import { healthResponseSchema } from '../validation/health.schema.js';

export function createHealthRouter(service: HealthService = healthService): Router {
  const router = Router();

  router.get('/health', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await service.getHealthStatus();

      // Validate output payload contract against schema
      const parsed = healthResponseSchema.safeParse(payload);
      if (!parsed.success) {
        res.status(500).json({
          error: 'Health check response failed schema validation',
          statusCode: 500,
          code: 'SCHEMA_VALIDATION_ERROR',
          issues: parsed.error.issues
        });
        return;
      }

      const statusCode = parsed.data.status === 'ok' ? 200 : 503;
      res.status(statusCode).json(parsed.data);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const healthRouter: Router = createHealthRouter();
