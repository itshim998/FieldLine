import { Router, Request, Response, NextFunction } from 'express';
import {
  AssistantService,
  assistantService as defaultAssistantService
} from '../services/assistant/assistant.service.js';
import { validateRequest } from '../middleware/validate.js';
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
    validateRequest({
      params: assistantParamsSchema,
      body: assistantBodySchema
    }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId } = req.params;
        const body = req.body as AssistantBodyDto;

        const response = await service.answerQuestion(projectId, body.question, {
          asOfDate: body.asOfDate
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
