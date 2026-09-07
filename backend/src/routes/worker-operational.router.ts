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
  WorkerOperationalParamsDto,
  WorkerOperationalQueryDto
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
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId } = req.params as unknown as WorkerOperationalParamsDto;
        const query = req.query as unknown as WorkerOperationalQueryDto;

        const result = service.getOperationalTasks(projectId, query);
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const workerOperationalRouter: Router = createWorkerOperationalRouter();
