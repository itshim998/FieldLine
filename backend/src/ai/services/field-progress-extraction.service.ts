import { AIService, aiService as defaultAiService } from './ai.service.js';
import {
  fieldProgressExtractionSchema,
  FieldProgressExtraction
} from '../contracts/field-progress-extraction.contract.js';
import { ValidationError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';

export const MAX_RAW_TEXT_LENGTH = 50000;

/**
 * Builds an explicit, deterministic prompt instructing the AI provider
 * to extract structured facts from unstructured field reports without
 * performing activity matching or inventing schedule IDs.
 */
export function buildFieldProgressExtractionPrompt(rawText: string): string {
  return [
    'You are extracting structured facts from a construction/infrastructure field progress report.',
    '',
    'CRITICAL INSTRUCTIONS & BOUNDARIES:',
    '1. Extract ONLY information explicitly supported by the field report.',
    '2. "reference" is a textual work description (e.g. "foundation work", "Pier P12 excavation").',
    '   reference != activity identity. Do NOT invent or output schedule activity IDs (e.g. "ACT-001", "WBS-1.2").',
    '3. "location" must be an explicitly mentioned site location (e.g. "Block B", "Pier P12"), or null if absent.',
    '4. "progress_percent" must be a number between 0 and 100 ONLY if an explicit percentage is stated (e.g. "60%").',
    '   Do NOT calculate or infer progress percentages from subjective phrases like "work has started", "nearly finished", or "making good progress". If no defensible numeric percentage is stated, return null.',
    '5. "status" must be strictly one of: "unknown", "not_started", "in_progress", "completed", "delayed".',
    '   Infer status only from explicit language; use "unknown" when ambiguous.',
    '6. Do NOT perform schedule matching or map to existing project activities.',
    '7. Do NOT calculate project truth or invent unmentioned quantities.',
    '8. Bounded output: Return at most 20 items.',
    '',
    'Return ONLY a valid JSON object matching this schema:',
    '{',
    '  "items": [',
    '    {',
    '      "reference": "string (1-200 chars)",',
    '      "location": "string (1-200 chars) or null",',
    '      "progress_percent": "number (0-100) or null",',
    '      "status": "unknown | not_started | in_progress | completed | delayed"',
    '    }',
    '  ]',
    '}',
    '',
    '--- RAW FIELD REPORT ---',
    rawText,
    '--- END RAW FIELD REPORT ---'
  ].join('\n');
}

/**
 * Application service responsible for interpreting raw field report text
 * into validated, structured field progress facts.
 */
export class FieldProgressExtractionService {
  private aiService: AIService;

  constructor(aiServiceInstance: AIService = defaultAiService) {
    this.aiService = aiServiceInstance;
  }

  /**
   * Interprets raw text from a field report and returns validated structured facts.
   * Does NOT query the database, match activities, or mutate persistence.
   */
  async extractFromReport(rawText: string): Promise<FieldProgressExtraction> {
    if (typeof rawText !== 'string') {
      throw new ValidationError('Raw report text must be a string');
    }

    const trimmed = rawText.trim();
    if (trimmed.length === 0) {
      throw new ValidationError('Raw report text cannot be empty or whitespace only');
    }

    if (rawText.length > MAX_RAW_TEXT_LENGTH) {
      throw new ValidationError(
        `Raw report text must not exceed ${MAX_RAW_TEXT_LENGTH.toLocaleString()} characters`
      );
    }

    logger.debug('FieldProgressExtractionService: Generating extraction prompt');
    const prompt = buildFieldProgressExtractionPrompt(rawText);

    logger.debug('FieldProgressExtractionService: Invoking AIService.extractStructured');
    return await this.aiService.extractStructured(prompt, fieldProgressExtractionSchema);
  }
}

export const fieldProgressExtractionService = new FieldProgressExtractionService();
