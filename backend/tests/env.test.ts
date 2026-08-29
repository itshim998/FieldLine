import { describe, it, expect } from 'vitest';
import { getValidatedEnv } from '../src/config/env.js';

describe('Environment Configuration Validation', () => {
  it('should provide sensible default values when no environment variables are passed', () => {
    const config = getValidatedEnv({});

    expect(config.PORT).toBe(3001);
    expect(config.NODE_ENV).toBe('development');
    expect(config.DATABASE_PATH).toBe('./database/fieldline.db');
    expect(config.UPLOAD_DIR).toBe('./uploads');
    expect(config.VITE_PORT).toBe(3000);
  });

  it('should parse and coerce custom environment variables properly', () => {
    const custom = {
      PORT: '8080',
      NODE_ENV: 'production',
      DATABASE_PATH: './custom/db.sqlite',
      UPLOAD_DIR: './custom-uploads',
      VITE_PORT: '5173'
    };

    const config = getValidatedEnv(custom);

    expect(config.PORT).toBe(8080);
    expect(config.NODE_ENV).toBe('production');
    expect(config.DATABASE_PATH).toBe('./custom/db.sqlite');
    expect(config.UPLOAD_DIR).toBe('./custom-uploads');
    expect(config.VITE_PORT).toBe(5173);
  });

  it('should throw an error when invalid values are supplied', () => {
    const invalid = {
      PORT: 'not-a-number'
    };

    expect(() => getValidatedEnv(invalid)).toThrow('Environment validation failed');
  });

  it('should support AI_PROVIDER=groq with sequential GROQ_API_KEY_01..20 keys preserving numeric order', () => {
    const custom = {
      AI_PROVIDER: 'groq',
      GROQ_MODEL: 'openai/gpt-oss-20b',
      GROQ_API_KEY_03: 'gsk-key-three',
      GROQ_API_KEY_01: 'gsk-key-one',
      GROQ_API_KEY_02: 'gsk-key-two'
    };

    const config = getValidatedEnv(custom);
    expect(config.AI_PROVIDER).toBe('groq');
    expect(config.GROQ_MODEL).toBe('openai/gpt-oss-20b');
    expect(config.groqApiKeys).toEqual(['gsk-key-one', 'gsk-key-two', 'gsk-key-three']);
  });

  it('should throw an error when AI_PROVIDER=groq but no Groq API keys are provided', () => {
    const custom = {
      AI_PROVIDER: 'groq'
    };

    expect(() => getValidatedEnv(custom)).toThrow(/At least one Groq API key/);
  });

  it('should throw an error when empty or whitespace Groq API key is configured', () => {
    const custom = {
      AI_PROVIDER: 'groq',
      GROQ_API_KEY_01: '   '
    };

    expect(() => getValidatedEnv(custom)).toThrow(/empty or malformed/);
  });

  it('should support single GROQ_API_KEY fallback when no numbered keys exist', () => {
    const custom = {
      AI_PROVIDER: 'groq',
      GROQ_API_KEY: 'gsk-single-fallback-key'
    };

    const config = getValidatedEnv(custom);
    expect(config.groqApiKeys).toEqual(['gsk-single-fallback-key']);
  });

  it('should reject unknown AI_PROVIDER values', () => {
    const custom = {
      AI_PROVIDER: 'unknown_provider'
    };

    expect(() => getValidatedEnv(custom)).toThrow('Environment validation failed');
  });
});
