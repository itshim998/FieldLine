import { z } from 'zod';
import { reportDateSchema } from './progress-update.schema.js';

export const activityDetailParamsSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty'),
  activityId: z
    .string({ required_error: 'Activity ID is required' })
    .trim()
    .min(1, 'Activity ID cannot be empty')
});

export const activityDetailQuerySchema = z.object({
  asOfDate: reportDateSchema.optional()
});

export type ActivityDetailParamsDto = z.infer<typeof activityDetailParamsSchema>;
export type ActivityDetailQueryDto = z.infer<typeof activityDetailQuerySchema>;
