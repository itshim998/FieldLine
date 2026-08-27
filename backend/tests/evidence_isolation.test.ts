import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';

describe('Evidence Cross-Project Isolation & Security Enforcement', () => {
  let app: ReturnType<typeof createApp>;
  let projectAId: string;
  let projectBId: string;
  let updateAId: string;
  let updateBId: string;
  let evidenceAId: string;

  const testTempDir = path.resolve(process.cwd(), 'test-isolation-artifacts');
  const dummyFileA = path.join(testTempDir, 'confidential_project_a.pdf');
  const dummyFileB = path.join(testTempDir, 'confidential_project_b.xlsx');

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    if (!fs.existsSync(testTempDir)) {
      fs.mkdirSync(testTempDir, { recursive: true });
    }
    fs.writeFileSync(dummyFileA, 'PROJECT-A-CONFIDENTIAL-DATA');
    fs.writeFileSync(dummyFileB, 'PROJECT-B-CONFIDENTIAL-DATA');

    // Create Project A & Project B
    const resA = await request(app)
      .post('/api/projects')
      .send({ name: 'Project Alpha High Speed Rail', code: 'PA-HSR' });
    projectAId = resA.body.project.id;

    const resB = await request(app)
      .post('/api/projects')
      .send({ name: 'Project Beta Solar Park', code: 'PB-SOLAR' });
    projectBId = resB.body.project.id;

    // Create updates in each
    const uARes = await request(app)
      .post(`/api/projects/${projectAId}/progress-updates`)
      .send({
        reportDate: '2026-08-20',
        rawText: 'Alpha viaduct construction status report.'
      });
    updateAId = uARes.body.progressUpdate.id;

    const uBRes = await request(app)
      .post(`/api/projects/${projectBId}/progress-updates`)
      .send({
        reportDate: '2026-08-21',
        rawText: 'Beta inverter installation status report.'
      });
    updateBId = uBRes.body.progressUpdate.id;

    // Upload evidence to Project A
    const evARes = await request(app)
      .post(`/api/projects/${projectAId}/evidence`)
      .attach('file', dummyFileA)
      .field('progressUpdateId', updateAId);
    evidenceAId = evARes.body.evidence.id;
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(testTempDir)) {
      try {
        fs.rmSync(testTempDir, { recursive: true, force: true });
      } catch {
        // Ignore test cleanup
      }
    }
  });

  it('Invariant 1: Project A evidence metadata cannot be read through Project B routes', async () => {
    const res = await request(app).get(
      `/api/projects/${projectBId}/evidence/${evidenceAId}`
    );

    expect(res.status).toBe(404);
  });

  it('Invariant 2: Project A evidence content cannot be accessed through Project B route', async () => {
    const res = await request(app).get(
      `/api/projects/${projectBId}/evidence/${evidenceAId}/content`
    );

    expect(res.status).toBe(404);
  });

  it('Invariant 3: Uploading Project B evidence with Project A progressUpdateId is rejected', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectBId}/evidence`)
      .attach('file', dummyFileB)
      .field('progressUpdateId', updateAId); // updateAId belongs to Project A!

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('belongs to a different project');
  });

  it('Invariant 4: Project B evidence list does not leak Project A evidence', async () => {
    const res = await request(app).get(`/api/projects/${projectBId}/evidence`);

    expect(res.status).toBe(200);
    expect(res.body.evidence).toHaveLength(0);
  });

  it('Invariant 5: Cross-project activity traceability returns zero foreign evidence', async () => {
    // 1. Create schedule and activity in Project B
    const schedRes = await request(app)
      .post(`/api/projects/${projectBId}/schedules/import`)
      .attach(
        'file',
        Buffer.from(
          'Activity ID,Activity Name,Planned Start,Planned Finish\nACT-B1,Beta Array Setup,2026-08-01,2026-08-31'
        ),
        'schedule_b.csv'
      );

    const actRes = await request(app).get(
      `/api/projects/${projectBId}/schedules/${schedRes.body.schedule.id}/activities`
    );
    const activityBId = actRes.body.activities[0].id;

    // 2. Query traceability on Project B activity
    const traceRes = await request(app).get(
      `/api/projects/${projectBId}/activities/${activityBId}/evidence`
    );

    expect(traceRes.status).toBe(200);
    expect(traceRes.body.evidence).toHaveLength(0);
  });

  it('Invariant 6: Project A evidence cannot be deleted through Project B route', async () => {
    const delRes = await request(app).delete(
      `/api/projects/${projectBId}/evidence/${evidenceAId}`
    );

    expect(delRes.status).toBe(404);

    // Verify still exists in Project A
    const checkRes = await request(app).get(
      `/api/projects/${projectAId}/evidence/${evidenceAId}`
    );
    expect(checkRes.status).toBe(200);
  });
});
