import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { GroqAIProvider } from '../src/ai/providers/groq-ai.provider.js';
import { DefaultAIService } from '../src/ai/services/ai.service.js';
import { AIProviderError } from '../src/errors/AppError.js';
import { aiExtractionContractSchema } from '../src/ai/contracts/ai.contract.js';

describe('GroqAIProvider (Pass 26)', () => {
  const fakeKey1 = 'gsk_mock_test_key_01_abcdefghijklmnopqrstuvwxyz';
  const fakeKey2 = 'gsk_mock_test_key_02_1234567890abcdefghijklmnop';
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should initialize with provided keys and default to openai/gpt-oss-20b', () => {
    const provider = new GroqAIProvider({
      apiKeys: [fakeKey1, fakeKey2]
    });

    expect(provider.name).toBe('groq-ai-provider');
    expect(provider.getRouter().keyCount).toBe(2);
    expect(provider.getRouter().getCurrentSlot()).toBe('01');
  });

  it('should throw clear AIProviderError if no keys are provided', () => {
    expect(() => new GroqAIProvider({ apiKeys: [] })).toThrow(AIProviderError);
    expect(() => new GroqAIProvider({ apiKeys: [] })).toThrow(/At least one Groq API key/);
  });

  it('should generate free-form text successfully via Groq chat completions API', async () => {
    const provider = new GroqAIProvider({ apiKeys: [fakeKey1] });

    const mockResponse = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Reinforced Concrete Pier Caps Completed (Pass 26 Verified)'
          }
        }
      ]
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse
    } as Response);

    const result = await provider.generateText('Summarize concrete foundation progress');
    expect(result).toBe('Reinforced Concrete Pier Caps Completed (Pass 26 Verified)');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, requestInit] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(requestInit.headers.Authorization).toBe(`Bearer ${fakeKey1}`);
    const body = JSON.parse(requestInit.body);
    expect(body.model).toBe('openai/gpt-oss-20b');
    expect(body.messages[0].content).toBe('Summarize concrete foundation progress');
  });

  it('should generate structured JSON output and strip markdown code fences', async () => {
    const provider = new GroqAIProvider({ apiKeys: [fakeKey1] });

    const structuredPayload = {
      summary: 'Excavation 85% completed for Block B',
      confidenceScore: 0.94,
      entities: [
        { name: 'excavation_depth', value: '4.2m', confidence: 0.95 }
      ],
      notes: 'Grounded against geological site log'
    };

    // Return wrapped in markdown ```json fence to test robust stripping
    const wrappedContent = `\`\`\`json\n${JSON.stringify(structuredPayload)}\n\`\`\``;

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: wrappedContent
            }
          }
        ]
      })
    } as Response);

    const result = await provider.generateStructured(
      'Extract site progress',
      aiExtractionContractSchema
    );

    expect(result).toEqual(structuredPayload);
  });

  it('should integrate with AIService and validate schema contract', async () => {
    const provider = new GroqAIProvider({ apiKeys: [fakeKey1] });

    const validPayload = {
      summary: 'Poured foundation footings',
      confidenceScore: 0.99,
      entities: [
        { name: 'concrete_volume', value: '300 m3', confidence: 0.98 }
      ],
      notes: 'Checked by QC engineer'
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify(validPayload)
            }
          }
        ]
      })
    } as Response);

    const aiService = new DefaultAIService(provider);
    const extracted = await aiService.extractStructured(
      'Site report',
      aiExtractionContractSchema
    );

    expect(extracted.summary).toBe('Poured foundation footings');
    expect(extracted.confidenceScore).toBe(0.99);
    expect(extracted.entities).toHaveLength(1);
  });

  it('should failover to second key if first key returns HTTP 429', async () => {
    const provider = new GroqAIProvider({ apiKeys: [fakeKey1, fakeKey2] });

    const mockSuccessResponse = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Success after failover to Key 02'
          }
        }
      ]
    };

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded: TPM limit reached',
        headers: new Headers({ 'retry-after': '2' })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSuccessResponse
      } as Response);

    const text = await provider.generateText('Test failover');
    expect(text).toBe('Success after failover to Key 02');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    const [firstCallUrl, firstCallInit] = (globalThis.fetch as any).mock.calls[0];
    const [secondCallUrl, secondCallInit] = (globalThis.fetch as any).mock.calls[1];

    expect(firstCallInit.headers.Authorization).toBe(`Bearer ${fakeKey1}`);
    expect(secondCallInit.headers.Authorization).toBe(`Bearer ${fakeKey2}`);
    expect(provider.getRouter().getCurrentSlot()).toBe('02');
  });

  it('should throw AIProviderError with sanitized message when all keys fail', async () => {
    const provider = new GroqAIProvider({ apiKeys: [fakeKey1, fakeKey2] });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => `Upstream service overloaded with key ${fakeKey1}`
    } as Response);

    await expect(provider.generateText('All fail prompt')).rejects.toThrow(AIProviderError);

    try {
      await provider.generateText('All fail prompt');
    } catch (err: any) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect(err.message).not.toContain(fakeKey1);
      expect(err.message).not.toContain(fakeKey2);
      expect(err.message).toContain('exhausted all 2 configured API key(s)');
    }
  });

  it('should throw AIProviderError when provider returns invalid JSON in structured mode', async () => {
    const provider = new GroqAIProvider({ apiKeys: [fakeKey1] });

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'This is not valid JSON at all!'
            }
          }
        ]
      })
    } as Response);

    await expect(
      provider.generateStructured('Test malformed json', aiExtractionContractSchema)
    ).rejects.toThrow(AIProviderError);
  });
});
