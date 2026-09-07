import { z } from 'zod';

export const blockerCategoryEnum = z.enum([
  'equipment',
  'material',
  'access',
  'inspection',
  'weather',
  'safety',
  'coordination'
]);

export const blockerStatusEnum = z.enum(['active', 'resolved']);

export const createBlockerSchema = z.object({
  activityId: z.string().trim().min(1).nullable().optional(),
  category: blockerCategoryEnum,
  description: z
    .string({ required_error: 'Description is required' })
    .trim()
    .min(3, 'Description must be at least 3 characters'),
  reporterName: z
    .string({ required_error: 'Reporter name is required' })
    .trim()
    .min(1, 'Reporter name cannot be empty'),
  reporterRole: z.string().trim().min(1).nullable().optional()
});

export const resolveBlockerSchema = z.object({
  resolvedAt: z.string().trim().optional()
});

export const blockerParamsSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty'),
  id: z.string().trim().min(1).optional()
});

export const blockerQuerySchema = z.object({
  status: blockerStatusEnum.optional(),
  activityId: z.string().trim().min(1).optional()
});

export const reportHazardSchema = z.object({
  workArea: z.string().trim().optional(),
  hazardType: z
    .string({ required_error: 'Hazard type is required' })
    .trim()
    .min(1, 'Hazard type is required'),
  description: z
    .string({ required_error: 'Description is required' })
    .trim()
    .min(3, 'Description must be at least 3 characters'),
  reporterName: z
    .string({ required_error: 'Reporter name is required' })
    .trim()
    .min(1, 'Reporter name is required'),
  reporterRole: z.string().trim().optional(),
  immediateActionTaken: z.string().trim().optional()
});

export type CreateBlockerDto = z.infer<typeof createBlockerSchema>;
export type ResolveBlockerDto = z.infer<typeof resolveBlockerSchema>;
export type BlockerParamsDto = z.infer<typeof blockerParamsSchema>;
export type BlockerQueryDto = z.infer<typeof blockerQuerySchema>;
export type ReportHazardDto = z.infer<typeof reportHazardSchema>;
