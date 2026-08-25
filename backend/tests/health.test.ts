import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { healthResponseSchema } from '../src/validation/health.schema.js';
import { createHealthRouter } from '../src/routes/health.router.js';
import { HealthService } from '../src/services/health.service.js';

describe('GET /api/health', () => {
  const app = createApp();

  beforeAll(() => {
    // Initialize in-memory SQLite database for clean test execution
    initDatabase({ dbPath: ':memory:' });
  });

  afterAll(() => {
    closeDatabase();
  });

  it('should return 200 OK and match healthResponseSchema', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();

    // Validate structured response schema with Zod
    const validationResult = healthResponseSchema.safeParse(res.body);
    expect(validationResult.success).toBe(true);

    if (validationResult.success) {
      expect(validationResult.data.status).toBe('ok');
      expect(validationResult.data.service).toBe('FieldLine Backend');
      expect(validationResult.data.database.status).toBe('connected');
      expect(validationResult.data.database.type).toBe('sqlite');
      expect(validationResult.data.metadata?.app_name).toBe('FieldLine');
      expect(validationResult.data.metadata?.sih_ps_id).toBe('SIH26122');
    }
  });

  it('should return 503 when healthService reports degraded status', async () => {
    const mockDegradedService: HealthService = {
      getHealthStatus: () => ({
        status: 'degraded',
        service: 'FieldLine Backend',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
        uptime: 10,
        environment: 'test',
        database: {
          status: 'disconnected',
          type: 'sqlite',
          path: ':memory:'
        },
        metadata: {}
      })
    };

    const degradedApp = express();
    degradedApp.use(createHealthRouter(mockDegradedService));

    const res = await request(degradedApp).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.database.status).toBe('disconnected');
  });

  it('should return 404 for non-existent API endpoints', async () => {
    const res = await request(app).get('/api/non-existent-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Endpoint Not Found');
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
