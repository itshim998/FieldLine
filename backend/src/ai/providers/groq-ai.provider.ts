import Groq from "groq-sdk";
import { env } from "../../config/env.js";
import { AIProvider } from './ai-provider.interface.js';
import { AIRequestOptions } from '../contracts/ai.contract.js';
import { AIProviderError } from '../../errors/AppError.js';
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export class GroqAIProvider implements AIProvider {
  readonly name = 'groq';
  private client: Groq;

 constructor(config?: { apiKey?: string; defaultModel?: string }) {
    const apiKey = config?.apiKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error("GROQ_API_KEY is missing");
    }
    this.client = new Groq({
        apiKey: apiKey,
    });
}

  async generateText(prompt: string, options?: AIRequestOptions): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: options?.model || env.GROQ_MODEL || 'openai/gpt-oss-20b',
        temperature: options?.temperature ?? 1,
        max_completion_tokens: options?.maxTokens ?? 2048,
        top_p: 1,
      });
      return response.choices[0]?.message?.content || '';
    } catch (error: any) {
      throw new AIProviderError(`Groq API Error: ${error.message}`);
    }
  }

async generateStructured<T>(
  prompt: string,
  schema: z.ZodType<T>,
  options?: AIRequestOptions
): Promise<T> {
  const jsonSchema = zodToJsonSchema(schema);
  try {
    const response = await this.client.chat.completions.create({
      messages: [
        {
          role: 'user',
          content: `${prompt}\nRespond strictly in valid JSON format matching this schema: ${JSON.stringify(jsonSchema)}`,
        },
      ],
      model: options?.model || env.GROQ_MODEL || 'openai/gpt-oss-20b',
      response_format: { type: 'json_object' },
      temperature: options?.temperature ?? 1,
      max_completion_tokens: options?.maxTokens ?? 2048,
      top_p: 1,
    });

    const content = response.choices[0]?.message?.content || '{}';
    return JSON.parse(content) as T;
  } catch (error: any) {
    throw new AIProviderError(`Groq API Error: ${error.message}`);
  }
}
}