import { z } from 'zod';
import { reportDateSchema } from './progress-update.schema.js';

export const dashboardParamsSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty')
});

export const dashboardQuerySchema = z.object({
  asOfDate: reportDateSchema.optional(),
  recentLimit: z.coerce.number().int().min(1, 'recentLimit must be at least 1').max(50).optional(),
  recentDays: z.coerce.number().int().min(1, 'recentDays must be at least 1').max(365).optional(),
  approachingDays: z.coerce.number().int().min(0, 'approachingDays must be at least 0').max(365).optional()
});

export type DashboardParamsDto = z.infer<typeof dashboardParamsSchema>;
export type DashboardQueryDto = z.infer<typeof dashboardQuerySchema>;
