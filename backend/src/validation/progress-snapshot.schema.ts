import { z } from 'zod';
import { reportDateSchema } from './progress-update.schema.js';
import { activityExecutionStatusEnum } from './progress-normalization.schema.js';

export const varianceStateEnum = z.enum(['ahead', 'on_plan', 'behind']);

export const progressSnapshotParamsSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty')
});

export const progressSnapshotQuerySchema = z.object({
  asOfDate: reportDateSchema.optional()
});

export const activityProgressSnapshotItemSchema = z.object({
  activityId: z.string(),
  externalId: z.string(),
  name: z.string(),
  wbsCode: z.string().nullable(),
  location: z.string().nullable(),
  plannedStart: z.string(),
  plannedFinish: z.string(),
  plannedDurationDays: z.number().min(0),
  actualStart: z.string().nullable(),
  actualFinish: z.string().nullable(),
  plannedProgress: z.number().min(0).max(100),
  actualProgress: z.number().min(0).max(100),
  progressVariance: z.number(),
  varianceState: varianceStateEnum,
  status: activityExecutionStatusEnum,
  overdue: z.boolean()
});

export const progressSnapshotSummarySchema = z.object({
  totalActivities: z.number().min(0),
  notStarted: z.number().min(0),
  started: z.number().min(0),
  inProgress: z.number().min(0),
  completed: z.number().min(0),
  delayed: z.number().min(0),
  overdue: z.number().min(0),
  ahead: z.number().min(0),
  onPlan: z.number().min(0),
  behind: z.number().min(0),
  overallActualProgress: z.number().min(0).max(100),
  overallPlannedProgress: z.number().min(0).max(100),
  progressVariance: z.number(),
  varianceState: varianceStateEnum
});

export const projectProgressSnapshotSchema = z.object({
  projectId: z.string(),
  asOfDate: z.string(),
  generatedAt: z.string(),
  activities: z.array(activityProgressSnapshotItemSchema),
  summary: progressSnapshotSummarySchema,
  overallActualProgress: z.number().min(0).max(100).optional(),
  overallPlannedProgress: z.number().min(0).max(100).optional(),
  progressVariance: z.number().optional(),
  varianceState: varianceStateEnum.optional()
});

export type ProgressSnapshotParamsDto = z.infer<typeof progressSnapshotParamsSchema>;
export type ProgressSnapshotQueryDto = z.infer<typeof progressSnapshotQuerySchema>;
export type ActivityProgressSnapshotItemDto = z.infer<typeof activityProgressSnapshotItemSchema>;
export type ProgressSnapshotSummaryDto = z.infer<typeof progressSnapshotSummarySchema>;
export type ProjectProgressSnapshotDto = z.infer<typeof projectProgressSnapshotSchema>;
