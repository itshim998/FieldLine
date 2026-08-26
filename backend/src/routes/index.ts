import { Router } from 'express';
import { healthRouter } from './health.router.js';
import { projectRouter } from './project.router.js';
import { scheduleRouter } from './schedule.router.js';

export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(projectRouter);
apiRouter.use(scheduleRouter);

