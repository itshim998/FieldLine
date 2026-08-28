import { z } from 'zod';

/**
 * Supported Assistant Intent Types for FieldLine Assistant (Pass 18)
 */
export const assistantIntentTypeEnum = z.enum([
  'delayed',
  'at_risk',
  'completed_today',
  'behind_schedule',
  'approaching_milestones',
  'stale_activities',
  'recent_changes',
  'activity_status',
  'unsupported'
]);

export type AssistantIntentType = z.infer<typeof assistantIntentTypeEnum>;

/**
 * Structured intent interpretation output schema
 */
export const assistantIntentSchema = z.object({
  intent: assistantIntentTypeEnum,
  activityQuery: z.string().nullable().optional(),
  explicitDate: z.string().nullable().optional()
});

export type AssistantIntent = z.infer<typeof assistantIntentSchema>;

/**
 * Structured factual claim with mandatory fact citations (Pass 18 Corrective)
 */
export const assistantClaimSchema = z.object({
  text: z.string().min(1, 'Claim text must not be empty'),
  factRefs: z
    .array(z.string().min(1, 'Fact reference string must not be empty'))
    .min(1, 'Each factual claim must cite at least one verified fact reference')
});

export type AssistantClaim = z.infer<typeof assistantClaimSchema>;

/**
 * Structured grounded assistant answer schema (Pass 18 Corrective)
 */
export const assistantAnswerSchema = z.object({
  answer: z.string().min(1, 'Answer must not be empty').optional(),
  claims: z
    .array(assistantClaimSchema)
    .min(1, 'At least one verified claim must be provided in the answer')
});

export type AssistantAnswer = z.infer<typeof assistantAnswerSchema>;

