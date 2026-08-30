import { z } from 'zod';
import { AIProvider } from '../providers/ai-provider.interface.js';
import { MockAIProvider } from '../providers/mock-ai.provider.js';
import { AIRequestOptions } from '../contracts/ai.contract.js';
import { AIProviderError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';

import { env } from '../../config/env.js';
import { GeminiAIProvider } from '../providers/gemini-ai.provider.js';
import { GroqAIProvider } from '../providers/groq-ai.provider.js';

export interface AIService {
  generateText(prompt: string, options?: AIRequestOptions): Promise<string>;
  extractStructured<T>(prompt: string, schema: z.ZodType<T>, options?: AIRequestOptions): Promise<T>;
}

export function createDefaultAIProvider(): AIProvider {
  const providerType = process.env.AI_PROVIDER || env.AI_PROVIDER;
  if (providerType === 'groq') {
    return new GroqAIProvider({
      apiKeys: env.groqApiKeys,
      defaultModel: process.env.GROQ_MODEL || env.GROQ_MODEL
    });
  }
  if (providerType === 'gemini') {
    return new GeminiAIProvider({
      apiKey: process.env.GEMINI_API_KEY || env.GEMINI_API_KEY,
      defaultModel: process.env.GEMINI_MODEL || env.GEMINI_MODEL
    });
  }
  if (providerType === 'mock') {
    return new MockAIProvider();
  }
  throw new AIProviderError(`Unsupported AI_PROVIDER: ${providerType}`);
}

export class DefaultAIService implements AIService {
  private provider: AIProvider;

  constructor(provider: AIProvider = createDefaultAIProvider()) {
    this.provider = provider;
  }

  getProvider(): AIProvider {
    return this.provider;
  }

  setProvider(provider: AIProvider): void {
    this.provider = provider;
  }

  async generateText(prompt: string, options?: AIRequestOptions): Promise<string> {
    try {
      logger.debug(`AIService invoking provider [${this.provider.name}] for text generation`);
      return await this.provider.generateText(prompt, options);
    } catch (error) {
      logger.error(`AIService text generation failed with provider [${this.provider.name}]`, error);
      throw new AIProviderError(
        `AI text generation failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  async extractStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: AIRequestOptions
  ): Promise<T> {
    let rawResponse: unknown;

    try {
      logger.debug(`AIService invoking provider [${this.provider.name}] for structured extraction`);
      rawResponse = await this.provider.generateStructured(prompt, schema, options);
    } catch (error) {
      logger.error(`AIService structured extraction failed in provider [${this.provider.name}]`, error);
      throw new AIProviderError(
        `AI provider invocation failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }

    // Strict Zod schema contract validation
    const parsed = schema.safeParse(rawResponse);
    if (!parsed.success) {
      logger.warn(`AI response from provider [${this.provider.name}] failed schema validation`, {
        issues: parsed.error.issues,
        rawResponse
      });
      throw new AIProviderError(
        'AI structured response failed schema contract validation',
        parsed.error.issues
      );
    }

    return parsed.data;
  }
}

export const aiService: AIService = new DefaultAIService();
