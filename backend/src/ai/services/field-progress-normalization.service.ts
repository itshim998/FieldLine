import { AIService, aiService as defaultAiService } from './ai.service.js';
import {
  fieldProgressNormalizationSchema,
  FieldProgressNormalization
} from '../contracts/field-progress-normalization.contract.js';
import { ValidationError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';

export const MAX_STATEMENT_LENGTH = 50000;

/**
 * Builds an explicit, deterministic prompt instructing the AI provider
 * to normalize multilingual worker reports to canonical English while
 * strictly preserving technical identifiers, quantities, and construction terms.
 */
export function buildFieldProgressNormalizationPrompt(rawStatement: string): string {
  return [
    'You are an authoritative industrial language normalization engine for FieldLine.',
    'Your sole responsibility is to normalize field construction progress statements into canonical English for project record persistence and schedule matching.',
    '',
    'CRITICAL INSTRUCTIONS & BOUNDARIES:',
    '1. The output "englishText" is the canonical internal project progress statement.',
    '2. The output MUST be in English.',
    '3. If the input statement is ALREADY in English:',
    '   - Set "isEnglish" to true.',
    '   - Set "detectedLanguage" to "English".',
    '   - Return the input statement text UNCHANGED in "englishText". Do not paraphrase, summarize, or rewrite already-English text.',
    '4. If the input is in non-English or mixed-language (e.g. Bangla, Bengali, Banglish, Hindi, Hinglish, etc.):',
    '   - Set "isEnglish" to false.',
    '   - Set "detectedLanguage" to the primary detected natural language (e.g. "Bengali (Banglish)", "Hindi (Hinglish)").',
    '   - Produce a faithful, clear, and direct English translation in "englishText".',
    '5. PRESERVE IDENTIFIERS EXACTLY:',
    '   - Do NOT translate, alter, split, or drop technical identifiers, activity codes, equipment tags, or WBS codes.',
    '   - Examples of codes that MUST be preserved identically: "ACT-A01", "ACT-B02", "ACT-C01", "ACT-D03", "ACT-E02", "ACT-F01", "PR-B07", "PR-07", etc.',
    '   - Never convert "PR-B07" into "PR B07" or "Project B07".',
    '6. PRESERVE VALUES & QUANTITIES EXACTLY:',
    '   - Preserve numeric values, counts, percentages, and units exactly (e.g. "65%", "68%", "171 piles", "65 percent").',
    '   - Preserve area and location identifiers exactly (e.g. "Area B", "Block B", "Pier 12").',
    '   - Preserve construction terminology (e.g. "piling", "foundation", "bolts", "casting", "rebar", "erection").',
    '7. STRICT FACTUAL BOUNDARIES:',
    '   - Do NOT summarize or embellish.',
    '   - Do NOT infer unstated progress.',
    '   - Do NOT invent missing facts, activity codes, or dates.',
    '   - Do NOT convert approximate phrases into exact values.',
    '   - Do NOT perform schedule matching or project truth calculation.',
    '   - Translate only enough to make the statement clear, grammatically correct English.',
    '',
    'CANONICAL EXAMPLES:',
    'Input: "PR-B07 complete hoye geche"',
    'Output: { "isEnglish": false, "detectedLanguage": "Bengali (Banglish)", "englishText": "PR-B07 is complete." }',
    '',
    'Input: "PR-B07 complete ho gaya"',
    'Output: { "isEnglish": false, "detectedLanguage": "Hindi (Hinglish)", "englishText": "PR-B07 is complete." }',
    '',
    'Input: "PR-B07 ka piling 65 percent complete hai"',
    'Output: { "isEnglish": false, "detectedLanguage": "Hindi (Hinglish)", "englishText": "PR-B07 piling is 65 percent complete." }',
    '',
    'Input: "PR-B07 complete hoye geche, bolts ka kaam done"',
    'Output: { "isEnglish": false, "detectedLanguage": "Bengali/Hindi (Mixed)", "englishText": "PR-B07 is complete; bolt installation work is finished." }',
    '',
    'Input: "Pipe Rack PR-07 is 65% complete."',
    'Output: { "isEnglish": true, "detectedLanguage": "English", "englishText": "Pipe Rack PR-07 is 65% complete." }',
    '',
    'Input: "ACT-B02 Area B te 68% complete"',
    'Output: { "isEnglish": false, "detectedLanguage": "Bengali (Banglish)", "englishText": "ACT-B02 in Area B is 68% complete." }',
    '',
    'Input: "171 piles complete hoye geche at Area B"',
    'Output: { "isEnglish": false, "detectedLanguage": "Bengali (Banglish)", "englishText": "171 piles are complete at Area B." }',
    '',
    'Return ONLY a valid JSON object matching this schema:',
    '{',
    '  "isEnglish": boolean,',
    '  "detectedLanguage": string,',
    '  "englishText": string',
    '}',
    '',
    '--- WORKER PROGRESS STATEMENT ---',
    rawStatement,
    '--- END WORKER PROGRESS STATEMENT ---'
  ].join('\n');
}

/**
 * Service responsible for language detection and canonical English normalization
 * of worker progress reports before extraction and persistence.
 */
export class FieldProgressNormalizationService {
  private aiService: AIService;

  constructor(aiServiceInstance: AIService = defaultAiService) {
    this.aiService = aiServiceInstance;
  }

  /**
   * Normalizes a worker progress statement into canonical English.
   * - If already English: returns the input statement unchanged.
   * - If non-English or mixed: returns a faithful English translation preserving all identifiers.
   * - Validates non-empty input.
   */
  async normalizeToEnglish(rawStatement: string): Promise<FieldProgressNormalization> {
    if (typeof rawStatement !== 'string') {
      throw new ValidationError('Progress statement must be a string');
    }

    const trimmed = rawStatement.trim();
    if (trimmed.length === 0) {
      throw new ValidationError('Progress statement cannot be empty or whitespace only');
    }

    if (rawStatement.length > MAX_STATEMENT_LENGTH) {
      throw new ValidationError(
        `Progress statement must not exceed ${MAX_STATEMENT_LENGTH.toLocaleString()} characters`
      );
    }

    logger.debug('FieldProgressNormalizationService: Generating normalization prompt');
    const prompt = buildFieldProgressNormalizationPrompt(trimmed);

    logger.debug('FieldProgressNormalizationService: Invoking AIService.extractStructured');
    const structuredResult = await this.aiService.extractStructured(
      prompt,
      fieldProgressNormalizationSchema
    );

    // If source is English, enforce exact preservation of original text
    if (structuredResult.isEnglish) {
      return {
        isEnglish: true,
        detectedLanguage: structuredResult.detectedLanguage || 'English',
        englishText: trimmed
      };
    }

    return {
      isEnglish: false,
      detectedLanguage: structuredResult.detectedLanguage,
      englishText: structuredResult.englishText.trim()
    };
  }
}

export const fieldProgressNormalizationService = new FieldProgressNormalizationService();
