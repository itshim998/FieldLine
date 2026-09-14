import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { goldenProjectManifest } from '../../demo/golden-demo-manifest.js';
import { projectRepository } from '../src/repositories/project.repository.js';
import { env } from '../src/config/env.js';

describe('Demo Router Endpoints & Golden Demo Self-Healing', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('GET /api/demo/status returns isSeeded: false when database has no golden demo', async () => {
    const res = await request(app).get('/api/demo/status');
    expect(res.status).toBe(200);
    expect(res.body.isSeeded).toBe(false);
    expect(res.body.project).toBeNull();
    expect(res.body.stats).toBeNull();
  });

  it('POST /api/demo/seed populates the golden demo dataset', async () => {
    const res = await request(app).post('/api/demo/seed').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.seedResult).toBeDefined();
    expect(res.body.seedResult.projectCode).toBe(goldenProjectManifest.code);
    expect(res.body.seedResult.activitiesCount).toBe(30);

    const statusRes = await request(app).get('/api/demo/status');
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.isSeeded).toBe(true);
    expect(statusRes.body.project.code).toBe(goldenProjectManifest.code);
  });

  it('POST /api/demo/seed is idempotent when already seeded', async () => {
    await request(app).post('/api/demo/seed').send({});
    const res = await request(app).post('/api/demo/seed').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.seeded).toBe(false);
    expect(res.body.project.code).toBe(goldenProjectManifest.code);
  });

  it('POST /api/demo/seed with force: true re-seeds cleanly', async () => {
    await request(app).post('/api/demo/seed').send({});
    const res = await request(app).post('/api/demo/seed').send({ force: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.seedResult.activitiesCount).toBe(30);
  });

  it('POST /api/demo/reset cleanly resets and re-populates the golden demo dataset', async () => {
    await request(app).post('/api/demo/seed').send({});

    const res = await request(app).post('/api/demo/reset').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.seedResult.activitiesCount).toBe(30);
    expect(res.body.project.code).toBe(goldenProjectManifest.code);
  });

  it('GET /api/projects?autoSeed=true does NOT seed when AUTO_SEED_DEMO is false', async () => {
    expect(projectRepository.count()).toBe(0);
    const originalAutoSeed = env.AUTO_SEED_DEMO;
    (env as any).AUTO_SEED_DEMO = false;

    try {
      const res = await request(app).get('/api/projects?autoSeed=true');
      expect(res.status).toBe(200);
      expect(res.body.projects).toBeDefined();
      expect(res.body.projects).toHaveLength(0);
      expect(projectRepository.count()).toBe(0);
    } finally {
      (env as any).AUTO_SEED_DEMO = originalAutoSeed;
    }
  });

  it('GET /api/projects?autoSeed=true triggers self-healing auto-seed when AUTO_SEED_DEMO is true', async () => {
    expect(projectRepository.count()).toBe(0);
    const originalAutoSeed = env.AUTO_SEED_DEMO;
    (env as any).AUTO_SEED_DEMO = true;

    try {
      const res = await request(app).get('/api/projects?autoSeed=true');
      expect(res.status).toBe(200);
      expect(res.body.projects).toBeDefined();
      expect(res.body.projects.length).toBeGreaterThanOrEqual(1);

      const goldenProject = res.body.projects.find(
        (p: { code: string }) => p.code === goldenProjectManifest.code
      );
      expect(goldenProject).toBeDefined();
      expect(goldenProject.name).toBe(goldenProjectManifest.name);
      expect(projectRepository.count()).toBeGreaterThanOrEqual(1);
    } finally {
      (env as any).AUTO_SEED_DEMO = originalAutoSeed;
    }
  });
});
