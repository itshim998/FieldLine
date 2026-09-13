import { Router, Request, Response, NextFunction } from 'express';
import { projectService, ProjectService } from '../services/project.service.js';
import { validateRequest, validateBody, validateParams } from '../middleware/validate.js';
import { requireRole, optionalAuthenticateSession } from '../middleware/auth.middleware.js';
import {
  createProjectSchema,
  updateProjectSchema,
  projectIdParamSchema
} from '../validation/project.schema.js';
import { env } from '../config/env.js';
import { seedGoldenDemo } from '../../../demo/golden-demo-seeder.js';
import { logger } from '../config/logger.js';

export function createProjectRouter(service: ProjectService = projectService): Router {
  const router = Router();

  // GET /projects - List all projects (supports ?autoSeed=true for on-demand self-healing)
  router.get('/projects', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      let projects = await service.listProjects();

      // On-demand self-healing auto-seed when requested via ?autoSeed=true
      if (projects.length === 0 && req.query.autoSeed === 'true' && env.AUTO_SEED_DEMO) {
        logger.info('🌱 Empty project list with ?autoSeed=true detected. Auto-seeding Golden Demo...');
        try {
          await seedGoldenDemo();
          projects = await service.listProjects();
        } catch (seedErr) {
          logger.error('⚠️ On-demand golden demo seeding encountered an error:', seedErr);
        }
      }

      res.status(200).json({ projects });
    } catch (error) {
      next(error);
    }
  });

  // POST /projects - Create a new project
  router.post(
    '/projects',
    validateBody(createProjectSchema),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const project = await service.createProject(req.body);
        res.status(201).json({ project });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId - Get single project by ID
  router.get(
    '/projects/:projectId',
    optionalAuthenticateSession,
    validateParams(projectIdParamSchema),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId } = req.params;
        const project = await service.getProject(projectId);
        res.status(200).json({ project });
      } catch (error) {
        next(error);
      }
    }
  );

  // PATCH /projects/:projectId - Update project metadata (Admin Only)
  router.patch(
    '/projects/:projectId',
    requireRole(['admin']),
    validateRequest({ params: projectIdParamSchema, body: updateProjectSchema }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId } = req.params;
        const project = await service.updateProject(projectId, req.body);
        res.status(200).json({ project });
      } catch (error) {
        next(error);
      }
    }
  );

  // DELETE /projects/:projectId - Delete project by ID (Admin Only)
  router.delete(
    '/projects/:projectId',
    requireRole(['admin']),
    validateParams(projectIdParamSchema),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId } = req.params;
        await service.deleteProject(projectId);
        res.status(200).json({
          success: true,
          message: 'Project deleted successfully'
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const projectRouter: Router = createProjectRouter();
