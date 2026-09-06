import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';

describe('Pass 27 — Baseline Route Contract Freeze & Regression Checkpoint', () => {
  let app: ReturnType<typeof createApp>;
  let projectId: string;
  let scheduleId: string;
  let activityId: string;

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    // Setup a baseline project
    const pRes = await request(app)
      .post('/api/projects')
      .send({ code: 'BASE-01', name: 'Baseline Project', description: 'Testing baseline contracts' });
    expect(pRes.status).toBe(201);
    projectId = pRes.body.project.id;

    // Create a schedule and activity
    const db = getDatabase();
    const scheduleRepo = new SqliteScheduleRepository(() => db);
    const activityRepo = new SqliteActivityRepository(() => db);

    const sched = scheduleRepo.create({
      projectId,
      name: 'Baseline Schedule',
      sourceType: 'csv'
    });
    scheduleId = sched.id;

    const act = activityRepo.create({
      projectId,
      scheduleId,
      externalId: 'ACT-BASE-01',
      name: 'Baseline Initial Pour',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-15',
      plannedQuantity: 100,
      unit: 'm3',
      location: 'Area A'
    });
    activityId = act.id;
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('1. Health and System Routing', () => {
    it('GET /api/health returns frozen health contract', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('service', 'FieldLine Backend');
      expect(res.body).toHaveProperty('timestamp');
      expect(typeof res.body.uptime).toBe('number');
      expect(res.body).toHaveProperty('database');
      expect(res.body.database.status).toBe('connected');
    });

    it('GET /api/unknown-endpoint returns 404 AppError contract', async () => {
      const res = await request(app).get('/api/unknown-endpoint');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Endpoint Not Found');
      expect(res.body).toHaveProperty('statusCode', 404);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('2. Project Resource Contracts', () => {
    it('GET /api/projects lists projects with array envelope', async () => {
      const res = await request(app).get('/api/projects');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.projects)).toBe(true);
      expect(res.body.projects.length).toBeGreaterThanOrEqual(1);
      expect(res.body.projects[0]).toHaveProperty('id');
      expect(res.body.projects[0]).toHaveProperty('code', 'BASE-01');
      expect(res.body.projects[0]).toHaveProperty('status', 'active');
    });

    it('GET /api/projects/:projectId returns single project contract', async () => {
      const res = await request(app).get(`/api/projects/${projectId}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('project');
      expect(res.body.project.id).toBe(projectId);
      expect(res.body.project.code).toBe('BASE-01');
    });

    it('PATCH /api/projects/:projectId updates metadata correctly', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectId}`)
        .send({ name: 'Updated Baseline Name' });
      expect(res.status).toBe(200);
      expect(res.body.project.name).toBe('Updated Baseline Name');
    });

    it('DELETE /api/projects/:projectId removes project cleanly', async () => {
      const res = await request(app).delete(`/api/projects/${projectId}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);

      const verifyRes = await request(app).get(`/api/projects/${projectId}`);
      expect(verifyRes.status).toBe(404);
    });
  });

  describe('3. Schedule & Activity Resource Contracts', () => {
    it('GET /api/projects/:projectId/schedules returns schedules array', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/schedules`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.schedules)).toBe(true);
      expect(res.body.schedules).toHaveLength(1);
      expect(res.body.schedules[0].id).toBe(scheduleId);
    });

    it('GET /api/projects/:projectId/schedules/:scheduleId/activities returns activities array', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/schedules/${scheduleId}/activities`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.activities)).toBe(true);
      expect(res.body.activities).toHaveLength(1);
      expect(res.body.activities[0].externalId).toBe('ACT-BASE-01');
    });

    it('GET /api/projects/:projectId/activities/:activityId returns activity detail model', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/activities/${activityId}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('activity');
      expect(res.body.activity.activityId).toBe(activityId);
      expect(res.body).toHaveProperty('current');
      expect(res.body).toHaveProperty('timeline');
      expect(res.body).toHaveProperty('matches');
      expect(res.body).toHaveProperty('evidence');
    });
  });

  describe('4. Progress Update & Normalization Contracts', () => {
    it('POST & GET /api/projects/:projectId/progress-updates enforce valid DTO shapes', async () => {
      const createRes = await request(app)
        .post(`/api/projects/${projectId}/progress-updates`)
        .send({
          reportDate: '2026-08-10',
          rawText: 'Poured 50 m3 concrete on Pier 1. Everything according to plan.',
          reporterName: 'Foreman Dave',
          reporterRole: 'Site Supervisor'
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body).toHaveProperty('progressUpdate');
      const updateId = createRes.body.progressUpdate.id;
      expect(updateId).toBeDefined();

      const getRes = await request(app).get(`/api/projects/${projectId}/progress-updates/${updateId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.progressUpdate.id).toBe(updateId);
      expect(getRes.body.progressUpdate.reporterName).toBe('Foreman Dave');

      const listRes = await request(app).get(`/api/projects/${projectId}/progress-updates`);
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.progressUpdates)).toBe(true);
      expect(listRes.body.progressUpdates.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/projects/:projectId/activities/:activityId/progress returns canonical activity progress', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/activities/${activityId}/progress`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.progress)).toBe(true);
    });
  });

  describe('5. Risk, Intelligence & Dashboard Contracts', () => {
    it('GET /api/projects/:projectId/risk-status returns deterministic risk status payload', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/risk-status`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('projectId', projectId);
      expect(res.body).toHaveProperty('summary');
      expect(res.body.summary).toHaveProperty('delayed');
      expect(res.body.summary).toHaveProperty('atRisk');
      expect(res.body.summary).toHaveProperty('onTrack');
      expect(res.body).toHaveProperty('activities');
      expect(Array.isArray(res.body.activities)).toBe(true);
    });

    it('GET /api/projects/:projectId/intelligence returns synthesized intelligence payload', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/intelligence`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('projectId', projectId);
      expect(res.body).toHaveProperty('delayed');
      expect(Array.isArray(res.body.delayed)).toBe(true);
      expect(res.body).toHaveProperty('atRisk');
      expect(Array.isArray(res.body.atRisk)).toBe(true);
      expect(res.body).toHaveProperty('approachingMilestones');
      expect(Array.isArray(res.body.approachingMilestones)).toBe(true);
    });

    it('GET /api/projects/:projectId/dashboard returns consolidated dashboard payload', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/dashboard`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('project');
      expect(res.body.project.id).toBe(projectId);
      expect(res.body).toHaveProperty('health');
      expect(res.body).toHaveProperty('activityStatus');
      expect(typeof res.body.activityStatus.totalActivities).toBe('number');
      expect(res.body).toHaveProperty('recentUpdates');
      expect(res.body).toHaveProperty('milestones');
      expect(res.body).toHaveProperty('attention');
    });

    it('GET /api/projects/:projectId/progress-snapshot returns snapshot contract', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/progress-snapshot`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('projectId', projectId);
      expect(res.body).toHaveProperty('summary');
      expect(typeof res.body.summary.totalActivities).toBe('number');
      expect(res.body).toHaveProperty('activities');
      expect(Array.isArray(res.body.activities)).toBe(true);
    });
  });

  describe('6. Evidence & Demo Management Contracts', () => {
    it('GET /api/projects/:projectId/evidence returns evidence array envelope', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/evidence`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.evidence)).toBe(true);
    });

    it('GET /api/demo/status returns demo status contract', async () => {
      const res = await request(app).get('/api/demo/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('isSeeded');
      expect(typeof res.body.isSeeded).toBe('boolean');
    });
  });
});
