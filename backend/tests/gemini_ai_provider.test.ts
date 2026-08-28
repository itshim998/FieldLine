import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GeminiAIProvider } from '../src/ai/providers/gemini-ai.provider.js';
import { MockAIProvider } from '../src/ai/providers/mock-ai.provider.js';
import { createDefaultAIProvider } from '../src/ai/services/ai.service.js';
import { AIProviderError } from '../src/errors/AppError.js';
import { z } from 'zod';

describe('GeminiAIProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should throw clear AIProviderError if GEMINI_API_KEY is missing on initialization', () => {
    delete process.env.GEMINI_API_KEY;

    expect(() => new GeminiAIProvider()).toThrow(AIProviderError);
    expect(() => new GeminiAIProvider()).toThrow(/GEMINI_API_KEY is required/i);
  });

  it('should initialize successfully when GEMINI_API_KEY is provided', () => {
    const provider = new GeminiAIProvider({ apiKey: 'fake-test-key-12345' });
    expect(provider.name).toBe('gemini-ai-provider');
  });

  it('should create MockAIProvider when AI_PROVIDER is mock or unset', () => {
    process.env.AI_PROVIDER = 'mock';
    const provider = createDefaultAIProvider();
    expect(provider).toBeInstanceOf(MockAIProvider);
    expect(provider.name).toBe('mock-ai-provider');
  });

  it('should sanitize API keys and bearer headers from error messages', async () => {
    const fakeKey = 'secret-gemini-key-99999';
    const provider = new GeminiAIProvider({ apiKey: fakeKey });

    // Mock client error containing the fake key
    vi.spyOn((provider as any).client.models, 'generateContent').mockRejectedValueOnce(
      new Error(`Request failed with Bearer secret-gemini-key-99999 and key=${fakeKey}`)
    );

    await expect(provider.generateText('test prompt')).rejects.toThrow(AIProviderError);

    try {
      await provider.generateText('test prompt 2');
    } catch (err: any) {
      expect(err.message).not.toContain(fakeKey);
    }
  });

  it('should parse structured JSON from provider responses', async () => {
    const provider = new GeminiAIProvider({ apiKey: 'fake-test-key-12345' });

    vi.spyOn((provider as any).client.models, 'generateContent').mockResolvedValueOnce({
      text: '```json\n{"intent": "delayed", "activityQuery": null, "explicitDate": null}\n```'
    });

    const schema = z.object({
      intent: z.string(),
      activityQuery: z.string().nullable().optional(),
      explicitDate: z.string().nullable().optional()
    });

    const result = await provider.generateStructured('Test question', schema);
    expect(result).toEqual({
      intent: 'delayed',
      activityQuery: null,
      explicitDate: null
    });
  });
});
