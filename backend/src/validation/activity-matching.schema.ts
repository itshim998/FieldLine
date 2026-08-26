import { z } from 'zod';
import {
  fieldProgressExtractionSchema,
  fieldProgressItemSchema
} from '../ai/contracts/field-progress-extraction.contract.js';

export const matchMethodEnum = z.enum([
  'exact_id',
  'text_similarity',
  'wbs_location',
  'llm_assisted',
  'manual'
]);

export const matchStatusEnum = z.enum([
  'suggested',
  'confirmed',
  'rejected'
]);

export const candidateMatchSchema = z.object({
  activityId: z.string(),
  activityExternalId: z.string(),
  activityName: z.string(),
  confidenceScore: z.number().min(0).max(1),
  matchMethod: matchMethodEnum,
  matchedText: z.string().nullable(),
  rationale: z.string()
});

export const fieldFactMatchResultSchema = z.object({
  fact: fieldProgressItemSchema,
  bestMatch: candidateMatchSchema.nullable(),
  alternatives: z.array(candidateMatchSchema)
});

export const matchProgressUpdateParamsSchema = z.object({
  projectId: z
    .string({ required_error: 'Project ID is required' })
    .trim()
    .min(1, 'Project ID cannot be empty'),
  updateId: z
    .string({ required_error: 'Update ID is required' })
    .trim()
    .min(1, 'Update ID cannot be empty')
});

export const matchProgressUpdateRequestSchema = z.object({
  extraction: fieldProgressExtractionSchema
});

export const matchReportResponseSchema = z.object({
  matches: z.array(fieldFactMatchResultSchema)
});

export const activityMatchSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  progressUpdateId: z.string(),
  evidenceId: z.string().nullable(),
  activityId: z.string(),
  confidenceScore: z.number().min(0).max(1),
  matchMethod: matchMethodEnum,
  matchedText: z.string().nullable(),
  rationale: z.string().nullable(),
  status: matchStatusEnum,
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const activityMatchListResponseSchema = z.object({
  matches: z.array(activityMatchSchema)
});

export type CandidateMatchDto = z.infer<typeof candidateMatchSchema>;
export type FieldFactMatchResultDto = z.infer<typeof fieldFactMatchResultSchema>;
export type MatchProgressUpdateParamsDto = z.infer<typeof matchProgressUpdateParamsSchema>;
export type MatchProgressUpdateRequestDto = z.infer<typeof matchProgressUpdateRequestSchema>;
export type MatchReportResponseDto = z.infer<typeof matchReportResponseSchema>;
export type ActivityMatchDto = z.infer<typeof activityMatchSchema>;
export type ActivityMatchListResponseDto = z.infer<typeof activityMatchListResponseSchema>;
