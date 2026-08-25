import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { healthResponseSchema } from '../src/validation/health.schema.js';

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

  it('should return 404 for non-existent API endpoints', async () => {
    const res = await request(app).get('/api/non-existent-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Endpoint Not Found');
  });
});
