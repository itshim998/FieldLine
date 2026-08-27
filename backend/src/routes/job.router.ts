import { Router, Request, Response, NextFunction } from 'express';
import { JobService, jobService as defaultJobService } from '../jobs/job.service.js';
import { validateParams, validateQuery } from '../middleware/validate.js';
import { jobParamsSchema, jobProjectIdParamSchema, listJobsQuerySchema } from '../validation/job.schema.js';
import { ProcessingJob } from '../models/domain.types.js';
import { sanitizeErrorMessage } from '../jobs/document-ingestion.worker.js';

/**
 * Formats a ProcessingJob domain model into a clean, sanitized public DTO.
 * Ensures internal paths, stack traces, and arbitrary payload internals are omitted.
 */
export function formatJobResponse(job: ProcessingJob): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: job.id,
    projectId: job.projectId,
    jobType: job.jobType,
    status: job.status,
    attemptCount: job.attemptCount,
    createdAt: job.createdAt
  };

  switch (job.status) {
    case 'queued':
      return base;
    case 'processing':
      return {
        ...base,
        startedAt: job.startedAt
      };
    case 'completed':
      return {
        ...base,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        result: job.result
      };
    case 'failed':
      return {
        ...base,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        errorMessage: job.errorMessage ? sanitizeErrorMessage(job.errorMessage) : 'Processing failed'
      };
    default:
      return base;
  }
}

export function createJobRouter(service: JobService = defaultJobService): Router {
  const router = Router();

  // GET /projects/:projectId/jobs/:jobId - Retrieve job status
  router.get(
    '/projects/:projectId/jobs/:jobId',
    validateParams(jobParamsSchema),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId, jobId } = req.params;
        const job = service.getJob(projectId, jobId);
        res.status(200).json({ job: formatJobResponse(job) });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId/jobs - List jobs for a project
  router.get(
    '/projects/:projectId/jobs',
    validateParams(jobProjectIdParamSchema),
    validateQuery(listJobsQuerySchema),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId } = req.params;
        const jobType = req.query.type as 'document_ingestion' | undefined;
        const jobs = service.listJobs(projectId, jobType);
        res.status(200).json({ jobs: jobs.map(formatJobResponse) });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const jobRouter: Router = createJobRouter();
