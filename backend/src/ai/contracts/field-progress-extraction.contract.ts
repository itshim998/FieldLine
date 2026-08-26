import { z } from 'zod';

/**
 * Strict status enum representing the state of progress extracted from field reports.
 */
export const fieldProgressStatusEnum = z.enum([
  'unknown',
  'not_started',
  'in_progress',
  'completed',
  'delayed'
]);

export type FieldProgressStatus = z.infer<typeof fieldProgressStatusEnum>;

/**
 * Individual field progress fact item extracted from an unstructured report.
 * Strict object validation ensures no extraneous properties are accepted.
 */
export const fieldProgressItemSchema = z
  .object({
    reference: z
      .string({ required_error: 'Reference is required' })
      .trim()
      .min(1, 'Reference cannot be empty or whitespace only')
      .max(200, 'Reference must not exceed 200 characters'),
    location: z
      .string()
      .trim()
      .max(200, 'Location must not exceed 200 characters')
      .nullable(),
    progress_percent: z
      .number({ invalid_type_error: 'Progress percentage must be a number or null' })
      .min(0, 'Progress percentage must be at least 0')
      .max(100, 'Progress percentage must not exceed 100')
      .nullable(),
    status: fieldProgressStatusEnum
  })
  .strict();

export type FieldProgressItem = z.infer<typeof fieldProgressItemSchema>;

/**
 * Field progress extraction response contract.
 * Bounded to a maximum of 20 items and strictly validates shape.
 */
export const fieldProgressExtractionSchema = z
  .object({
    items: z
      .array(fieldProgressItemSchema)
      .max(20, 'Extracted items cannot exceed 20 items')
  })
  .strict();

export type FieldProgressExtraction = z.infer<typeof fieldProgressExtractionSchema>;
