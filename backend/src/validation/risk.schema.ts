import { z } from 'zod';
import { reportDateSchema } from './progress-update.schema.js';
import { varianceStateEnum } from './progress-snapshot.schema.js';
import { activityExecutionStatusEnum } from './progress-normalization.schema.js';

export const activityRiskClassificationEnum = z.enum([
  'ON_TRACK',
  'AHEAD',
  'AT_RISK',
  'DELAYED',
  'COMPLETED'
]);

export const riskReasonCodeEnum = z.enum([
  'completed',
  'overdue',
  'strong_negative_variance',
  'near_finish_and_behind',
  'delayed_status',
  'positive_variance',
  'within_plan',
  'active_blocker'
]);

export const riskReasonSchema = z.object({
  code: riskReasonCodeEnum,
  message: z.string().min(1)
});

export const riskStatusParamsSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty')
});

export const riskStatusQuerySchema = z.object({
  asOfDate: reportDateSchema.optional()
});

export const activityRiskStatusItemSchema = z.object({
  activityId: z.string(),
  externalId: z.string(),
  name: z.string(),
  wbsCode: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  plannedStart: z.string().optional(),
  plannedFinish: z.string().optional(),
  plannedProgress: z.number().min(0).max(100).optional(),
  actualProgress: z.number().min(0).max(100).optional(),
  progressVariance: z.number().optional(),
  varianceState: varianceStateEnum.optional(),
  status: activityExecutionStatusEnum.optional(),
  overdue: z.boolean().optional(),
  classification: activityRiskClassificationEnum,
  reasons: z.array(riskReasonSchema)
});

export const projectRiskSummarySchema = z.object({
  totalActivities: z.number().min(0),
  completed: z.number().min(0),
  delayed: z.number().min(0),
  atRisk: z.number().min(0),
  ahead: z.number().min(0),
  onTrack: z.number().min(0),
  overdueCount: z.number().min(0)
});

export const projectRiskStatusSchema = z.object({
  projectId: z.string(),
  asOfDate: z.string(),
  generatedAt: z.string().optional(),
  activities: z.array(activityRiskStatusItemSchema),
  summary: projectRiskSummarySchema
});

export type ActivityRiskClassificationDto = z.infer<typeof activityRiskClassificationEnum>;
export type RiskReasonCodeDto = z.infer<typeof riskReasonCodeEnum>;
export type RiskReasonDto = z.infer<typeof riskReasonSchema>;
export type RiskStatusParamsDto = z.infer<typeof riskStatusParamsSchema>;
export type RiskStatusQueryDto = z.infer<typeof riskStatusQuerySchema>;
export type ActivityRiskStatusItemDto = z.infer<typeof activityRiskStatusItemSchema>;
export type ProjectRiskSummaryDto = z.infer<typeof projectRiskSummarySchema>;
export type ProjectRiskStatusDto = z.infer<typeof projectRiskStatusSchema>;
