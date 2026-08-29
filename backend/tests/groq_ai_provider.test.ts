import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GroqAIProvider } from '../src/ai/providers/groq-ai.provider.js';

vi.mock('groq-sdk');

describe('GroqAIProvider', () => {
  let provider: GroqAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GROQ_API_KEY = 'gsk_test_key_12345';
    process.env.GROQ_MODEL = 'openai/gpt-oss-20b';
    provider = new GroqAIProvider();
  });

  it('should be defined', () => {
    expect(GroqAIProvider).toBeDefined();
    expect(provider).toBeDefined();
  });

  it('should fail initialization if API key is missing', () => {
    delete process.env.GROQ_API_KEY;
    expect(() => new GroqAIProvider()).toThrow();
  });
});