import { Router, Request, Response, NextFunction } from 'express';
import { projectRepository } from '../repositories/project.repository.js';
import { activityRepository } from '../repositories/activity.repository.js';
import { evidenceRepository } from '../repositories/evidence.repository.js';
import { progressUpdateRepository } from '../repositories/progress-update.repository.js';
import { activityProgressRepository } from '../repositories/activity-progress.repository.js';
import { activityMatchRepository } from '../repositories/activity-match.repository.js';
import { seedGoldenDemo } from '../../../demo/golden-demo-seeder.js';
import { goldenProjectManifest } from '../../../demo/golden-demo-manifest.js';
import { logger } from '../config/logger.js';

export function createDemoRouter(): Router {
  const router = Router();

  // GET /demo/status - Check whether the golden demo dataset is seeded and query its metrics
  router.get('/demo/status', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const project = await projectRepository.getByCode(goldenProjectManifest.code);
      if (!project) {
        res.status(200).json({
          isSeeded: false,
          project: null,
          stats: null
        });
        return;
      }

      const activities = await activityRepository.listByProjectId(project.id);
      const evidence = await evidenceRepository.listByProjectId(project.id);
      const progressUpdates = await progressUpdateRepository.listByProjectId(project.id);
      const observations = await activityProgressRepository.listByProjectId(project.id);
      const matches = await activityMatchRepository.listByProjectId(project.id);

      res.status(200).json({
        isSeeded: true,
        project,
        stats: {
          activitiesCount: activities.length,
          evidenceCount: evidence.length,
          progressReportsCount: progressUpdates.length,
          canonicalObservationsCount: observations.length,
          matchesCount: matches.length
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // POST /demo/seed - Idempotently seed or re-seed the golden demo dataset
  router.post('/demo/seed', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const force = req.body?.force === true;
      let existingProject = await projectRepository.getByCode(goldenProjectManifest.code);

      if (existingProject && !force) {
        res.status(200).json({
          success: true,
          message: `Golden Demo project [${existingProject.code}] is already present.`,
          seeded: false,
          project: existingProject
        });
        return;
      }

      if (existingProject && force) {
        logger.info(`🧹 Force seed requested. Deleting existing golden project [${existingProject.code}]...`);
        await projectRepository.delete(existingProject.id);
      }

      logger.info('🌱 Triggering Golden Demo dataset seeding...');
      const seedResult = await seedGoldenDemo();
      const project = await projectRepository.getById(seedResult.projectId);

      res.status(200).json({
        success: true,
        message: 'Golden Demo dataset seeded successfully.',
        seeded: true,
        seedResult,
        project
      });
    } catch (error) {
      logger.error('❌ Failed to seed Golden Demo dataset:', error);
      next(error);
    }
  });

  // POST /demo/reset - Clean and rebuild golden demo dataset
  router.post('/demo/reset', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      logger.info('🔄 Full Golden Demo reset requested via API endpoint.');
      const existingProject = await projectRepository.getByCode(goldenProjectManifest.code);
      if (existingProject) {
        await projectRepository.delete(existingProject.id);
      }

      const seedResult = await seedGoldenDemo();
      const project = await projectRepository.getById(seedResult.projectId);

      res.status(200).json({
        success: true,
        message: 'Golden Demo dataset reset and re-seeded successfully.',
        seedResult,
        project
      });
    } catch (error) {
      logger.error('❌ Failed to reset Golden Demo dataset:', error);
      next(error);
    }
  });

  return router;
}

export const demoRouter: Router = createDemoRouter();
