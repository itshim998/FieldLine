import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { seedGoldenDemo } from '../../demo/golden-demo-seeder.js';
import { GOLDEN_AS_OF_DATE, goldenManifestInvariants } from '../../demo/golden-demo-manifest.js';
import { projectRepository } from '../src/repositories/project.repository.js';
import { workerAuthHeader, adminAuthHeader } from './helpers/auth-test-helper.js';

describe('Pass 31 — Worker Operational Tasks ("Today\'s Execution Cockpit")', () => {
  let app: ReturnType<typeof createApp>;
  let projectId: string;
  let otherProjectId: string;

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    // 1. Seed Golden Demo project
    const seedResult = await seedGoldenDemo();
    projectId = seedResult.projectId;

    // 2. Create another project to verify strict project scoping / isolation
    const otherProject = projectRepository.create({
      code: 'PROJECT-ISOLATED',
      name: 'Isolated Second Project',
      description: 'Project used for tenant boundary isolation testing'
    });
    otherProjectId = otherProject.id;
  });

  afterEach(() => {
    closeDatabase();
  });

  it('1. Queries operational tasks as of GOLDEN_AS_OF_DATE with Worker session token', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/worker/operational-tasks`)
      .query({ asOfDate: GOLDEN_AS_OF_DATE })
      .set(workerAuthHeader(projectId));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('projectId', projectId);
    expect(res.body).toHaveProperty('asOfDate', GOLDEN_AS_OF_DATE);
    expect(res.body).toHaveProperty('tasks');
    expect(res.body).toHaveProperty('summary');

    const tasks = res.body.tasks;
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThan(0);

    // Verify canonical contract for task item per Pass 31 spec
    const firstTask = tasks[0];
    expect(firstTask).toHaveProperty('id');
    expect(firstTask).toHaveProperty('externalId');
    expect(firstTask).toHaveProperty('name');
    expect(firstTask).toHaveProperty('location');
    expect(firstTask).toHaveProperty('plannedQuantity');
    expect(firstTask).toHaveProperty('unit');
    expect(firstTask).toHaveProperty('actualProgress');
    expect(firstTask).toHaveProperty('status');
    expect(firstTask).toHaveProperty('isToday');

    // Summary assertions
    expect(res.body.summary.today).toBeGreaterThan(0);
    expect(res.body.summary.delayed).toBe(goldenManifestInvariants.expectedRiskCounts.delayed);
  });

  it('2. Properly categorizes completed activities when querying all or completed scope', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/worker/operational-tasks`)
      .query({ asOfDate: GOLDEN_AS_OF_DATE, scope: 'all' })
      .set(workerAuthHeader(projectId));

    expect(res.status).toBe(200);
    const tasks = res.body.tasks;

    // ACT-A01, ACT-B01, ACT-D01, ACT-E01 are the 4 completed activities in golden demo
    const completedTask = tasks.find((t: any) => t.externalId === 'ACT-A01');
    expect(completedTask).toBeDefined();
    expect(completedTask.status).toBe('COMPLETED');
    expect(completedTask.statusLabel).toBe('Completed');
    expect(completedTask.actualProgress).toBe(100);
    expect(completedTask.isCompleted).toBe(true);

    const b01 = tasks.find((t: any) => t.externalId === 'ACT-B01');
    expect(b01).toBeDefined();
    expect(b01.status).toBe('COMPLETED');
    expect(b01.actualProgress).toBe(100);

    expect(res.body.summary.completed).toBe(goldenManifestInvariants.expectedRiskCounts.completed);
  });

  it('3. Categorizes delayed and at-risk activities accurately', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/worker/operational-tasks`)
      .query({ asOfDate: GOLDEN_AS_OF_DATE })
      .set(workerAuthHeader(projectId));

    expect(res.status).toBe(200);
    const tasks = res.body.tasks;

    // ACT-D02 is overdue and delayed in golden demo
    const delayedTask = tasks.find((t: any) => t.externalId === 'ACT-D02');
    expect(delayedTask).toBeDefined();
    expect(delayedTask.status).toBe('DELAYED');
    expect(delayedTask.statusLabel).toBe('Delayed');
    expect(delayedTask.isOverdue).toBe(true);
    expect(delayedTask.actualProgress).toBeLessThan(100);

    // ACT-C01 is active and at-risk (progress 20% vs target 64.74%)
    const atRiskTask = tasks.find((t: any) => t.externalId === 'ACT-C01');
    expect(atRiskTask).toBeDefined();
    expect(atRiskTask.status).toBe('AT_RISK');
    expect(atRiskTask.statusLabel).toBe('At Risk');
    expect(atRiskTask.isToday).toBe(true);
  });

  it('4. Filters operational tasks by work area / location', async () => {
    // Query only Area C tasks
    const res = await request(app)
      .get(`/api/projects/${projectId}/worker/operational-tasks`)
      .query({ asOfDate: GOLDEN_AS_OF_DATE, locationFilter: 'Area C' })
      .set(workerAuthHeader(projectId));

    expect(res.status).toBe(200);
    const tasks = res.body.tasks;
    expect(tasks.length).toBeGreaterThan(0);

    for (const task of tasks) {
      expect(task.location).toContain('Area C');
    }

    const c01 = tasks.find((t: any) => t.externalId === 'ACT-C01');
    expect(c01).toBeDefined();
  });

  it('5. Supports operational horizon scopes: today, upcoming, delayed', async () => {
    // Scope: today
    const resToday = await request(app)
      .get(`/api/projects/${projectId}/worker/operational-tasks`)
      .query({ asOfDate: GOLDEN_AS_OF_DATE, scope: 'today' })
      .set(workerAuthHeader(projectId));

    expect(resToday.status).toBe(200);
    for (const task of resToday.body.tasks) {
      expect(task.isToday).toBe(true);
    }

    // Scope: delayed
    const resDelayed = await request(app)
      .get(`/api/projects/${projectId}/worker/operational-tasks`)
      .query({ asOfDate: GOLDEN_AS_OF_DATE, scope: 'delayed' })
      .set(workerAuthHeader(projectId));

    expect(resDelayed.status).toBe(200);
    for (const task of resDelayed.body.tasks) {
      expect(task.status === 'DELAYED' || task.isOverdue).toBe(true);
    }

    // Scope: upcoming
    const resUpcoming = await request(app)
      .get(`/api/projects/${projectId}/worker/operational-tasks`)
      .query({ asOfDate: GOLDEN_AS_OF_DATE, scope: 'upcoming' })
      .set(workerAuthHeader(projectId));

    expect(resUpcoming.status).toBe(200);
    for (const task of resUpcoming.body.tasks) {
      expect(task.isUpcoming).toBe(true);
    }
  });

  it('6. Enforces strict project isolation (Project A worker cannot view Project B operational tasks)', async () => {
    // Project A worker attempts to access Project B
    const res = await request(app)
      .get(`/api/projects/${otherProjectId}/worker/operational-tasks`)
      .query({ asOfDate: GOLDEN_AS_OF_DATE })
      .set(workerAuthHeader(projectId)); // Token belongs to projectId, not otherProjectId

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(res.body.error).toContain('Project scope mismatch');
  });

  it('7. Rejects unauthenticated requests with 401 Unauthorized', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/worker/operational-tasks`)
      .query({ asOfDate: GOLDEN_AS_OF_DATE });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTHENTICATION_ERROR');
    expect(res.body.error).toContain('Authentication required');
  });

  it('8. Returns 404 Not Found for nonexistent project', async () => {
    const nonExistentId = 'proj-does-not-exist-9999';
    const res = await request(app)
      .get(`/api/projects/${nonExistentId}/worker/operational-tasks`)
      .query({ asOfDate: GOLDEN_AS_OF_DATE })
      .set(adminAuthHeader(nonExistentId));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.error).toContain('not found');
  });

  it('9. Allows Admin session token to inspect worker operational projection', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/worker/operational-tasks`)
      .query({ asOfDate: GOLDEN_AS_OF_DATE })
      .set(adminAuthHeader(projectId));

    expect(res.status).toBe(200);
    expect(res.body.tasks.length).toBeGreaterThan(0);
  });
});
