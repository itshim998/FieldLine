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

  it('should support a single configured Groq key', () => {
    const custom = {
      AI_PROVIDER: 'groq',
      GROQ_API_KEY_01: 'gsk-only-key'
    };

    const config = getValidatedEnv(custom);
    expect(config.groqApiKeys).toEqual(['gsk-only-key']);
  });

  it('should support sparse configured Groq keys while preserving numeric order', () => {
    const custom = {
      AI_PROVIDER: 'groq',
      GROQ_API_KEY_14: 'gsk-key-fourteen',
      GROQ_API_KEY_02: 'gsk-key-two',
      GROQ_API_KEY_07: 'gsk-key-seven'
    };

    const config = getValidatedEnv(custom);
    expect(config.groqApiKeys).toEqual(['gsk-key-two', 'gsk-key-seven', 'gsk-key-fourteen']);
  });

  it('should ignore empty or whitespace-only unused slots without failing validation', () => {
    const custom = {
      AI_PROVIDER: 'groq',
      GROQ_API_KEY_01: 'gsk-valid-key-one',
      GROQ_API_KEY_02: '',
      GROQ_API_KEY_03: '   ',
      GROQ_API_KEY_04: 'gsk-valid-key-four'
    };

    const config = getValidatedEnv(custom);
    expect(config.groqApiKeys).toEqual(['gsk-valid-key-one', 'gsk-valid-key-four']);
  });

  it('should load all 20 configured Groq keys deterministically in numeric order', () => {
    const custom: Record<string, string> = {
      AI_PROVIDER: 'groq'
    };
    for (let i = 1; i <= 20; i++) {
      const slot = String(i).padStart(2, '0');
      custom[`GROQ_API_KEY_${slot}`] = `gsk-key-${slot}`;
    }

    const config = getValidatedEnv(custom);
    expect(config.groqApiKeys).toHaveLength(20);
    expect(config.groqApiKeys[0]).toBe('gsk-key-01');
    expect(config.groqApiKeys[19]).toBe('gsk-key-20');
  });

  it('should throw an error when AI_PROVIDER=groq but no Groq API keys are provided or all are empty', () => {
    const emptyCustom = {
      AI_PROVIDER: 'groq',
      GROQ_API_KEY_01: '',
      GROQ_API_KEY_02: '   '
    };

    expect(() => getValidatedEnv(emptyCustom)).toThrow(/At least one Groq API key/);
  });

  it('should support single GROQ_API_KEY fallback when no numbered keys exist', () => {
    const custom = {
      AI_PROVIDER: 'groq',
      GROQ_API_KEY: 'gsk-single-fallback-key'
    };

    const config = getValidatedEnv(custom);
    expect(config.groqApiKeys).toEqual(['gsk-single-fallback-key']);
  });

  it('should provide default values for Gemini Live configuration', () => {
    const config = getValidatedEnv({});
    expect(config.GEMINI_LIVE_MODEL).toBe('gemini-3.1-flash-live-preview');
    expect(config.GEMINI_LIVE_TOKEN_LIMIT_PER_KEY).toBe(55000);
  });

  it('should extract Gemini API keys preserving numeric order and ignoring whitespace', () => {
    const custom = {
      GEMINI_API_KEY_03: 'AIzaSyKeyThree',
      GEMINI_API_KEY_01: 'AIzaSyKeyOne',
      GEMINI_API_KEY_02: '   ',
      GEMINI_API_KEY_05: 'AIzaSyKeyFive',
      GEMINI_API_KEY_06: ''
    };

    const config = getValidatedEnv(custom);
    expect(config.geminiApiKeys).toEqual(['AIzaSyKeyOne', 'AIzaSyKeyThree', 'AIzaSyKeyFive']);
  });

  it('should load all 20 configured Gemini keys deterministically in numeric order', () => {
    const custom: Record<string, string> = {};
    for (let i = 1; i <= 20; i++) {
      const slot = String(i).padStart(2, '0');
      custom[`GEMINI_API_KEY_${slot}`] = `AIzaSyKey-${slot}`;
    }

    const config = getValidatedEnv(custom);
    expect(config.geminiApiKeys).toHaveLength(20);
    expect(config.geminiApiKeys[0]).toBe('AIzaSyKey-01');
    expect(config.geminiApiKeys[19]).toBe('AIzaSyKey-20');
  });

  it('should fallback to single GEMINI_API_KEY when no numbered keys are present', () => {
    const custom = {
      GEMINI_API_KEY: 'AIzaSySingleFallback'
    };

    const config = getValidatedEnv(custom);
    expect(config.geminiApiKeys).toEqual(['AIzaSySingleFallback']);
  });

  it('should allow custom GEMINI_LIVE_MODEL and GEMINI_LIVE_TOKEN_LIMIT_PER_KEY', () => {
    const custom = {
      GEMINI_LIVE_MODEL: 'gemini-3.1-pro-live-preview',
      GEMINI_LIVE_TOKEN_LIMIT_PER_KEY: '60000'
    };

    const config = getValidatedEnv(custom);
    expect(config.GEMINI_LIVE_MODEL).toBe('gemini-3.1-pro-live-preview');
    expect(config.GEMINI_LIVE_TOKEN_LIMIT_PER_KEY).toBe(60000);
  });

  it('should reject unknown AI_PROVIDER values', () => {
    const custom = {
      AI_PROVIDER: 'unknown_provider'
    };

    expect(() => getValidatedEnv(custom)).toThrow('Environment validation failed');
  });
});
