import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAssistantRouter } from '../src/routes/assistant.router.js';
import { AssistantService } from '../src/services/assistant/assistant.service.js';
import { NotFoundError } from '../src/errors/AppError.js';
import express from 'express';
import { errorHandler } from '../src/middleware/errorHandler.js';

describe('Assistant Router (Pass 18)', () => {
  const validProjectId = '123e4567-e89b-12d3-a456-426614174000';

  it('POST /api/projects/:projectId/assistant/query should return 200 with grounded answer', async () => {
    const fakeService = {
      answerQuestion: vi.fn().mockResolvedValue({
        question: 'What is delayed?',
        intent: { intent: 'delayed', activityQuery: null, explicitDate: null },
        resolvedActivity: null,
        ambiguousCandidates: null,
        answer: 'Activity ACT-001 is delayed.',
        claims: [{ type: 'classification', factRef: 'delayed:ACT-001', field: 'classification', value: 'DELAYED', text: 'Activity ACT-001 is delayed.' }],
        factRefs: ['delayed:ACT-001'],
        grounded: true,
        status: 'success',
        asOfDate: '2026-08-28',
        verifiedFacts: [
          {
            ref: 'delayed:ACT-001',
            category: 'delayed',
            summary: 'ACT-001 is delayed.',
            data: {}
          }
        ]
      })
    } as unknown as AssistantService;

    const app = express();
    app.use(express.json());
    app.use('/api', createAssistantRouter(fakeService));
    app.use(errorHandler);

    const res = await request(app)
      .post(`/api/projects/${validProjectId}/assistant/query`)
      .send({ question: 'What is delayed?' });

    expect(res.status).toBe(200);
    expect(res.body.grounded).toBe(true);
    expect(res.body.answer).toBe('Activity ACT-001 is delayed.');
    expect(res.body.factRefs).toEqual(['delayed:ACT-001']);
    expect(fakeService.answerQuestion).toHaveBeenCalledWith(
      validProjectId,
      'What is delayed?',
      expect.objectContaining({
        asOfDate: undefined
      })
    );
  });

  it('POST /api/projects/:projectId/assistant/query should return 400 on invalid UUID project ID', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/api/projects/not-a-valid-uuid/assistant/query')
      .send({ question: 'What is delayed?' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('POST /api/projects/:projectId/assistant/query should return 400 on empty question body', async () => {
    const app = createApp();

    const res = await request(app)
      .post(`/api/projects/${validProjectId}/assistant/query`)
      .send({ question: '   ' });

    expect(res.status).toBe(400);
  });

  it('POST /api/projects/:projectId/assistant/query should return 404 when project does not exist', async () => {
    const fakeService = {
      answerQuestion: vi.fn().mockRejectedValue(new NotFoundError('Project with ID not found'))
    } as unknown as AssistantService;

    const app = express();
    app.use(express.json());
    app.use('/api', createAssistantRouter(fakeService));
    app.use(errorHandler);

    const res = await request(app)
      .post(`/api/projects/${validProjectId}/assistant/query`)
      .send({ question: 'What is delayed?' });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });
});
