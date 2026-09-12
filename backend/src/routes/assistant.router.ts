import { Router, Request, Response, NextFunction } from 'express';
import {
  AssistantService,
  assistantService as defaultAssistantService
} from '../services/assistant/assistant.service.js';
import { validateRequest } from '../middleware/validate.js';
import { optionalAuthenticateSession } from '../middleware/auth.middleware.js';
import { ForbiddenError } from '../errors/AppError.js';
import {
  assistantParamsSchema,
  assistantBodySchema,
  AssistantBodyDto
} from '../validation/assistant.schema.js';

export function createAssistantRouter(
  service: AssistantService = defaultAssistantService
): Router {
  const router = Router();

  // POST /projects/:projectId/assistant/query
  // Answers natural-language project intelligence queries grounded strictly in project facts
  router.post(
    '/projects/:projectId/assistant/query',
    optionalAuthenticateSession,
    validateRequest({
      params: assistantParamsSchema,
      body: assistantBodySchema
    }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId } = req.params;
        const body = req.body as AssistantBodyDto;

        let role: 'worker' | 'admin' | undefined;

        if (req.session) {
          // Strict project scope check: session must match route param
          if (req.session.projectId !== projectId) {
            throw new ForbiddenError(
              `Project scope mismatch: Session project '${req.session.projectId}' cannot access project '${projectId}'`
            );
          }

          // Role enforcement: Worker accounts can NEVER escalate to admin queries
          if (req.session.accountType === 'worker') {
            if (body.role === 'admin') {
              throw new ForbiddenError(
                "Forbidden: Worker account cannot escalate to admin project intelligence queries"
              );
            }
            role = 'worker';
          } else {
            role = body.role || req.session.accountType;
          }
        } else {
          role = body.role;
        }

        const response = await service.answerQuestion(projectId, body.question, {
          asOfDate: body.asOfDate,
          role,
          userName: req.session?.displayName || (role === 'worker' ? 'Refinery Operations Crew' : undefined),
          userRole: role === 'worker' ? 'Field Operations Crew' : 'Field Engineer'
        });

        res.status(200).json(response);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const assistantRouter: Router = createAssistantRouter();
