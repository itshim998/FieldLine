import { Router } from 'express';
import { healthRouter } from './health.router.js';
import { projectRouter } from './project.router.js';
import { scheduleRouter } from './schedule.router.js';
import { progressUpdateRouter } from './progress-update.router.js';
import { aiRouter } from './ai.router.js';
import { activityMatchingRouter } from './activity-matching.router.js';

export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(projectRouter);
apiRouter.use(scheduleRouter);
apiRouter.use(progressUpdateRouter);
apiRouter.use(aiRouter);
apiRouter.use(activityMatchingRouter);



