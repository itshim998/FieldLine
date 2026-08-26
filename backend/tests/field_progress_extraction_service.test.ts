import { describe, it, expect } from 'vitest';
import {
  FieldProgressExtractionService,
  buildFieldProgressExtractionPrompt,
  MAX_RAW_TEXT_LENGTH
} from '../src/ai/services/field-progress-extraction.service.js';
import { DefaultAIService } from '../src/ai/services/ai.service.js';
import { MockAIProvider } from '../src/ai/providers/mock-ai.provider.js';
import { ValidationError, AIProviderError } from '../src/errors/AppError.js';

describe('FieldProgressExtractionService Unit Tests', () => {
  it('should extract structured facts from valid raw report text', async () => {
    const mockProvider = new MockAIProvider({
      mockStructuredResponse: {
        items: [
          {
            reference: 'foundation work',
            location: 'Block B',
            progress_percent: 60,
            status: 'in_progress'
          }
        ]
      }
    });

    const aiService = new DefaultAIService(mockProvider);
    const service = new FieldProgressExtractionService(aiService);

    const result = await service.extractFromReport('Foundation work at Block B is 60% complete.');

    expect(result).toBeDefined();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      reference: 'foundation work',
      location: 'Block B',
      progress_percent: 60,
      status: 'in_progress'
    });
  });

  it('should reject empty or blank raw text with ValidationError', async () => {
    const service = new FieldProgressExtractionService();

    await expect(service.extractFromReport('')).rejects.toThrow(ValidationError);
    await expect(service.extractFromReport('    \n\t  ')).rejects.toThrow(ValidationError);

    try {
      await service.extractFromReport('');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
    }
  });

  it('should reject non-string inputs with ValidationError', async () => {
    const service = new FieldProgressExtractionService();

    await expect(service.extractFromReport(null as any)).rejects.toThrow(ValidationError);
    await expect(service.extractFromReport(12345 as any)).rejects.toThrow(ValidationError);
    await expect(service.extractFromReport({ text: 'report' } as any)).rejects.toThrow(ValidationError);
  });

  it('should reject oversized input (> 50,000 characters) with ValidationError', async () => {
    const service = new FieldProgressExtractionService();
    const oversized = 'A'.repeat(MAX_RAW_TEXT_LENGTH + 1);

    await expect(service.extractFromReport(oversized)).rejects.toThrow(ValidationError);

    try {
      await service.extractFromReport(oversized);
    } catch (err: any) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain('50,000');
    }
  });

  it('should convert AI provider failures into AIProviderError (HTTP 502)', async () => {
    const failingProvider = new MockAIProvider({
      shouldFail: true,
      failureError: new Error('Upstream LLM network timeout')
    });

    const aiService = new DefaultAIService(failingProvider);
    const service = new FieldProgressExtractionService(aiService);

    await expect(service.extractFromReport('Foundation work started.')).rejects.toThrow(AIProviderError);

    try {
      await service.extractFromReport('Foundation work started.');
    } catch (err: any) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect(err.statusCode).toBe(502);
      expect(err.code).toBe('AI_PROVIDER_ERROR');
      expect(err.message).toContain('AI provider invocation failed');
    }
  });

  it('should convert schema-invalid AI responses into AIProviderError (HTTP 502)', async () => {
    const invalidPayloadProvider = new MockAIProvider({
      mockStructuredResponse: {
        // Missing "items" array, violating FieldProgressExtraction contract
        summary: 'Invalid shape',
        confidence: 0.9
      }
    });

    const aiService = new DefaultAIService(invalidPayloadProvider);
    const service = new FieldProgressExtractionService(aiService);

    await expect(service.extractFromReport('Excavation at Pier 1')).rejects.toThrow(AIProviderError);

    try {
      await service.extractFromReport('Excavation at Pier 1');
    } catch (err: any) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect(err.statusCode).toBe(502);
      expect(err.code).toBe('AI_PROVIDER_ERROR');
      expect(err.message).toContain('failed schema contract validation');
      expect(err.details).toBeDefined();
    }
  });

  it('should correctly preserve semantic boundaries (reference as text, null location, null percent, unknown status)', async () => {
    const mockProvider = new MockAIProvider({
      mockStructuredResponse: {
        items: [
          {
            reference: 'Paving access road section 4',
            location: null,
            progress_percent: null,
            status: 'unknown'
          }
        ]
      }
    });

    const aiService = new DefaultAIService(mockProvider);
    const service = new FieldProgressExtractionService(aiService);

    const result = await service.extractFromReport('Work was spotted on the access road.');
    expect(result.items[0].reference).toBe('Paving access road section 4');
    expect(result.items[0].location).toBeNull();
    expect(result.items[0].progress_percent).toBeNull();
    expect(result.items[0].status).toBe('unknown');
  });

  it('should build an explicit extraction prompt with all required domain boundaries', () => {
    const rawReport = 'Poured 500 m3 concrete at Pier 12. 75% complete.';
    const prompt = buildFieldProgressExtractionPrompt(rawReport);

    expect(prompt).toContain('CRITICAL INSTRUCTIONS & BOUNDARIES:');
    expect(prompt).toContain('reference != activity identity');
    expect(prompt).toContain('Do NOT invent or output schedule activity IDs');
    expect(prompt).toContain('Do NOT calculate or infer progress percentages');
    expect(prompt).toContain('Do NOT perform schedule matching');
    expect(prompt).toContain('Do NOT calculate project truth');
    expect(prompt).toContain('Bounded output: Return at most 20 items');
    expect(prompt).toContain(rawReport);
  });
});
