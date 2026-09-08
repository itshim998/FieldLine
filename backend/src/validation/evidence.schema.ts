import { z } from 'zod';

export const evidenceFileTypeEnum = z.enum([
  'text',
  'xlsx',
  'pdf',
  'image',
  'transcript',
  'other'
]);

export const evidenceProjectIdParamSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty')
    .refine((val) => !val.includes('..') && !val.includes('/') && !val.includes('\\'), {
      message: 'Project ID contains invalid path characters'
    })
});

export const evidenceParamsSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty')
    .refine((val) => !val.includes('..') && !val.includes('/') && !val.includes('\\'), {
      message: 'Project ID contains invalid path characters'
    }),
  evidenceId: z
    .string({ required_error: 'Evidence ID is required' })
    .trim()
    .min(1, 'Evidence ID cannot be empty')
    .refine((val) => !val.includes('..') && !val.includes('/') && !val.includes('\\'), {
      message: 'Evidence ID contains invalid path characters'
    })
});

export const progressUpdateEvidenceParamsSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty')
    .refine((val) => !val.includes('..') && !val.includes('/') && !val.includes('\\'), {
      message: 'Project ID contains invalid path characters'
    }),
  updateId: z
    .string({ required_error: 'Update ID is required' })
    .trim()
    .min(1, 'Update ID cannot be empty')
    .refine((val) => !val.includes('..') && !val.includes('/') && !val.includes('\\'), {
      message: 'Update ID contains invalid path characters'
    })
});

export const activityEvidenceParamsSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty')
    .refine((val) => !val.includes('..') && !val.includes('/') && !val.includes('\\'), {
      message: 'Project ID contains invalid path characters'
    }),
  activityId: z
    .string({ required_error: 'Activity ID is required' })
    .trim()
    .min(1, 'Activity ID cannot be empty')
    .refine((val) => !val.includes('..') && !val.includes('/') && !val.includes('\\'), {
      message: 'Activity ID contains invalid path characters'
    })
});

export const uploadEvidenceBodySchema = z.object({
  progressUpdateId: z
    .string()
    .trim()
    .transform((val) => (val && val.length > 0 ? val : null))
    .nullable()
    .optional(),
  fileType: evidenceFileTypeEnum.optional(),
  metadataJson: z
    .string()
    .trim()
    .transform((val) => (val && val.length > 0 ? val : null))
    .nullable()
    .optional()
});

export const evidenceSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  progressUpdateId: z.string().nullable(),
  fileName: z.string(),
  filePath: z.string().optional(),
  fileType: evidenceFileTypeEnum,
  fileSizeBytes: z.number().nullable(),
  mimeType: z.string().nullable(),
  metadataJson: z.string().nullable(),
  contentSha256: z.string().nullable().optional(),
  uploadedAt: z.string(),
  createdAt: z.string()
});

export const evidenceResponseSchema = z.object({
  evidence: evidenceSchema,
  deduplicated: z.boolean().optional()
});

export const evidenceListResponseSchema = z.object({
  evidence: z.array(evidenceSchema)
});
