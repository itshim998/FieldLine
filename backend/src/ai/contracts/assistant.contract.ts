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
 * Supported Assistant Claim Types for Field-Level Grounding (Pass 18 Final Grounding Correction)
 */
export const assistantClaimTypeEnum = z.enum([
  'metric',
  'classification',
  'status',
  'date',
  'variance',
  'reason',
  'activity_identity'
]);

export type AssistantClaimType = z.infer<typeof assistantClaimTypeEnum>;

/**
 * Structured factual claim bound to an authoritative fact field and value
 */
export const assistantClaimSchema = z.object({
  type: assistantClaimTypeEnum,
  factRef: z.string().min(1, 'factRef must not be empty'),
  field: z.string().min(1, 'field must not be empty'),
  value: z.union([z.string(), z.number(), z.boolean()]),
  text: z.string().min(1, 'Claim text must not be empty'),
  factRefs: z.array(z.string()).optional()
});

export type AssistantClaim = z.infer<typeof assistantClaimSchema>;

/**
 * Structured grounded assistant answer schema (Pass 18 Final Grounding Correction)
 */
export const assistantAnswerSchema = z.object({
  answer: z.string().min(1, 'Answer must not be empty').optional(),
  claims: z
    .array(assistantClaimSchema)
    .min(1, 'At least one verified claim must be provided in the answer')
});

export type AssistantAnswer = z.infer<typeof assistantAnswerSchema>;

