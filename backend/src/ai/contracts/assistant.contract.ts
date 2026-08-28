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
 * Structured grounded assistant answer schema
 */
export const assistantAnswerSchema = z.object({
  answer: z.string().min(1, 'Answer must not be empty'),
  factRefs: z.array(z.string())
});

export type AssistantAnswer = z.infer<typeof assistantAnswerSchema>;

