import { Router, Request, Response, NextFunction } from 'express';
import {
  ProgressSnapshotService,
  progressSnapshotService as defaultSnapshotService
} from '../services/snapshot/progress-snapshot.service.js';
import { validateRequest } from '../middleware/validate.js';
import {
  progressSnapshotParamsSchema,
  progressSnapshotQuerySchema
} from '../validation/progress-snapshot.schema.js';

export function createProgressSnapshotRouter(
  service: ProgressSnapshotService = defaultSnapshotService
): Router {
  const router = Router();

  // GET /projects/:projectId/progress-snapshot
  // Returns deterministic read-only planned vs actual progress snapshot as of snapshot date
  router.get(
    '/projects/:projectId/progress-snapshot',
    validateRequest({
      params: progressSnapshotParamsSchema,
      query: progressSnapshotQuerySchema
    }),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId } = req.params;
        const asOfDate = req.query.asOfDate as string | undefined;

        const snapshot = service.getProgressSnapshot(projectId, asOfDate);

        res.status(200).json(snapshot);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const progressSnapshotRouter: Router = createProgressSnapshotRouter();
