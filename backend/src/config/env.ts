import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file if available
dotenv.config();

export interface GroqEnvFields {
  groqApiKeys: string[];
  groqModel: string;
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

export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_PATH: z.string().min(1).default('./database/fieldline.db'),
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  VITE_PORT: z.coerce.number().int().positive().default(3000),
  AI_PROVIDER: z.enum(['mock', 'gemini', 'groq']).default('mock'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.7-flash'),
  GROQ_MODEL: z.string().min(1).default('openai/gpt-oss-20b'),
  AUTO_SEED_DEMO: z.preprocess((val) => {
    if (typeof val === 'string') return val.toLowerCase() === 'true' || val === '1';
    if (typeof val === 'boolean') return val;
    return true;
  }, z.boolean()).default(true)
}).passthrough().transform((data) => {
  const { keys } = extractGroqApiKeys(data as Record<string, string | undefined>);
  return {
    ...data,
    groqApiKeys: keys
  };
}).superRefine((data, ctx) => {
  if (data.AI_PROVIDER === 'gemini' && (!data.GEMINI_API_KEY || data.GEMINI_API_KEY.trim().length === 0)) {
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
