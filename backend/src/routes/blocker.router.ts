import { Router, Request, Response, NextFunction } from 'express';
import {
  blockerService as defaultBlockerService,
  BlockerService
} from '../services/blocker/blocker.service.js';
import { validateRequest } from '../middleware/validate.js';
import { requireRole } from '../middleware/auth.middleware.js';
import {
  blockerParamsSchema,
  blockerQuerySchema,
  createBlockerSchema,
  resolveBlockerSchema,
  reportHazardSchema,
  BlockerParamsDto,
  BlockerQueryDto,
  CreateBlockerDto,
  ResolveBlockerDto,
  ReportHazardDto
} from '../validation/blocker.schema.js';

export function createBlockerRouter(service: BlockerService = defaultBlockerService): Router {
  const router = Router();

  // POST /projects/:projectId/blockers
  // Report operational blocker with human attribution
  router.post(
    '/projects/:projectId/blockers',
    requireRole(['worker', 'admin']),
    validateRequest({
      params: blockerParamsSchema,
      body: createBlockerSchema
    }),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId } = req.params as unknown as BlockerParamsDto;
        const body = req.body as CreateBlockerDto;

        const blocker = service.reportBlocker(projectId, body, req.session);
        res.status(201).json({ blocker });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId/blockers
  // List blockers for project with optional status / activity filter
  router.get(
    '/projects/:projectId/blockers',
    requireRole(['worker', 'admin']),
    validateRequest({
      params: blockerParamsSchema,
      query: blockerQuerySchema
    }),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId } = req.params as unknown as BlockerParamsDto;
        const query = req.query as unknown as BlockerQueryDto;

        const blockers = service.listByProject(projectId, query);
        res.status(200).json({ blockers });
      } catch (error) {
        next(error);
      }
    }
  );

  // PATCH /projects/:projectId/blockers/:id/resolve
  // Mark an operational blocker as resolved
  router.patch(
    '/projects/:projectId/blockers/:id/resolve',
    requireRole(['worker', 'admin']),
    validateRequest({
      params: blockerParamsSchema,
      body: resolveBlockerSchema
    }),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId, id } = req.params as unknown as BlockerParamsDto;
        const body = req.body as ResolveBlockerDto;

        const blocker = service.resolveBlocker(projectId, id!, body, req.session);
        res.status(200).json({ blocker });
      } catch (error) {
        next(error);
      }
    }
  );

  // POST /projects/:projectId/safety/hazards
  // Report site safety hazard / near miss observation
  const handleReportHazard = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const { projectId } = req.params as unknown as BlockerParamsDto;
      const body = req.body as ReportHazardDto;

      const event = service.reportSafetyHazard(projectId, body, req.session);
      res.status(201).json({ event });
    } catch (error) {
      next(error);
    }
  };

  router.post(
    '/projects/:projectId/safety/hazards',
    requireRole(['worker', 'admin']),
    validateRequest({
      params: blockerParamsSchema,
      body: reportHazardSchema
    }),
    handleReportHazard
  );

  router.post(
    '/projects/:projectId/safety-hazards',
    requireRole(['worker', 'admin']),
    validateRequest({
      params: blockerParamsSchema,
      body: reportHazardSchema
    }),
    handleReportHazard
  );

  return router;
}

export const blockerRouter: Router = createBlockerRouter();
