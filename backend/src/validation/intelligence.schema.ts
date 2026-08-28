import { z } from 'zod';
import { reportDateSchema } from './progress-update.schema.js';
import { activityExecutionStatusEnum } from './progress-normalization.schema.js';
import { riskReasonSchema } from './risk.schema.js';
import { varianceStateEnum } from './progress-snapshot.schema.js';

export const intelligenceParamsSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty')
});

export const intelligenceQuerySchema = z.object({
  asOfDate: reportDateSchema.optional(),
  recentDays: z.coerce.number().int().min(1, 'recentDays must be at least 1').max(365).optional(),
  approachingDays: z.coerce
    .number()
    .int()
    .min(0, 'approachingDays must be at least 0')
    .max(365)
    .optional(),
  limit: z.coerce.number().int().min(1, 'limit must be at least 1').max(100).optional()
});

export const delayedActivityFactSchema = z.object({
  activityId: z.string(),
  externalId: z.string(),
  name: z.string(),
  plannedFinish: z.string(),
  actualProgress: z.number().min(0).max(100),
  progressVariance: z.number(),
  overdue: z.boolean(),
  classification: z.literal('DELAYED'),
  reasons: z.array(riskReasonSchema)
});

export const atRiskActivityFactSchema = z.object({
  activityId: z.string(),
  externalId: z.string(),
  name: z.string(),
  classification: z.literal('AT_RISK'),
  reasons: z.array(riskReasonSchema),
  plannedFinish: z.string(),
  actualProgress: z.number().min(0).max(100),
  progressVariance: z.number()
});

export const completedActivityFactSchema = z.object({
  activityId: z.string(),
  externalId: z.string(),
  name: z.string(),
  progressUpdateId: z.string().nullable(),
  asOfDate: z.string(),
  actualPercent: z.number().min(0).max(100),
  actualFinish: z.string().nullable(),
  status: activityExecutionStatusEnum
});

export const behindScheduleActivityFactSchema = z.object({
  activityId: z.string(),
  externalId: z.string(),
  name: z.string(),
  plannedProgress: z.number().min(0).max(100),
  actualProgress: z.number().min(0).max(100),
  progressVariance: z.number(),
  varianceState: varianceStateEnum,
  status: activityExecutionStatusEnum,
  plannedFinish: z.string(),
  overdue: z.boolean()
});

export const approachingMilestoneFactSchema = z.object({
  activityId: z.string(),
  externalId: z.string(),
  name: z.string(),
  milestoneDate: z.string(),
  daysUntil: z.number(),
  status: activityExecutionStatusEnum,
  actualProgress: z.number().min(0).max(100)
});

export const staleActivityFactSchema = z.object({
  activityId: z.string(),
  externalId: z.string(),
  name: z.string(),
  latestUpdateDate: z.string().nullable(),
  daysSinceUpdate: z.number().nullable(),
  hasAnyUpdate: z.boolean()
});

export const recentChangeFactSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  summary: z.string(),
  createdAt: z.string(),
  payload: z.record(z.unknown()).nullable()
});

export const projectIntelligenceSchema = z.object({
  projectId: z.string(),
  asOfDate: z.string(),
  generatedAt: z.string(),
  delayed: z.array(delayedActivityFactSchema),
  atRisk: z.array(atRiskActivityFactSchema),
  completedToday: z.array(completedActivityFactSchema),
  behindSchedule: z.array(behindScheduleActivityFactSchema),
  approachingMilestones: z.array(approachingMilestoneFactSchema),
  staleActivities: z.array(staleActivityFactSchema),
  recentChanges: z.array(recentChangeFactSchema)
});

export type IntelligenceParamsDto = z.infer<typeof intelligenceParamsSchema>;
export type IntelligenceQueryDto = z.infer<typeof intelligenceQuerySchema>;
export type ProjectIntelligenceDto = z.infer<typeof projectIntelligenceSchema>;
