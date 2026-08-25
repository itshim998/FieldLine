import { z } from 'zod';

export const projectStatusEnum = z.enum([
  'planning',
  'active',
  'paused',
  'completed',
  'archived'
]);

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(?:T.*)?$/, 'Date must be in YYYY-MM-DD or ISO-8601 format')
  .or(z.literal(''))
  .nullable()
  .optional()
  .transform((val) => (val === '' ? null : val));

export const createProjectSchema = z.object({
  name: z
    .string({ required_error: 'Project name is required' })
    .trim()
    .min(1, 'Project name cannot be empty')
    .max(255, 'Project name must not exceed 255 characters'),
  code: z
    .string({ required_error: 'Project code is required' })
    .trim()
    .min(1, 'Project code cannot be empty')
    .max(50, 'Project code must not exceed 50 characters')
    .regex(/^[A-Za-z0-9_-]+$/, 'Project code must contain only alphanumeric characters, dashes, or underscores'),
  description: z
    .string()
    .trim()
    .max(2000, 'Description must not exceed 2000 characters')
    .nullable()
    .optional(),
  status: projectStatusEnum.optional().default('active'),
  startDate: dateStringSchema,
  targetEndDate: dateStringSchema
});

export const updateProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Project name cannot be empty')
    .max(255, 'Project name must not exceed 255 characters')
    .optional(),
  code: z
    .string()
    .trim()
    .min(1, 'Project code cannot be empty')
    .max(50, 'Project code must not exceed 50 characters')
    .regex(/^[A-Za-z0-9_-]+$/, 'Project code must contain only alphanumeric characters, dashes, or underscores')
    .optional(),
  description: z
    .string()
    .trim()
    .max(2000, 'Description must not exceed 2000 characters')
    .nullable()
    .optional(),
  status: projectStatusEnum.optional(),
  startDate: dateStringSchema,
  targetEndDate: dateStringSchema
});

export const projectIdParamSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty')
});

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  code: z.string(),
  status: projectStatusEnum,
  startDate: z.string().nullable(),
  targetEndDate: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const projectResponseSchema = z.object({
  project: projectSchema
});

export const projectListResponseSchema = z.object({
  projects: z.array(projectSchema)
});

export const deleteProjectResponseSchema = z.object({
  success: z.boolean(),
  message: z.string()
});

export type CreateProjectDto = z.infer<typeof createProjectSchema>;
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;
export type ProjectIdParamDto = z.infer<typeof projectIdParamSchema>;
export type ProjectDto = z.infer<typeof projectSchema>;
export type ProjectResponseDto = z.infer<typeof projectResponseSchema>;
export type ProjectListResponseDto = z.infer<typeof projectListResponseSchema>;
