import { Router, Request, Response, NextFunction } from 'express';
import { progressUpdateService, ProgressUpdateService } from '../services/progress-update.service.js';
import { validateRequest, validateParams } from '../middleware/validate.js';
import { requireRole, optionalAuthenticateSession } from '../middleware/auth.middleware.js';
import {
  createProgressUpdateSchema,
  progressUpdateProjectIdParamSchema,
  progressUpdateParamsSchema
} from '../validation/progress-update.schema.js';

export function createProgressUpdateRouter(service: ProgressUpdateService = progressUpdateService): Router {
  const router = Router();

  // POST /projects/:projectId/progress-updates - Record a new manual field progress update (Worker & Admin)
  router.post(
    '/projects/:projectId/progress-updates',
    requireRole(['worker', 'admin']),
    validateRequest({
      params: progressUpdateProjectIdParamSchema,
      body: createProgressUpdateSchema
    }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId } = req.params;
        const { reportDate, rawText, reporterName, reporterRole } = req.body;

        const result = await service.createAndProcessManualUpdate({
          projectId,
          reportDate,
          rawText,
          reporterName,
          reporterRole
        });

        res.status(201).json({
          progressUpdate: result.progressUpdate,
          matches: result.matches
        });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId/progress-updates - List all progress updates for a project (newest-first)
  router.get(
    '/projects/:projectId/progress-updates',
    optionalAuthenticateSession,
    validateParams(progressUpdateProjectIdParamSchema),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId } = req.params;
        const progressUpdates = service.listProjectUpdates(projectId);
        res.status(200).json({ progressUpdates });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId/progress-updates/:updateId - Retrieve a single progress update by ID (project-scoped)
  router.get(
    '/projects/:projectId/progress-updates/:updateId',
    optionalAuthenticateSession,
    validateParams(progressUpdateParamsSchema),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId, updateId } = req.params;
        const progressUpdate = service.getProjectUpdate(projectId, updateId);
        res.status(200).json({ progressUpdate });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const progressUpdateRouter: Router = createProgressUpdateRouter();
