import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { AIProvider } from './ai-provider.interface.js';
import { AIRequestOptions } from '../contracts/ai.contract.js';
import { AIProviderError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';

export interface GeminiAIProviderOptions {
  apiKey?: string;
  defaultModel?: string;
}

export class GeminiAIProvider implements AIProvider {
  public readonly name: string = 'gemini-ai-provider';
  private apiKey: string;
  private defaultModel: string;
  private client: GoogleGenAI;

  constructor(options?: GeminiAIProviderOptions) {
    const rawKey = options?.apiKey ?? process.env.GEMINI_API_KEY;
    if (!rawKey || rawKey.trim().length === 0) {
      throw new AIProviderError(
        'Gemini AI provider initialization failed: GEMINI_API_KEY is required but not configured'
      );
    }

    this.apiKey = rawKey.trim();
    this.defaultModel = options?.defaultModel || process.env.GEMINI_MODEL || 'gemini-3.7-flash';

    try {
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    } catch (err) {
      logger.error('Failed to initialize Google Gen AI client');
      throw new AIProviderError(
        `Gemini AI provider client initialization failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Generates free-form text completion from Gemini.
   */
  async generateText(prompt: string, options?: AIRequestOptions): Promise<string> {
    const modelName = options?.model || this.defaultModel;

    try {
      logger.debug(`GeminiAIProvider: Generating text using model [${modelName}]`);

      const response = await this.client.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          temperature: options?.temperature,
          maxOutputTokens: options?.maxTokens
        }
      });

      const responseText = response.text;
      if (typeof responseText !== 'string') {
        throw new Error('Gemini API returned an empty or non-string text response');
      }

      return responseText;
    } catch (err: unknown) {
      const sanitized = this.sanitizeErrorMessage(err);
      logger.error(`GeminiAIProvider text generation failed on model [${modelName}]`, sanitized);
      throw new AIProviderError(`Gemini AI text generation failed: ${sanitized}`, err);
    }
  }

  /**
   * Generates structured JSON output from Gemini and parses it into an object.
   * Consuming AIService performs strict Zod schema validation on the returned object.
   */
  async generateStructured<T>(
    prompt: string,
    _schema: z.ZodType<T>,
    options?: AIRequestOptions
  ): Promise<unknown> {
    const modelName = options?.model || this.defaultModel;

    try {
      logger.debug(`GeminiAIProvider: Generating structured output using model [${modelName}]`);

      const response = await this.client.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: options?.temperature,
          maxOutputTokens: options?.maxTokens
        }
      });

      const responseText = response.text;
      if (!responseText || typeof responseText !== 'string') {
        throw new Error('Gemini API returned an empty or invalid structured response');
      }

      // Strip markdown JSON code fence if present
      const cleaned = responseText
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      try {
        return JSON.parse(cleaned);
      } catch (parseErr) {
        throw new Error(
          `Failed to parse Gemini structured JSON response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
        );
      }
    } catch (err: unknown) {
      const sanitized = this.sanitizeErrorMessage(err);
      logger.error(`GeminiAIProvider structured generation failed on model [${modelName}]`, sanitized);
      throw new AIProviderError(`Gemini AI structured generation failed: ${sanitized}`, err);
    }
  }

  /**
   * Strips raw API keys, bearer tokens, or internal stack traces from error messages.
   */
  private sanitizeErrorMessage(err: unknown): string {
    if (!err) return 'Unknown Gemini provider error';
    let msg = err instanceof Error ? err.message : String(err);

    // Strip any potential key match
    if (this.apiKey && this.apiKey.length > 5) {
      msg = msg.split(this.apiKey).join('[REDACTED_API_KEY]');
    }

    // Strip authorization header references
    msg = msg.replace(/bearer\s+[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]');
    msg = msg.replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]');

    return msg;
  }
}
