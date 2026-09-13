import { Router, Request, Response, NextFunction } from 'express';
import {
  RiskClassificationService,
  riskClassificationService as defaultRiskService
} from '../services/risk/risk-classification.service.js';
import { validateRequest } from '../middleware/validate.js';
import { optionalAuthenticateSession } from '../middleware/auth.middleware.js';
import {
  riskStatusParamsSchema,
  riskStatusQuerySchema
} from '../validation/risk.schema.js';

export function createRiskRouter(
  service: RiskClassificationService = defaultRiskService
): Router {
  const router = Router();

  // GET /projects/:projectId/risk-status
  // Returns deterministic read-only delay and risk classification for project activities
  router.get(
    '/projects/:projectId/risk-status',
    optionalAuthenticateSession,
    validateRequest({
      params: riskStatusParamsSchema,
      query: riskStatusQuerySchema
    }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId } = req.params;
        const asOfDate = req.query.asOfDate as string | undefined;

        const result = await service.getProjectRiskStatus(projectId, asOfDate);

        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const riskRouter: Router = createRiskRouter();
