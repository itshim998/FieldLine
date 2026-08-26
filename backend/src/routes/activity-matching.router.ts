import { Router, Request, Response, NextFunction } from 'express';
import {
  ActivityMatchingService,
  activityMatchingService as defaultMatchingService
} from '../services/matching/activity-matching.service.js';
import { validateRequest, validateParams } from '../middleware/validate.js';
import {
  matchProgressUpdateParamsSchema,
  matchProgressUpdateRequestSchema
} from '../validation/activity-matching.schema.js';

export function createActivityMatchingRouter(
  service: ActivityMatchingService = defaultMatchingService
): Router {
  const router = Router();

  // POST /projects/:projectId/progress-updates/:updateId/matches
  // Matches structured field facts against project activities and persists suggestions
  router.post(
    '/projects/:projectId/progress-updates/:updateId/matches',
    validateRequest({
      params: matchProgressUpdateParamsSchema,
      body: matchProgressUpdateRequestSchema
    }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId, updateId } = req.params;
        const { extraction } = req.body;

        const result = await service.matchProgressUpdate(projectId, updateId, extraction, {
          persist: true
        });

        res.status(200).json({ matches: result.matches });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId/progress-updates/:updateId/matches
  // Retrieves previously persisted match suggestions for a specific progress update
  router.get(
    '/projects/:projectId/progress-updates/:updateId/matches',
    validateParams(matchProgressUpdateParamsSchema),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId, updateId } = req.params;
        const matches = service.getMatchesForUpdate(projectId, updateId);

        res.status(200).json({ matches });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const activityMatchingRouter: Router = createActivityMatchingRouter();
