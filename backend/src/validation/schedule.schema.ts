import { z } from 'zod';

export const projectIdParamSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty')
});

export const scheduleParamsSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty'),
  scheduleId: z
    .string({ required_error: 'Schedule ID is required' })
    .trim()
    .min(1, 'Schedule ID cannot be empty')
});

export const scheduleSourceTypeEnum = z.enum(['csv', 'xlsx', 'p6', 'manual']);

export const scheduleSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  version: z.string(),
  sourceType: scheduleSourceTypeEnum,
  sourceFilename: z.string().nullable(),
  isBaseline: z.boolean(),
  importedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const activitySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  scheduleId: z.string(),
  externalId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  wbsCode: z.string().nullable(),
  location: z.string().nullable(),
  plannedStart: z.string(),
  plannedFinish: z.string(),
  plannedQuantity: z.number().nullable(),
  unit: z.string().nullable(),
  baselineProgress: z.number(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const importScheduleResponseSchema = z.object({
  success: z.boolean(),
  schedule: scheduleSchema,
  activitiesImported: z.number(),
  rowCount: z.number(),
  sourceType: scheduleSourceTypeEnum,
  originalFilename: z.string()
});

export const scheduleListResponseSchema = z.object({
  schedules: z.array(scheduleSchema)
});

export const scheduleResponseSchema = z.object({
  schedule: scheduleSchema
});

export const activityListResponseSchema = z.object({
  activities: z.array(activitySchema)
});

export type ProjectIdParamDto = z.infer<typeof projectIdParamSchema>;
export type ScheduleParamsDto = z.infer<typeof scheduleParamsSchema>;
export type ScheduleDto = z.infer<typeof scheduleSchema>;
export type ActivityDto = z.infer<typeof activitySchema>;
