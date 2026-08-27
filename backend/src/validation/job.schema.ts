import { z } from 'zod';

export const jobProjectIdParamSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty')
});

export const jobParamsSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty'),
  jobId: z
    .string({ required_error: 'Job ID is required' })
    .trim()
    .min(1, 'Job ID cannot be empty')
});

export const listJobsQuerySchema = z.object({
  type: z.enum(['document_ingestion']).optional()
});
