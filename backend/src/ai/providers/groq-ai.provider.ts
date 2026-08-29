import { z } from 'zod';
import { AIProvider } from './ai-provider.interface.js';
import { AIRequestOptions } from '../contracts/ai.contract.js';
import { AIProviderError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';
import { GroqKeyRouter } from './groq-key-router.js';
import { env } from '../../config/env.js';

export interface GroqAIProviderOptions {
  apiKeys?: string[];
  defaultModel?: string;
  endpointUrl?: string;
  timeoutMs?: number;
}

export class GroqAIProvider implements AIProvider {
  public readonly name: string = 'groq-ai-provider';
  private readonly router: GroqKeyRouter;
  private readonly defaultModel: string;
  private readonly endpointUrl: string;
  private readonly timeoutMs: number;

  constructor(options?: GroqAIProviderOptions) {
    const keys = options?.apiKeys ?? env.groqApiKeys;
    if (!keys || keys.length === 0) {
      throw new AIProviderError(
        'Groq AI provider initialization failed: At least one Groq API key (e.g. GROQ_API_KEY_01) is required'
      );
    }

    this.defaultModel = options?.defaultModel || env.GROQ_MODEL || 'openai/gpt-oss-20b';
    this.endpointUrl = options?.endpointUrl || 'https://api.groq.com/openai/v1/chat/completions';
    this.timeoutMs = options?.timeoutMs ?? 30000;

    this.router = new GroqKeyRouter({
      apiKeys: keys,
      defaultModel: this.defaultModel
    });
  }

  /**
   * Access the underlying key router (for diagnostics, health checks, or unit testing).
   */
  getRouter(): GroqKeyRouter {
    return this.router;
  }

  /**
   * Generates free-form text completion from Groq using sticky key failover.
   */
  async generateText(prompt: string, options?: AIRequestOptions): Promise<string> {
    const modelName = options?.model || this.defaultModel;

    return await this.router.executeRequest(async (apiKey, slot) => {
      logger.debug(`GroqAIProvider: Generating text on model [${modelName}] with slot [${slot}]`);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const payload: Record<string, any> = {
          model: modelName,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        };

        if (options?.temperature !== undefined) {
          payload.temperature = options.temperature;
        }
        if (options?.maxTokens !== undefined) {
          payload.max_tokens = options.maxTokens;
        }

        const response = await fetch(this.endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': 'FieldLine/0.1.0 (Infrastructure AI Layer)'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        if (!response.ok) {
          let errorBody = '';
          try {
            errorBody = await response.text();
          } catch {
            errorBody = 'Could not read response body';
          }

          const httpError = new Error(`Groq API returned HTTP ${response.status}: ${errorBody}`);
          (httpError as any).status = response.status;
          (httpError as any).headers = response.headers;
          throw httpError;
        }

        const json: any = await response.json();
        const content = json?.choices?.[0]?.message?.content;

        if (typeof content !== 'string') {
          throw new Error('Groq API returned an empty or invalid choices content response');
        }

        return content;
      } finally {
        clearTimeout(timer);
      }
    }, `TextGeneration[${modelName}]`);
  }

  /**
   * Generates structured JSON output from Groq using JSON Schema/mode and parses it into an object.
   * Consuming AIService performs strict Zod schema validation on the returned object.
   */
  async generateStructured<T>(
    prompt: string,
    _schema: z.ZodType<T>,
    options?: AIRequestOptions
  ): Promise<unknown> {
    const modelName = options?.model || this.defaultModel;

    return await this.router.executeRequest(async (apiKey, slot) => {
      logger.debug(`GroqAIProvider: Generating structured output on model [${modelName}] with slot [${slot}]`);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const payload: Record<string, any> = {
          model: modelName,
          messages: [
            {
              role: 'system',
              content:
                'You are a high-precision structured data extraction engine. You MUST respond with ONLY a valid, standard JSON object adhering strictly to the requested schema. Do NOT include markdown backticks (```json), commentary, or extra explanations.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          response_format: { type: 'json_object' }
        };

        if (options?.temperature !== undefined) {
          payload.temperature = options.temperature;
        } else {
          payload.temperature = 0.1;
        }

        if (options?.maxTokens !== undefined) {
          payload.max_tokens = options.maxTokens;
        }

        const response = await fetch(this.endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': 'FieldLine/0.1.0 (Infrastructure AI Layer)'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        if (!response.ok) {
          let errorBody = '';
          try {
            errorBody = await response.text();
          } catch {
            errorBody = 'Could not read response body';
          }

          const httpError = new Error(`Groq API returned HTTP ${response.status}: ${errorBody}`);
          (httpError as any).status = response.status;
          (httpError as any).headers = response.headers;
          throw httpError;
        }

        const json: any = await response.json();
        const rawContent = json?.choices?.[0]?.message?.content;

        if (!rawContent || typeof rawContent !== 'string') {
          throw new Error('Groq API returned an empty or invalid structured content response');
        }

        // Clean any markdown fences if model inadvertently wrapped output
        const cleaned = rawContent
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();

        try {
          return JSON.parse(cleaned);
        } catch (parseErr) {
          throw new Error(
            `Failed to parse Groq structured JSON response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
          );
        }
      } finally {
        clearTimeout(timer);
      }
    }, `StructuredExtraction[${modelName}]`);
  }
}
