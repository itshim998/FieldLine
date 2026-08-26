import { Router, Request, Response, NextFunction } from 'express';
import {
  FieldProgressExtractionService,
  fieldProgressExtractionService as defaultExtractionService
} from '../ai/services/field-progress-extraction.service.js';
import { validateBody } from '../middleware/validate.js';
import { extractFieldProgressRequestSchema } from '../validation/ai.schema.js';

export function createAiRouter(
  extractionService: FieldProgressExtractionService = defaultExtractionService
): Router {
  const router = Router();

  // POST /ai/field-progress/extract - Extract structured field facts from raw report text
  router.post(
    '/ai/field-progress/extract',
    validateBody(extractFieldProgressRequestSchema),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { rawText } = req.body;
        const extraction = await extractionService.extractFromReport(rawText);

        res.status(200).json({ extraction });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const aiRouter: Router = createAiRouter();
