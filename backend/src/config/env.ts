import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file if available
dotenv.config();

export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_PATH: z.string().min(1).default('./database/fieldline.db'),
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  VITE_PORT: z.coerce.number().int().positive().default(3000),
  AI_PROVIDER: z.enum(['mock', 'gemini','groq']).default('mock'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.7-flash'),
  
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().min(1).default('openai/gpt-oss-20b'),
}).superRefine((data, ctx) => {
  if (data.AI_PROVIDER === 'gemini' && (!data.GEMINI_API_KEY || data.GEMINI_API_KEY.trim().length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'GEMINI_API_KEY is required when AI_PROVIDER=gemini',
      path: ['GEMINI_API_KEY']
    });
  }

if (data.AI_PROVIDER === 'groq' && (!data.GROQ_API_KEY || data.GROQ_API_KEY.trim().length === 0)) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'GROQ_API_KEY is required when AI_PROVIDER=groq',
    path: ['GROQ_API_KEY']
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
