import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { projectResponseSchema, projectListResponseSchema } from '../src/validation/project.schema.js';

describe('Project Router Endpoints', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('GET /api/projects', () => {
    it('should return an empty list when no projects exist', async () => {
      const res = await request(app).get('/api/projects');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ projects: [] });

      const parsed = projectListResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });

    it('should return a list of projects when projects exist', async () => {
      await request(app)
        .post('/api/projects')
        .send({ name: 'Project Alpha', code: 'ALPHA-01' });

      await request(app)
        .post('/api/projects')
        .send({ name: 'Project Beta', code: 'BETA-01' });

      const res = await request(app).get('/api/projects');

      expect(res.status).toBe(200);
      expect(res.body.projects).toHaveLength(2);

      const parsed = projectListResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });

  describe('POST /api/projects', () => {
    it('should create a project and return 201 Created', async () => {
      const payload = {
        name: 'Delhi-Meerut RRTS',
        code: 'RRTS-01',
        description: 'Regional rapid transit corridor',
        status: 'active',
        startDate: '2026-04-01',
        targetEndDate: '2027-08-31'
      };

      const res = await request(app)
        .post('/api/projects')
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.project).toBeDefined();
      expect(res.body.project.name).toBe('Delhi-Meerut RRTS');
      expect(res.body.project.code).toBe('RRTS-01');
      expect(res.body.project.description).toBe('Regional rapid transit corridor');
      expect(res.body.project.status).toBe('active');
      expect(res.body.project.startDate).toBe('2026-04-01');
      expect(res.body.project.targetEndDate).toBe('2027-08-31');

      const parsed = projectResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });

    it('should return 409 Conflict when project code already exists', async () => {
      await request(app)
        .post('/api/projects')
        .send({ name: 'Original Project', code: 'DUPLICATE-01' });

      const res = await request(app)
        .post('/api/projects')
        .send({ name: 'Second Project', code: 'DUPLICATE-01' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
      expect(res.body.error).toContain('already exists');
    });

    it('should return 400 Validation Error on missing required fields or invalid data', async () => {
      // Missing name
      const res1 = await request(app)
        .post('/api/projects')
        .send({ code: 'CODE-ONLY' });
      expect(res1.status).toBe(400);
      expect(res1.body.code).toBe('VALIDATION_ERROR');

      // Empty name
      const res2 = await request(app)
        .post('/api/projects')
        .send({ name: '   ', code: 'CODE-01' });
      expect(res2.status).toBe(400);

      // Invalid status enum
      const res3 = await request(app)
        .post('/api/projects')
        .send({ name: 'Valid Name', code: 'CODE-02', status: 'invalid_status' });
      expect(res3.status).toBe(400);

      // Invalid date format
      const res4 = await request(app)
        .post('/api/projects')
        .send({ name: 'Valid Name', code: 'CODE-03', startDate: 'invalid-date' });
      expect(res4.status).toBe(400);
    });
  });

  describe('GET /api/projects/:projectId', () => {
    it('should retrieve an existing project by ID', async () => {
      const createRes = await request(app)
        .post('/api/projects')
        .send({ name: 'Kolkata Metro East-West', code: 'KMRCL-EW' });

      const projectId = createRes.body.project.id;

      const res = await request(app).get(`/api/projects/${projectId}`);
      expect(res.status).toBe(200);
      expect(res.body.project.id).toBe(projectId);
      expect(res.body.project.name).toBe('Kolkata Metro East-West');
      expect(res.body.project.code).toBe('KMRCL-EW');

      const parsed = projectResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });

    it('should return 404 Not Found for non-existent project ID', async () => {
      const res = await request(app).get('/api/projects/non-existent-uuid');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /api/projects/:projectId', () => {
    it('should update project fields and return 200 OK', async () => {
      const createRes = await request(app)
        .post('/api/projects')
        .send({ name: 'Original Title', code: 'UPDATE-ME', status: 'planning' });

      const projectId = createRes.body.project.id;

      const res = await request(app)
        .patch(`/api/projects/${projectId}`)
        .send({
          name: 'Renamed Project',
          status: 'active',
          description: 'Updated scope description'
        });

      expect(res.status).toBe(200);
      expect(res.body.project.name).toBe('Renamed Project');
      expect(res.body.project.status).toBe('active');
      expect(res.body.project.description).toBe('Updated scope description');
      expect(res.body.project.code).toBe('UPDATE-ME');
    });

    it('should return 404 Not Found when updating non-existent project', async () => {
      const res = await request(app)
        .patch('/api/projects/unknown-uuid')
        .send({ name: 'New Name' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('should return 409 Conflict when updating code to one that already exists', async () => {
      await request(app)
        .post('/api/projects')
        .send({ name: 'Project 1', code: 'EXISTING-01' });

      const p2 = await request(app)
        .post('/api/projects')
        .send({ name: 'Project 2', code: 'EXISTING-02' });

      const res = await request(app)
        .patch(`/api/projects/${p2.body.project.id}`)
        .send({ code: 'EXISTING-01' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
    });

    it('should return 400 Validation Error on invalid update data', async () => {
      const p = await request(app)
        .post('/api/projects')
        .send({ name: 'Project Valid', code: 'VALID-01' });

      const res = await request(app)
        .patch(`/api/projects/${p.body.project.id}`)
        .send({ status: 'not_a_valid_status' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/projects/:projectId', () => {
    it('should delete project and return 200 OK', async () => {
      const createRes = await request(app)
        .post('/api/projects')
        .send({ name: 'Delete Target', code: 'DEL-TARGET' });

      const projectId = createRes.body.project.id;

      const deleteRes = await request(app).delete(`/api/projects/${projectId}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);
      expect(deleteRes.body.message).toContain('deleted');

      // Verify it no longer exists
      const getRes = await request(app).get(`/api/projects/${projectId}`);
      expect(getRes.status).toBe(404);
    });

    it('should return 404 Not Found when deleting non-existent project', async () => {
      const res = await request(app).delete('/api/projects/unknown-uuid');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });
});
