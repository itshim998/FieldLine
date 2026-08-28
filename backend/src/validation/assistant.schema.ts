import { z } from 'zod';

export const assistantParamsSchema = z.object({
  projectId: z.string().uuid('Invalid project ID format')
});

export const assistantBodySchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, 'Question must not be empty')
    .max(1000, 'Question must not exceed 1,000 characters'),
  asOfDate: z.string().optional()
});

export type AssistantParamsDto = z.infer<typeof assistantParamsSchema>;
export type AssistantBodyDto = z.infer<typeof assistantBodySchema>;
