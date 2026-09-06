import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file if available
dotenv.config();

export interface GroqEnvFields {
  groqApiKeys: string[];
  groqModel: string;
}

export interface GeminiEnvFields {
  geminiApiKeys: string[];
  geminiModel: string;
  geminiLiveModel: string;
  geminiLiveTokenLimitPerKey: number;
}

/**
 * Extracts GROQ_API_KEY_01 through GROQ_API_KEY_20 preserving numeric order.
 * Empty or whitespace-only unused slots are ignored.
 * Supports sparse configuration (e.g. Key 01 and Key 05 only).
 */
export function extractGroqApiKeys(source: Record<string, string | undefined>): { keys: string[] } {
  const keys: string[] = [];

  for (let i = 1; i <= 20; i++) {
    const padded = String(i).padStart(2, '0');
    const varNamePadded = `GROQ_API_KEY_${padded}`;
    const varNameUnpadded = `GROQ_API_KEY_${i}`;

    const rawVal = source[varNamePadded] ?? (source[varNameUnpadded] !== undefined ? source[varNameUnpadded] : undefined);
    if (rawVal !== undefined) {
      const trimmed = rawVal.trim();
      if (trimmed.length > 0) {
        keys.push(trimmed);
      }
    }
  }

  // Fallback to single GROQ_API_KEY if no numbered keys were found
  if (keys.length === 0 && source.GROQ_API_KEY !== undefined) {
    const singleTrimmed = source.GROQ_API_KEY.trim();
    if (singleTrimmed.length > 0) {
      keys.push(singleTrimmed);
    }
  }

  return { keys };
}

/**
 * Extracts GEMINI_API_KEY_01 through GEMINI_API_KEY_20 preserving numeric order.
 * Empty or whitespace-only unused slots are ignored.
 * Supports sparse configuration (e.g. Key 01 and Key 05 only).
 * Falls back to single GEMINI_API_KEY if no numbered keys were found.
 */
export function extractGeminiApiKeys(source: Record<string, string | undefined>): { keys: string[] } {
  const keys: string[] = [];

  for (let i = 1; i <= 20; i++) {
    const padded = String(i).padStart(2, '0');
    const varNamePadded = `GEMINI_API_KEY_${padded}`;
    const varNameUnpadded = `GEMINI_API_KEY_${i}`;

    const rawVal = source[varNamePadded] ?? (source[varNameUnpadded] !== undefined ? source[varNameUnpadded] : undefined);
    if (rawVal !== undefined) {
      const trimmed = rawVal.trim();
      if (trimmed.length > 0) {
        keys.push(trimmed);
      }
    }
  }

  // Fallback to single GEMINI_API_KEY if no numbered keys were found
  if (keys.length === 0 && source.GEMINI_API_KEY !== undefined) {
    const singleTrimmed = source.GEMINI_API_KEY.trim();
    if (singleTrimmed.length > 0) {
      keys.push(singleTrimmed);
    }
  }

  return { keys };
}

export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_PATH: z.string().min(1).default('./database/fieldline.db'),
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  VITE_PORT: z.coerce.number().int().positive().default(3000),
  AI_PROVIDER: z.enum(['mock', 'gemini', 'groq']).default('mock'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.7-flash'),
  GEMINI_LIVE_MODEL: z.string().min(1).default('gemini-3.1-flash-live-preview'),
  GEMINI_LIVE_TOKEN_LIMIT_PER_KEY: z.coerce.number().int().positive().default(55000),
  GROQ_MODEL: z.string().min(1).default('openai/gpt-oss-20b'),
  AUTH_SESSION_SECRET: z.string().min(1).default('fieldline-dev-session-secret-key-2026'),
  AUTO_SEED_DEMO: z.preprocess((val) => {
    if (typeof val === 'string') return val.toLowerCase() === 'true' || val === '1';
    if (typeof val === 'boolean') return val;
    return true;
  }, z.boolean()).default(true)
}).passthrough().transform((data) => {
  const { keys: groqKeys } = extractGroqApiKeys(data as Record<string, string | undefined>);
  const { keys: geminiKeys } = extractGeminiApiKeys(data as Record<string, string | undefined>);
  return {
    ...data,
    groqApiKeys: groqKeys,
    geminiApiKeys: geminiKeys
  };
}).superRefine((data, ctx) => {
  const hasGeminiKey = (data.GEMINI_API_KEY && data.GEMINI_API_KEY.trim().length > 0) || (data.geminiApiKeys && data.geminiApiKeys.length > 0);
  if (data.AI_PROVIDER === 'gemini' && !hasGeminiKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'GEMINI_API_KEY is required when AI_PROVIDER=gemini',
      path: ['GEMINI_API_KEY']
    });
  }

  if (data.AI_PROVIDER === 'groq' && (!data.groqApiKeys || data.groqApiKeys.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one Groq API key (e.g. GROQ_API_KEY_01) is required when AI_PROVIDER=groq',
      path: ['groqApiKeys']
    });
  }
});

export type EnvConfig = z.infer<typeof envSchema>;

export function getValidatedEnv(customEnv?: Record<string, string | undefined>): EnvConfig {
  const source = customEnv || process.env;
  const result = envSchema.safeParse(source);

  if (!result.success) {
    throw new Error(`Environment validation failed: ${JSON.stringify(result.error.issues)}`);
  }

  return result.data;
}

export const env: EnvConfig = getValidatedEnv();
