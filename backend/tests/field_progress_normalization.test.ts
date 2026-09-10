import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FieldProgressNormalizationService,
  buildFieldProgressNormalizationPrompt,
  MAX_STATEMENT_LENGTH
} from '../src/ai/services/field-progress-normalization.service.js';
import { AIService } from '../src/ai/services/ai.service.js';
import { MockAIProvider } from '../src/ai/providers/mock-ai.provider.js';
import { DefaultAIService } from '../src/ai/services/ai.service.js';
import { ValidationError, AIProviderError } from '../src/errors/AppError.js';

describe('FieldProgressNormalizationService (Mandatory Test Cases A-F)', () => {
  let mockAiProvider: MockAIProvider;
  let aiService: AIService;
  let service: FieldProgressNormalizationService;

  beforeEach(() => {
    mockAiProvider = new MockAIProvider();
    aiService = new DefaultAIService(mockAiProvider);
    service = new FieldProgressNormalizationService(aiService);
  });

  describe('Prompt Construction & Formatting', () => {
    it('builds a prompt with explicit rules preserving identifiers, percentages, and construction terms', () => {
      const prompt = buildFieldProgressNormalizationPrompt('PR-B07 complete hoye geche');
      expect(prompt).toContain('PR-B07 is complete.');
      expect(prompt).toContain('PRESERVE IDENTIFIERS EXACTLY');
      expect(prompt).toContain('PRESERVE VALUES & QUANTITIES EXACTLY');
      expect(prompt).toContain('STRICT FACTUAL BOUNDARIES');
      expect(prompt).toContain('PR-B07 complete hoye geche');
    });
  });

  describe('Input Validation', () => {
    it('throws ValidationError for empty string', async () => {
      await expect(service.normalizeToEnglish('')).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for whitespace-only string', async () => {
      await expect(service.normalizeToEnglish('   \n\t  ')).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for non-string input', async () => {
      await expect(service.normalizeToEnglish(null as any)).rejects.toThrow(ValidationError);
      await expect(service.normalizeToEnglish(undefined as any)).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError if statement exceeds maximum character length', async () => {
      const massiveText = 'A'.repeat(MAX_STATEMENT_LENGTH + 1);
      await expect(service.normalizeToEnglish(massiveText)).rejects.toThrow(ValidationError);
    });
  });

  describe('Mandatory Test Cases A-F', () => {
    // Case A: Banglish completion
    it('Case A: translates "PR-B07 complete hoye geche" to canonical English "PR-B07 is complete."', async () => {
      const input = 'PR-B07 complete hoye geche';
      const result = await service.normalizeToEnglish(input);

      expect(result.isEnglish).toBe(false);
      expect(result.detectedLanguage.toLowerCase()).toContain('bengali');
      expect(result.englishText).toBe('PR-B07 is complete.');
    });

    // Case B: Hinglish completion
    it('Case B: translates "PR-B07 complete ho gaya" to canonical English "PR-B07 is complete."', async () => {
      const input = 'PR-B07 complete ho gaya';
      const result = await service.normalizeToEnglish(input);

      expect(result.isEnglish).toBe(false);
      expect(result.englishText).toBe('PR-B07 is complete.');
    });

    // Case C: Mixed Hindi progress with percentage and construction term
    it('Case C: translates "PR-B07 ka piling 65 percent complete hai" preserving PR-B07, piling, and 65 percent', async () => {
      const input = 'PR-B07 ka piling 65 percent complete hai';
      const result = await service.normalizeToEnglish(input);

      expect(result.isEnglish).toBe(false);
      expect(result.englishText).toContain('PR-B07');
      expect(result.englishText).toContain('piling');
      expect(result.englishText).toMatch(/65\s*percent|65%/i);
    });

    // Case D: Already-English statement remains strictly unchanged
    it('Case D: returns "Pipe Rack PR-07 is 65% complete." unchanged with isEnglish=true', async () => {
      const input = 'Pipe Rack PR-07 is 65% complete.';
      const result = await service.normalizeToEnglish(input);

      expect(result.isEnglish).toBe(true);
      expect(result.detectedLanguage).toBe('English');
      expect(result.englishText).toBe(input);
    });

    // Case E: Bengali with technical identifier ACT-B02, location Area B, and percentage 68%
    it('Case E: preserves ACT-B02, Area B, and 68% for "ACT-B02 Area B te 68% complete"', async () => {
      const input = 'ACT-B02 Area B te 68% complete';
      const result = await service.normalizeToEnglish(input);

      expect(result.isEnglish).toBe(false);
      expect(result.englishText).toContain('ACT-B02');
      expect(result.englishText).toContain('Area B');
      expect(result.englishText).toContain('68%');
    });

    // Case F: Bengali with quantity 171 and location Area B
    it('Case F: preserves 171 and Area B for "171 piles complete hoye geche at Area B"', async () => {
      const input = '171 piles complete hoye geche at Area B';
      const result = await service.normalizeToEnglish(input);

      expect(result.isEnglish).toBe(false);
      expect(result.englishText).toContain('171');
      expect(result.englishText).toContain('Area B');
      expect(result.englishText).toMatch(/171\s+piles/i);
    });
  });

  describe('English Input Guarantee (No Unnecessary Paraphrase)', () => {
    it('guarantees already-English text is strictly preserved character-for-character even if AI returned minor variation', async () => {
      const input = 'Pipe Rack PR-07 is at 65% erection.';

      // Mock AI returning isEnglish=true but slightly paraphrased text
      const mockAISvc: AIService = {
        generateText: vi.fn(),
        extractStructured: vi.fn().mockResolvedValue({
          isEnglish: true,
          detectedLanguage: 'English',
          englishText: 'Pipe Rack PR-07 is 65% erected.' // Paraphrased by model
        })
      };

      const customService = new FieldProgressNormalizationService(mockAISvc);
      const result = await customService.normalizeToEnglish(input);

      expect(result.isEnglish).toBe(true);
      // Service enforces exact preservation of input string when isEnglish is true
      expect(result.englishText).toBe(input);
    });
  });

  describe('Failure Handling', () => {
    it('propagates AIProviderError when the AI provider fails', async () => {
      mockAiProvider.setFailure(true, new Error('Network timeout connecting to Groq'));

      await expect(service.normalizeToEnglish('PR-B07 complete hoye geche')).rejects.toThrow(
        AIProviderError
      );
    });

    it('rejects invalid structured response failing Zod schema contract', async () => {
      const invalidAiService: AIService = {
        generateText: vi.fn(),
        extractStructured: vi.fn().mockRejectedValue(
          new AIProviderError('AI structured response failed schema contract validation')
        )
      };

      const failingService = new FieldProgressNormalizationService(invalidAiService);
      await expect(failingService.normalizeToEnglish('PR-B07 complete hoye geche')).rejects.toThrow(
        AIProviderError
      );
    });
  });
});
