import { z } from 'zod';
import { AIService, aiService as defaultAiService } from '../../ai/services/ai.service.js';
import { FieldProgressItem } from '../../ai/contracts/field-progress-extraction.contract.js';
import { CandidateMatch } from './activity-matching.types.js';
import { logger } from '../../config/logger.js';

export const disambiguationResponseSchema = z.object({
  selectedActivityExternalId: z.string(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1)
});

export type DisambiguationResponse = z.infer<typeof disambiguationResponseSchema>;

export interface LLMActivityDisambiguator {
  disambiguate(
    fact: FieldProgressItem,
    candidates: CandidateMatch[]
  ): Promise<CandidateMatch[]>;
}

/**
 * Builds a prompt for disambiguating between a narrow set of qualified candidate activities.
 */
export function buildDisambiguationPrompt(
  fact: FieldProgressItem,
  candidates: CandidateMatch[]
): string {
  const candidateList = candidates
    .map((c, i) => `${i + 1}. ID: "${c.activityExternalId}" | Name: "${c.activityName}" | Initial Score: ${c.confidenceScore.toFixed(2)} | Rationale: ${c.rationale}`)
    .join('\n');

  return [
    'You are assisting a construction schedule activity matching engine to disambiguate close candidate activities.',
    '',
    'CRITICAL BOUNDARIES:',
    '1. You must ONLY choose from the provided candidate activities.',
    '2. Do NOT invent new activities or IDs.',
    '3. Do NOT modify progress percentages or project truth.',
    '',
    '--- FIELD FACT ---',
    `Work Reference: "${fact.reference}"`,
    `Location: ${fact.location ? `"${fact.location}"` : 'None specified'}`,
    `Reported Status: ${fact.status}`,
    `Reported Progress: ${fact.progress_percent !== null ? `${fact.progress_percent}%` : 'None specified'}`,
    '',
    '--- QUALIFIED CANDIDATES ---',
    candidateList,
    '',
    'Choose the single most appropriate activity and return a JSON object with this shape:',
    '{',
    '  "selectedActivityExternalId": "<exact external ID of chosen candidate>",',
    '  "rationale": "<brief explanation of why this activity best matches the fact>",',
    '  "confidence": <confidence score between 0.0 and 1.0>',
    '}'
  ].join('\n');
}

/**
 * Default implementation of LLM-assisted activity disambiguation.
 */
export class DefaultLLMActivityDisambiguator implements LLMActivityDisambiguator {
  private aiService: AIService;

  constructor(aiServiceInstance: AIService = defaultAiService) {
    this.aiService = aiServiceInstance;
  }

  async disambiguate(
    fact: FieldProgressItem,
    candidates: CandidateMatch[]
  ): Promise<CandidateMatch[]> {
    if (candidates.length <= 1) {
      return candidates;
    }

    try {
      logger.debug('LLMActivityDisambiguator: Invoking AI for disambiguation');
      const prompt = buildDisambiguationPrompt(fact, candidates);
      const result = await this.aiService.extractStructured(prompt, disambiguationResponseSchema);

      const chosenIndex = candidates.findIndex(
        c => c.activityExternalId.toLowerCase() === result.selectedActivityExternalId.toLowerCase()
      );

      if (chosenIndex >= 0) {
        const chosen = candidates[chosenIndex];
        const reordered = [
          {
            ...chosen,
            confidenceScore: Math.min(1.0, Math.max(chosen.confidenceScore, result.confidence)),
            matchMethod: 'llm_assisted' as const,
            rationale: `${chosen.rationale} LLM disambiguation: ${result.rationale}`
          },
          ...candidates.filter((_, idx) => idx !== chosenIndex)
        ];
        return reordered;
      }
    } catch (err) {
      logger.warn('LLMActivityDisambiguator: Disambiguation failed or timed out, preserving deterministic ranking', err);
    }

    return candidates;
  }
}

export const defaultLlmActivityDisambiguator: LLMActivityDisambiguator = new DefaultLLMActivityDisambiguator();
