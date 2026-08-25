import { Router, Request, Response, NextFunction } from 'express';
import { projectService, ProjectService } from '../services/project.service.js';
import { validateRequest, validateBody, validateParams } from '../middleware/validate.js';
import {
  createProjectSchema,
  updateProjectSchema,
  projectIdParamSchema
} from '../validation/project.schema.js';

export function createProjectRouter(service: ProjectService = projectService): Router {
  const router = Router();

  // GET /projects - List all projects
  router.get('/projects', (_req: Request, res: Response, next: NextFunction): void => {
    try {
      const projects = service.listProjects();
      res.status(200).json({ projects });
    } catch (error) {
      next(error);
    }
  });

  // POST /projects - Create a new project
  router.post(
    '/projects',
    validateBody(createProjectSchema),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const project = service.createProject(req.body);
        res.status(201).json({ project });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId - Get single project by ID
  router.get(
    '/projects/:projectId',
    validateParams(projectIdParamSchema),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId } = req.params;
        const project = service.getProject(projectId);
        res.status(200).json({ project });
      } catch (error) {
        next(error);
      }
    }
  );

  // PATCH /projects/:projectId - Update project metadata
  router.patch(
    '/projects/:projectId',
    validateRequest({ params: projectIdParamSchema, body: updateProjectSchema }),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId } = req.params;
        const project = service.updateProject(projectId, req.body);
        res.status(200).json({ project });
      } catch (error) {
        next(error);
      }
    }
  );

  // DELETE /projects/:projectId - Delete project by ID
  router.delete(
    '/projects/:projectId',
    validateParams(projectIdParamSchema),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId } = req.params;
        service.deleteProject(projectId);
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
