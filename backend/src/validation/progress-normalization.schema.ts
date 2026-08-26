import { z } from 'zod';
import { fieldProgressItemSchema } from '../ai/contracts/field-progress-extraction.contract.js';
import { reportDateSchema } from './progress-update.schema.js';

export const activityExecutionStatusEnum = z.enum([
  'not_started',
  'started',
  'in_progress',
  'completed',
  'delayed'
]);

export const normalizeProgressParamsSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty'),
  updateId: z
    .string({ required_error: 'Update ID is required' })
    .trim()
    .min(1, 'Update ID cannot be empty')
});

export const normalizeProgressRequestSchema = z.object({
  matchId: z
    .string({ required_error: 'Match ID is required' })
    .trim()
    .min(1, 'Match ID cannot be empty'),
  fact: fieldProgressItemSchema,
  actualQuantity: z
    .number({ invalid_type_error: 'Actual quantity must be a number or null' })
    .min(0, 'Actual quantity must be non-negative')
    .nullable()
    .optional(),
  quantityUnit: z
    .string()
    .trim()
    .max(50, 'Quantity unit must not exceed 50 characters')
    .nullable()
    .optional(),
  asOfDate: reportDateSchema.optional(),
  allowSuggested: z.boolean().optional().default(false)
});

export const activityProgressParamsSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty'),
  activityId: z
    .string({ required_error: 'Activity ID is required' })
    .trim()
    .min(1, 'Activity ID cannot be empty')
});

export const activityProgressSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  activityId: z.string(),
  progressUpdateId: z.string().nullable(),
  actualPercent: z.number().min(0).max(100),
  actualQuantity: z.number().min(0).nullable(),
  actualStart: z.string().nullable(),
  actualFinish: z.string().nullable(),
  status: activityExecutionStatusEnum,
  asOfDate: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const activityProgressResponseSchema = z.object({
  progress: activityProgressSchema
});

export const activityProgressListResponseSchema = z.object({
  progress: z.array(activityProgressSchema)
});

export type NormalizeProgressParamsDto = z.infer<typeof normalizeProgressParamsSchema>;
export type NormalizeProgressRequestDto = z.infer<typeof normalizeProgressRequestSchema>;
export type ActivityProgressParamsDto = z.infer<typeof activityProgressParamsSchema>;
export type ActivityProgressDto = z.infer<typeof activityProgressSchema>;
export type ActivityProgressResponseDto = z.infer<typeof activityProgressResponseSchema>;
export type ActivityProgressListResponseDto = z.infer<typeof activityProgressListResponseSchema>;
