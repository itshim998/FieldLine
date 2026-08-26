import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../src/app.js';
import { createAiRouter } from '../src/routes/ai.router.js';
import { FieldProgressExtractionService } from '../src/ai/services/field-progress-extraction.service.js';
import { DefaultAIService } from '../src/ai/services/ai.service.js';
import { MockAIProvider } from '../src/ai/providers/mock-ai.provider.js';
import { extractFieldProgressResponseSchema } from '../src/validation/ai.schema.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';

describe('AI Router Endpoints (POST /api/ai/field-progress/extract)', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('Happy Path', () => {
    it('should extract structured field facts from valid raw report text (200 OK)', async () => {
      const payload = {
        rawText: 'Foundation work at Block B is 60% complete. Concrete pouring started today.'
      };

      const res = await request(app)
        .post('/api/ai/field-progress/extract')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.extraction).toBeDefined();
      expect(res.body.extraction.items).toBeInstanceOf(Array);
      expect(res.body.extraction.items.length).toBeGreaterThan(0);

      // Validate output contract against schema
      const parsed = extractFieldProgressResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });

  describe('Input Validation Failures (400 Bad Request)', () => {
    it('should reject request missing rawText', async () => {
      const res = await request(app)
        .post('/api/ai/field-progress/extract')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject empty rawText', async () => {
      const res = await request(app)
        .post('/api/ai/field-progress/extract')
        .send({ rawText: '' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject whitespace-only rawText', async () => {
      const res = await request(app)
        .post('/api/ai/field-progress/extract')
        .send({ rawText: '    \n\t  ' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject oversized rawText (> 50,000 chars)', async () => {
      const res = await request(app)
        .post('/api/ai/field-progress/extract')
        .send({ rawText: 'A'.repeat(50001) });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject unexpected extra fields in request body', async () => {
      const res = await request(app)
        .post('/api/ai/field-progress/extract')
        .send({
          rawText: 'Valid report text',
          projectId: 'should-be-rejected-by-strict-schema'
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('AI Provider & Schema Error Handling (502 AI_PROVIDER_ERROR)', () => {
    it('should return 502 with AI_PROVIDER_ERROR when upstream AI provider fails', async () => {
      const failingProvider = new MockAIProvider({
        shouldFail: true,
        failureError: new Error('Rate limit exceeded / Timeout')
      });
      const failingService = new FieldProgressExtractionService(new DefaultAIService(failingProvider));

      // Build test router with injected failing service
      const testApp = express();
      testApp.use(express.json());
      testApp.use('/api', createAiRouter(failingService));
      testApp.use(errorHandler);

      const res = await request(testApp)
        .post('/api/ai/field-progress/extract')
        .send({ rawText: 'Foundation work in progress.' });

      expect(res.status).toBe(502);
      expect(res.body.code).toBe('AI_PROVIDER_ERROR');
      expect(res.body.error).toContain('AI provider invocation failed');
    });

    it('should return 502 with AI_PROVIDER_ERROR when AI returns schema-invalid payload', async () => {
      const invalidProvider = new MockAIProvider({
        mockStructuredResponse: {
          items: [
            {
              reference: '', // invalid empty reference
              location: 'Block A',
              progress_percent: 150, // invalid > 100
              status: 'invalid_status' // invalid enum
            }
          ]
        }
      });
      const invalidAiService = new FieldProgressExtractionService(new DefaultAIService(invalidProvider));

      const testApp = express();
      testApp.use(express.json());
      testApp.use('/api', createAiRouter(invalidAiService));
      testApp.use(errorHandler);

      const res = await request(testApp)
        .post('/api/ai/field-progress/extract')
        .send({ rawText: 'Some site text' });

      expect(res.status).toBe(502);
      expect(res.body.code).toBe('AI_PROVIDER_ERROR');
      expect(res.body.error).toContain('failed schema contract validation');
      expect(res.body.details).toBeDefined();
    });
  });
});
