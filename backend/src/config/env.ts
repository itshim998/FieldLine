import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'node:path';

// Load environment variables from .env file if available
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_PATH: z.string().min(1).default('./database/fieldline.db'),
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  VITE_PORT: z.coerce.number().int().positive().default(3000)
});

export type EnvConfig = z.infer<typeof envSchema>;

export function getValidatedEnv(customEnv?: Record<string, string | undefined>): EnvConfig {
  const source = customEnv || process.env;
  const result = envSchema.safeParse(source);

  if (!result.success) {
    console.error('❌ Invalid environment configuration:', result.error.format());
    throw new Error(`Environment validation failed: ${JSON.stringify(result.error.issues)}`);
  }

  return result.data;
}

export const env = getValidatedEnv();
