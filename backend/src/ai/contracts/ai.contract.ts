import { z } from 'zod';

export const aiRequestOptionsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  model: z.string().optional()
});

export type AIRequestOptions = z.infer<typeof aiRequestOptionsSchema>;

/**
 * Base completion contract
 */
export const aiCompletionResponseSchema = z.object({
  text: z.string(),
  provider: z.string(),
  model: z.string(),
  tokensUsed: z.number().nonnegative().optional()
});

export type AICompletionResponse = z.infer<typeof aiCompletionResponseSchema>;

/**
 * Representative structured extraction entity contract
 * Used to enforce Zod schema validation between AI adapters and consuming services.
 */
export const aiExtractedEntitySchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  confidence: z.number().min(0).max(1)
});

export type AIExtractedEntity = z.infer<typeof aiExtractedEntitySchema>;

/**
 * Representative structured extraction contract
 */
export const aiExtractionContractSchema = z.object({
  summary: z.string().min(1),
  confidenceScore: z.number().min(0).max(1),
  entities: z.array(aiExtractedEntitySchema),
  notes: z.string().optional()
});

export type AIExtractionContract = z.infer<typeof aiExtractionContractSchema>;
