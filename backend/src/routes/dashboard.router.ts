import { Router, Request, Response, NextFunction } from 'express';
import { projectDashboardService as defaultDashboardService } from '../services/dashboard/project-dashboard.service.js';
import { ProjectDashboardService } from '../services/dashboard/dashboard.types.js';
import { validateRequest } from '../middleware/validate.js';
import {
  dashboardParamsSchema,
  dashboardQuerySchema,
  DashboardQueryDto
} from '../validation/dashboard.schema.js';

export function createDashboardRouter(
  service: ProjectDashboardService = defaultDashboardService
): Router {
  const router = Router();

  // GET /projects/:projectId/dashboard
  // Returns deterministic read-only composed project overview dashboard
  router.get(
    '/projects/:projectId/dashboard',
    validateRequest({
      params: dashboardParamsSchema,
      query: dashboardQuerySchema
    }),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId } = req.params;
        const query = req.query as unknown as DashboardQueryDto;

        const dashboard = service.getDashboard(projectId, {
          asOfDate: query.asOfDate,
          recentLimit: query.recentLimit,
          recentDays: query.recentDays,
          approachingDays: query.approachingDays
        });

        res.status(200).json(dashboard);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const dashboardRouter: Router = createDashboardRouter();
