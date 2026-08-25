import { z } from 'zod';
import { AIRequestOptions } from '../contracts/ai.contract.js';

/**
 * Common interface for all AI provider adapters (e.g. Mock, Gemini, OpenAI).
 * Adapters are responsible only for provider communication and translation.
 * They must NOT know about databases, repositories, or application business rules.
 */
export interface AIProvider {
  readonly name: string;
  generateText(prompt: string, options?: AIRequestOptions): Promise<string>;
  generateStructured<T>(prompt: string, schema: z.ZodType<T>, options?: AIRequestOptions): Promise<unknown>;
}
