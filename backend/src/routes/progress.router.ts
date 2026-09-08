import { Router, Request, Response, NextFunction } from 'express';
import {
  ProgressService,
  progressService as defaultProgressService
} from '../services/progress/progress.service.js';
import { validateRequest, validateParams } from '../middleware/validate.js';
import { optionalAuthenticateSession } from '../middleware/auth.middleware.js';
import {
  normalizeProgressParamsSchema,
  normalizeProgressRequestSchema,
  activityProgressParamsSchema
} from '../validation/progress-normalization.schema.js';

export function createProgressRouter(
  service: ProgressService = defaultProgressService
): Router {
  const router = Router();

  // POST /projects/:projectId/progress-updates/:updateId/progress
  // Deterministically normalizes structured field fact into canonical ActivityProgress
  router.post(
    '/projects/:projectId/progress-updates/:updateId/progress',
    optionalAuthenticateSession,
    validateRequest({
      params: normalizeProgressParamsSchema,
      body: normalizeProgressRequestSchema
    }),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId, updateId } = req.params;
        const { matchId, fact, actualQuantity, quantityUnit, asOfDate, allowSuggested } = req.body;

        const progress = service.normalizeAndRecordProgress({
          projectId,
          updateId,
          matchId,
          fact,
          actualQuantity,
          quantityUnit,
          asOfDate,
          allowSuggested
        });

        res.status(200).json({ progress });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId/activities/:activityId/progress
  // Retrieves chronological observation history for an activity
  router.get(
    '/projects/:projectId/activities/:activityId/progress',
    optionalAuthenticateSession,
    validateParams(activityProgressParamsSchema),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId, activityId } = req.params;
        const progress = service.listActivityProgress(projectId, activityId);

        res.status(200).json({ progress });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId/activities/:activityId/progress/latest
  // Retrieves latest canonical observation for an activity
  router.get(
    '/projects/:projectId/activities/:activityId/progress/latest',
    optionalAuthenticateSession,
    validateParams(activityProgressParamsSchema),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId, activityId } = req.params;
        const progress = service.getLatestActivityProgress(projectId, activityId);

        res.status(200).json({ progress });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const progressRouter: Router = createProgressRouter();
