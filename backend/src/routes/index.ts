import { Router } from 'express';
import { healthRouter } from './health.router.js';
import { projectRouter } from './project.router.js';
import { scheduleRouter } from './schedule.router.js';
import { progressUpdateRouter } from './progress-update.router.js';
import { aiRouter } from './ai.router.js';
import { activityMatchingRouter } from './activity-matching.router.js';
import { progressRouter } from './progress.router.js';
import { progressSnapshotRouter } from './progress-snapshot.router.js';
import { riskRouter } from './risk.router.js';
import { evidenceRouter } from './evidence.router.js';
import { jobRouter } from './job.router.js';
import { intelligenceRouter } from './intelligence.router.js';
import { assistantRouter } from './assistant.router.js';
import { dashboardRouter } from './dashboard.router.js';

export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(projectRouter);
apiRouter.use(scheduleRouter);
apiRouter.use(progressUpdateRouter);
apiRouter.use(aiRouter);
apiRouter.use(activityMatchingRouter);
apiRouter.use(progressRouter);
apiRouter.use(progressSnapshotRouter);
apiRouter.use(riskRouter);
apiRouter.use(evidenceRouter);
apiRouter.use(jobRouter);
apiRouter.use(intelligenceRouter);
apiRouter.use(assistantRouter);
apiRouter.use(dashboardRouter);







