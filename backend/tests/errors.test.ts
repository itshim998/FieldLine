import { describe, it, expect } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { 
  AppError, 
  NotFoundError, 
  ValidationError, 
  ConflictError, 
  AIProviderError, 
  DatabaseError 
} from '../src/errors/AppError.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { validateBody, validateQuery } from '../src/middleware/validate.js';

describe('Error Handling and Validation Middleware', () => {
  function createTestApp(): Express {
    const app = express();
    app.use(express.json());

    // Route triggering AppError
    app.get('/test/not-found', () => {
      throw new NotFoundError('Custom Entity Not Found', { id: 123 });
    });

    app.get('/test/conflict', () => {
      throw new ConflictError('Unique constraint violation', { field: 'wbs_code' });
    });

    app.get('/test/ai-error', () => {
      throw new AIProviderError('Upstream LLM timed out');
    });

    app.get('/test/database-error', () => {
      throw new DatabaseError('Failed to execute query');
    });

    // Route triggering Zod validation through middleware
    const sampleSchema = z.object({
      name: z.string().min(3),
      count: z.number().positive()
    });

    app.post('/test/validation', validateBody(sampleSchema), (req, res) => {
      res.status(200).json({ success: true, data: req.body });
    });

    // Route triggering unexpected error
    app.get('/test/unexpected', () => {
      throw new Error('Unexpected catastrophic crash');
    });

    app.use(errorHandler);
    return app;
  }

  const app = createTestApp();

  it('should format NotFoundError with 404 status and code', async () => {
    const res = await request(app).get('/test/not-found');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Custom Entity Not Found');
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.statusCode).toBe(404);
    expect(res.body.details).toEqual({ id: 123 });
  });

  it('should format ConflictError with 409 status', async () => {
    const res = await request(app).get('/test/conflict');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.statusCode).toBe(409);
  });

  it('should format AIProviderError with 502 status', async () => {
    const res = await request(app).get('/test/ai-error');
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('AI_PROVIDER_ERROR');
    expect(res.body.statusCode).toBe(502);
  });

  it('should format DatabaseError with 500 status', async () => {
    const res = await request(app).get('/test/database-error');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('DATABASE_ERROR');
    expect(res.body.statusCode).toBe(500);
  });

  it('should catch Zod validation errors in middleware and return 400 with details', async () => {
    const res = await request(app)
      .post('/test/validation')
      .send({ name: 'ab', count: -5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation Error');
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details).toBeInstanceOf(Array);
    expect(res.body.details.length).toBeGreaterThanOrEqual(2);
  });

  it('should allow valid payloads through validation middleware', async () => {
    const res = await request(app)
      .post('/test/validation')
      .send({ name: 'Valid Activity Name', count: 10 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Valid Activity Name');
  });

  it('should safely mask unexpected 500 errors', async () => {
    const res = await request(app).get('/test/unexpected');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal Server Error');
    expect(res.body.code).toBe('INTERNAL_SERVER_ERROR');
  });
});
