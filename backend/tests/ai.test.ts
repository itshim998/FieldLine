import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { DefaultAIService } from '../src/ai/services/ai.service.js';
import { MockAIProvider } from '../src/ai/providers/mock-ai.provider.js';
import { aiExtractionContractSchema } from '../src/ai/contracts/ai.contract.js';
import { AIProviderError } from '../src/errors/AppError.js';

describe('AI Architecture & Validation Boundary', () => {
  it('should delegate text generation to AIProvider adapter', async () => {
    const mockProvider = new MockAIProvider({
      mockTextResponse: 'Engineered Foundation Activity Update'
    });
    const ai = new DefaultAIService(mockProvider);

    const response = await ai.generateText('Extract activity progress from site report');
    expect(response).toBe('Engineered Foundation Activity Update');
  });

  it('should validate structured AI response against Zod schema on successful extraction', async () => {
    const mockProvider = new MockAIProvider({
      mockStructuredResponse: {
        summary: 'Poured 450 m3 concrete in Block A',
        confidenceScore: 0.96,
        entities: [
          { name: 'concrete_volume', value: '450 m3', confidence: 0.95 },
          { name: 'block_location', value: 'Block A', confidence: 0.98 }
        ],
        notes: 'Verified against site dispatch slips'
      }
    });

    const ai = new DefaultAIService(mockProvider);
    const result = await ai.extractStructured('Site report text', aiExtractionContractSchema);

    expect(result).toBeDefined();
    expect(result.summary).toBe('Poured 450 m3 concrete in Block A');
    expect(result.confidenceScore).toBe(0.96);
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].name).toBe('concrete_volume');
    expect(result.entities[0].confidence).toBe(0.95);
  });

  it('should reject structured AI response and throw AIProviderError when provider returns invalid payload', async () => {
    // Malformed response missing required fields and violating types
    const invalidMockProvider = new MockAIProvider({
      mockStructuredResponse: {
        summary: 12345, // invalid: expected string
        confidenceScore: 2.5, // invalid: max is 1.0
        entities: 'not-an-array' // invalid: expected array
      }
    });

    const ai = new DefaultAIService(invalidMockProvider);

    await expect(
      ai.extractStructured('Site report text', aiExtractionContractSchema)
    ).rejects.toThrow(AIProviderError);

    try {
      await ai.extractStructured('Site report text', aiExtractionContractSchema);
    } catch (err: any) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect(err.statusCode).toBe(502);
      expect(err.code).toBe('AI_PROVIDER_ERROR');
      expect(err.details).toBeDefined();
    }
  });

  it('should propagate provider connection or API errors safely as AIProviderError', async () => {
    const failingProvider = new MockAIProvider({
      shouldFail: true,
      failureError: new Error('Rate limit exceeded / Timeout')
    });

    const ai = new DefaultAIService(failingProvider);

    await expect(
      ai.generateText('Extract summary')
    ).rejects.toThrow(AIProviderError);

    await expect(
      ai.extractStructured('Extract summary', aiExtractionContractSchema)
    ).rejects.toThrow(AIProviderError);
  });

  it('should support custom ad-hoc domain schemas for future specialized AI passes', async () => {
    const customScheduleContract = z.object({
      activityCode: z.string(),
      progressPercentage: z.number().min(0).max(100)
    });

    const mockProvider = new MockAIProvider({
      mockStructuredResponse: {
        activityCode: 'ACT-102',
        progressPercentage: 80
      }
    });

    const ai = new DefaultAIService(mockProvider);
    const result = await ai.extractStructured('Site text', customScheduleContract);

    expect(result.activityCode).toBe('ACT-102');
    expect(result.progressPercentage).toBe(80);
  });
});
