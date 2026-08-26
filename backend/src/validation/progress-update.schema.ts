import { z } from 'zod';
import { getDaysInMonth } from '../services/normalization/date-normalizer.js';

export const progressUpdateSourceTypeEnum = z.enum([
  'manual',
  'voice',
  'pdf',
  'xlsx',
  'image',
  'text'
]);

export const progressUpdateStatusEnum = z.enum([
  'received',
  'processed',
  'reviewed'
]);

export const reportDateSchema = z
  .string({ required_error: 'Report date is required' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Report date must be in YYYY-MM-DD format')
  .refine((val) => {
    const parts = val.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return false;
    if (month < 1 || month > 12) return false;
    const maxDays = getDaysInMonth(year, month);
    return day >= 1 && day <= maxDays;
  }, 'Report date must be a valid calendar date');

export const createProgressUpdateSchema = z.object({
  reportDate: reportDateSchema,
  rawText: z
    .string({ required_error: 'Report text is required' })
    .refine((val) => val.trim().length > 0, 'Report text cannot be empty or whitespace only')
    .refine((val) => val.length <= 50000, 'Report text must not exceed 50,000 characters'),
  reporterName: z
    .string()
    .refine((val) => val.length === 0 || val.trim().length > 0, 'Reporter name cannot be whitespace only')
    .transform((val) => (val.trim().length > 0 ? val.trim() : null))
    .nullable()
    .optional(),
  reporterRole: z
    .string()
    .transform((val) => (val.trim().length > 0 ? val.trim() : null))
    .nullable()
    .optional()
});

export const progressUpdateProjectIdParamSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty')
});

export const progressUpdateParamsSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty'),
  updateId: z
    .string({ required_error: 'Update ID is required' })
    .trim()
    .min(1, 'Update ID cannot be empty')
});

export const progressUpdateSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  reportDate: z.string(),
  reporterName: z.string().nullable(),
  reporterRole: z.string().nullable(),
  sourceType: progressUpdateSourceTypeEnum,
  rawText: z.string(),
  status: progressUpdateStatusEnum,
  createdAt: z.string(),
  updatedAt: z.string()
});

export const progressUpdateResponseSchema = z.object({
  progressUpdate: progressUpdateSchema
});

export const progressUpdateListResponseSchema = z.object({
  progressUpdates: z.array(progressUpdateSchema)
});

export type CreateProgressUpdateDto = z.infer<typeof createProgressUpdateSchema>;
export type ProgressUpdateProjectIdParamDto = z.infer<typeof progressUpdateProjectIdParamSchema>;
export type ProgressUpdateParamsDto = z.infer<typeof progressUpdateParamsSchema>;
export type ProgressUpdateDto = z.infer<typeof progressUpdateSchema>;
export type ProgressUpdateResponseDto = z.infer<typeof progressUpdateResponseSchema>;
export type ProgressUpdateListResponseDto = z.infer<typeof progressUpdateListResponseSchema>;
