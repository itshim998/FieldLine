import { Router, Request, Response, NextFunction } from 'express';
import { projectIntelligenceService as defaultIntelligenceService } from '../services/intelligence/project-intelligence.service.js';
import { ProjectIntelligenceService } from '../services/intelligence/project-intelligence.types.js';
import { validateRequest } from '../middleware/validate.js';
import { optionalAuthenticateSession } from '../middleware/auth.middleware.js';
import {
  intelligenceParamsSchema,
  intelligenceQuerySchema,
  IntelligenceQueryDto
} from '../validation/intelligence.schema.js';

export function createIntelligenceRouter(
  service: ProjectIntelligenceService = defaultIntelligenceService
): Router {
  const router = Router();

  // GET /projects/:projectId/intelligence
  // Returns deterministic read-only structured project intelligence facts
  router.get(
    '/projects/:projectId/intelligence',
    optionalAuthenticateSession,
    validateRequest({
      params: intelligenceParamsSchema,
      query: intelligenceQuerySchema
    }),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId } = req.params;
        const query = req.query as unknown as IntelligenceQueryDto;

        const intelligence = service.getIntelligence(projectId, {
          asOfDate: query.asOfDate,
          recentDays: query.recentDays,
          approachingDays: query.approachingDays,
          limit: query.limit
        });

        res.status(200).json(intelligence);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const intelligenceRouter: Router = createIntelligenceRouter();
