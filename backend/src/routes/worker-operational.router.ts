import { Router, Request, Response, NextFunction } from 'express';
import {
  workerOperationalService as defaultService,
  WorkerOperationalService
} from '../services/worker/worker-operational.service.js';
import { validateRequest } from '../middleware/validate.js';
import { requireRole } from '../middleware/auth.middleware.js';
import {
  workerOperationalParamsSchema,
  workerOperationalQuerySchema,
  workerQuickReportSchema,
  WorkerOperationalParamsDto,
  WorkerOperationalQueryDto,
  WorkerQuickReportDto
} from '../validation/worker-operational.schema.js';

export function createWorkerOperationalRouter(
  service: WorkerOperationalService = defaultService
): Router {
  const router = Router();

  // GET /projects/:projectId/worker/operational-tasks
  // Protected operational projection endpoint for Worker & Admin sessions
  router.get(
    '/projects/:projectId/worker/operational-tasks',
    requireRole(['worker', 'admin']),
    validateRequest({
      params: workerOperationalParamsSchema,
      query: workerOperationalQuerySchema
    }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId } = req.params as unknown as WorkerOperationalParamsDto;
        const query = req.query as unknown as WorkerOperationalQueryDto;

        const result = await service.getOperationalTasks(projectId, query);
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  // POST /projects/:projectId/worker/quick-report
  // Protected rapid capture endpoint for Worker & Admin sessions
  router.post(
    '/projects/:projectId/worker/quick-report',
    requireRole(['worker', 'admin']),
    validateRequest({
      params: workerOperationalParamsSchema,
      body: workerQuickReportSchema
    }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId } = req.params as unknown as WorkerOperationalParamsDto;
        const body = req.body as WorkerQuickReportDto;

        const result = await service.recordQuickReport(projectId, body);
        res.status(result.status === 'confirmed' ? 201 : 200).json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const workerOperationalRouter: Router = createWorkerOperationalRouter();

