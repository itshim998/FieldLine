import { z } from 'zod';

/**
 * Field progress normalization response contract.
 *
 * Enforces strict structure for language detection and canonical English translation
 * of field worker progress reports.
 */
export const fieldProgressNormalizationSchema = z
  .object({
    isEnglish: z.boolean({ required_error: 'isEnglish is required' }),
    detectedLanguage: z
      .string({ required_error: 'detectedLanguage is required' })
      .trim()
      .min(1, 'detectedLanguage cannot be empty'),
    englishText: z
      .string({ required_error: 'englishText is required' })
      .trim()
      .min(1, 'englishText cannot be empty')
  })
  .strict();

export type FieldProgressNormalization = z.infer<typeof fieldProgressNormalizationSchema>;
