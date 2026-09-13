import { Router, Request, Response, NextFunction } from 'express';
import { activityDetailService as defaultActivityDetailService } from '../services/activity-detail/activity-detail.service.js';
import { ActivityDetailService } from '../services/activity-detail/activity-detail.types.js';
import { validateRequest } from '../middleware/validate.js';
import { optionalAuthenticateSession } from '../middleware/auth.middleware.js';
import { sanitizeMatchForRole } from './activity-matching.router.js';
import {
  activityDetailParamsSchema,
  activityDetailQuerySchema,
  ActivityDetailQueryDto
} from '../validation/activity-detail.schema.js';

export function createActivityDetailRouter(
  service: ActivityDetailService = defaultActivityDetailService
): Router {
  const router = Router();

  // GET /projects/:projectId/activities/:activityId
  // Returns the complete read-only activity detail model (with worker data projection)
  router.get(
    '/projects/:projectId/activities/:activityId',
    optionalAuthenticateSession,
    validateRequest({
      params: activityDetailParamsSchema,
      query: activityDetailQuerySchema
    }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId, activityId } = req.params;
        const query = req.query as unknown as ActivityDetailQueryDto;

        const detail = await service.getActivityDetail(projectId, activityId, {
          asOfDate: query.asOfDate
        });

        if (req.session?.accountType === 'worker' && detail.matches) {
          detail.matches = detail.matches.map((m) => sanitizeMatchForRole(m, 'worker'));
        }

        res.status(200).json(detail);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const activityDetailRouter: Router = createActivityDetailRouter();
