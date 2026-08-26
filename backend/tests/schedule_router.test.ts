import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';

const fixturesDir = path.resolve(process.cwd(), 'backend', 'tests', 'fixtures');

describe('Schedule Router Endpoints', () => {
  let app: ReturnType<typeof createApp>;
  let projectId: string;

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    const projRes = await request(app)
      .post('/api/projects')
      .send({
        name: 'Expressway Flyover Project',
        code: 'EXP-FLY-01',
        description: 'Elevated corridor construction'
      });
    projectId = projRes.body.project.id;
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('POST /api/projects/:projectId/schedules/import', () => {
    it('should import a valid CSV schedule file and return 201 Created', async () => {
      const csvPath = path.join(fixturesDir, 'valid_schedule.csv');

      const res = await request(app)
        .post(`/api/projects/${projectId}/schedules/import`)
        .attach('file', csvPath);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.schedule).toBeDefined();
      expect(res.body.schedule.projectId).toBe(projectId);
      expect(res.body.schedule.sourceType).toBe('csv');
      expect(res.body.activitiesImported).toBe(5);
      expect(res.body.rowCount).toBe(5);
    });

    it('should import a valid XLSX schedule file and return 201 Created', async () => {
      const xlsxPath = path.join(fixturesDir, 'valid_schedule.xlsx');

      const res = await request(app)
        .post(`/api/projects/${projectId}/schedules/import`)
        .attach('file', xlsxPath);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.schedule).toBeDefined();
      expect(res.body.schedule.sourceType).toBe('xlsx');
      expect(res.body.activitiesImported).toBe(3);
    });

    it('should reject when no file is uploaded', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/schedules/import`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/No schedule file uploaded/);
    });

    it('should reject unsupported file types (e.g. text/pdf)', async () => {
      const badFilePath = path.join(fixturesDir, 'generate_xlsx_fixtures.ts');

      const res = await request(app)
        .post(`/api/projects/${projectId}/schedules/import`)
        .attach('file', badFilePath);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Unsupported file/i);
    });

    it('should reject file with missing required headers', async () => {
      const badCsvPath = path.join(fixturesDir, 'missing_headers.csv');

      const res = await request(app)
        .post(`/api/projects/${projectId}/schedules/import`)
        .attach('file', badCsvPath);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required schedule column/);
    });

    it('should return 404 for non-existent project ID', async () => {
      const csvPath = path.join(fixturesDir, 'valid_schedule.csv');

      const res = await request(app)
        .post('/api/projects/non-existent-project-id/schedules/import')
        .attach('file', csvPath);

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Project with ID 'non-existent-project-id' not found/);
    });
  });

  describe('GET /api/projects/:projectId/schedules', () => {
    it('should return empty list when no schedules exist', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/schedules`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ schedules: [] });
    });

    it('should return schedules after import', async () => {
      const csvPath = path.join(fixturesDir, 'valid_schedule.csv');
      await request(app)
        .post(`/api/projects/${projectId}/schedules/import`)
        .attach('file', csvPath);

      const res = await request(app).get(`/api/projects/${projectId}/schedules`);

      expect(res.status).toBe(200);
      expect(res.body.schedules).toHaveLength(1);
      expect(res.body.schedules[0].projectId).toBe(projectId);
    });
  });

  describe('GET /api/projects/:projectId/schedules/:scheduleId/activities', () => {
    it('should list all imported activities for the schedule', async () => {
      const csvPath = path.join(fixturesDir, 'valid_schedule.csv');
      const importRes = await request(app)
        .post(`/api/projects/${projectId}/schedules/import`)
        .attach('file', csvPath);

      const scheduleId = importRes.body.schedule.id;

      const res = await request(app)
        .get(`/api/projects/${projectId}/schedules/${scheduleId}/activities`);

      expect(res.status).toBe(200);
      expect(res.body.activities).toHaveLength(5);
      expect(res.body.activities[0].externalId).toBe('ACT-101');
      expect(res.body.activities[0].name).toBe('Site Mobilization & Clearing');
      expect(res.body.activities[0].wbsCode).toBe('1.1');
      expect(res.body.activities[0].location).toBe('Sector A');
      expect(res.body.activities[0].plannedStart).toBe('2026-03-01');
      expect(res.body.activities[0].plannedFinish).toBe('2026-03-15');
      expect(res.body.activities[0].plannedQuantity).toBe(500);
      expect(res.body.activities[0].unit).toBe('m2');
    });

    it('should return 404 when schedule does not exist', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/schedules/non-existent-sched-id/activities`);

      expect(res.status).toBe(404);
    });
  });
});
