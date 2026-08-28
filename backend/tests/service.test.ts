import { describe, it, expect } from 'vitest';
import { DefaultHealthService } from '../src/services/health.service.js';
import { SystemRepository } from '../src/repositories/system.repository.js';
import { EnvConfig } from '../src/config/env.js';

describe('HealthService', () => {
  const mockConfig: EnvConfig = {
    PORT: 3001,
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    UPLOAD_DIR: './test-uploads',
    VITE_PORT: 3000,
    AI_PROVIDER: 'mock',
    GEMINI_MODEL: 'gemini-3.7-flash'
  };

  it('should assemble healthy response when repository reports healthy status', () => {
    const mockRepo: SystemRepository = {
      isHealthy: () => true,
      getAllMetadata: () => ({
        app_name: 'FieldLine',
        schema_version: '0.1.0',
        sih_ps_id: 'SIH26122'
      }),
      getMetadata: (_key: string) => 'test',
      setMetadata: (_key: string, _value: string) => {}
    };

    const service = new DefaultHealthService(mockRepo, mockConfig);
    const result = service.getHealthStatus();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('FieldLine Backend');
    expect(result.database.status).toBe('connected');
    expect(result.database.type).toBe('sqlite');
    expect(result.database.path).toBe(':memory:');
    expect(result.environment).toBe('test');
    expect(result.metadata?.app_name).toBe('FieldLine');
  });

  it('should assemble degraded response when repository reports unhealthy status', () => {
    const mockRepo: SystemRepository = {
      isHealthy: () => false,
      getAllMetadata: () => ({}),
      getMetadata: (_key: string) => null,
      setMetadata: (_key: string, _value: string) => {}
    };

    const service = new DefaultHealthService(mockRepo, mockConfig);
    const result = service.getHealthStatus();

    expect(result.status).toBe('degraded');
    expect(result.database.status).toBe('disconnected');
    expect(result.metadata).toEqual({});
  });
});
