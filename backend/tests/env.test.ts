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
});
