import { z } from 'zod';
import { fieldProgressExtractionSchema } from '../ai/contracts/field-progress-extraction.contract.js';

export const extractFieldProgressRequestSchema = z
  .object({
    rawText: z
      .string({ required_error: 'rawText is required' })
      .refine((val) => val.trim().length > 0, 'rawText cannot be empty or whitespace only')
      .refine((val) => val.length <= 50000, 'rawText must not exceed 50,000 characters')
  })
  .strict();

export const extractFieldProgressResponseSchema = z
  .object({
    extraction: fieldProgressExtractionSchema
  })
  .strict();

export type ExtractFieldProgressRequestDto = z.infer<typeof extractFieldProgressRequestSchema>;
export type ExtractFieldProgressResponseDto = z.infer<typeof extractFieldProgressResponseSchema>;
