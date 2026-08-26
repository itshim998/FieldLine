import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';

const fixturesDir = path.resolve(process.cwd(), 'backend', 'tests', 'fixtures');

describe('E2E Schedule Validation and Persistence Safety', () => {
  let app: ReturnType<typeof createApp>;
  let projectId: string;

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    // Create a test project
    const projRes = await request(app)
      .post('/api/projects')
      .send({
        name: 'Metro Line Corridor Project',
        code: 'MLC-01',
        description: 'Underground rail transit expansion'
      });
    expect(projRes.status).toBe(201);
    projectId = projRes.body.project.id;
  });

  afterEach(() => {
    closeDatabase();
  });

  it('PASS 6 Complete Flow: Rejects invalid schedule, returns 422 with structured issues, leaves 0 database artifacts', async () => {
    const invalidCsvPath = path.join(fixturesDir, 'invalid_pass6_schedule.csv');
    expect(fs.existsSync(invalidCsvPath)).toBe(true);

    const initialDb = getDatabase();
    const initialScheduleCount = (initialDb.prepare('SELECT COUNT(*) as c FROM schedules').get() as { c: number }).c;
    const initialActivityCount = (initialDb.prepare('SELECT COUNT(*) as c FROM activities').get() as { c: number }).c;

    // 1. Attempt to import invalid schedule
    const res = await request(app)
      .post(`/api/projects/${projectId}/schedules/import`)
      .attach('file', invalidCsvPath);

    // 2. Expect 422 Unprocessable Entity
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SCHEDULE_VALIDATION_ERROR');
    expect(res.body.error).toContain('validation error');
    expect(res.body.details).toBeDefined();
    expect(res.body.details.issues).toBeInstanceOf(Array);
    expect(res.body.details.issues.length).toBe(4);

    const issues = res.body.details.issues;
    const codes = issues.map((i: any) => i.code);

    // Verify all 4 distinct semantic errors were captured together
    expect(codes).toContain('START_AFTER_FINISH');
    expect(codes).toContain('DUPLICATE_ACTIVITY_ID');
    expect(codes).toContain('INVALID_QUANTITY');
    expect(codes).toContain('INVALID_PERCENTAGE');

    // Verify detailed messages and row numbers
    const dateIssue = issues.find((i: any) => i.code === 'START_AFTER_FINISH');
    expect(dateIssue.rowNumber).toBe(3);
    expect(dateIssue.field).toBe('plannedFinish');
    expect(dateIssue.message).toContain('Start date 2026-06-15 is after finish date 2026-06-01');

    const dupIssue = issues.find((i: any) => i.code === 'DUPLICATE_ACTIVITY_ID');
    expect(dupIssue.rowNumber).toBe(4);
    expect(dupIssue.field).toBe('externalId');
    expect(dupIssue.message).toContain('Duplicate activity ID \'act-001\'');

    const qtyIssue = issues.find((i: any) => i.code === 'INVALID_QUANTITY');
    expect(qtyIssue.rowNumber).toBe(4);
    expect(qtyIssue.field).toBe('plannedQuantity');
    expect(qtyIssue.message).toContain('Planned quantity must be a non-negative finite number (got -50)');

    const progIssue = issues.find((i: any) => i.code === 'INVALID_PERCENTAGE');
    expect(progIssue.rowNumber).toBe(4);
    expect(progIssue.field).toBe('baselineProgress');
    expect(progIssue.message).toContain('Baseline progress must be between 0 and 100 (got 150)');

    // 3. Verify zero database artifacts
    const finalScheduleCount = (initialDb.prepare('SELECT COUNT(*) as c FROM schedules').get() as { c: number }).c;
    const finalActivityCount = (initialDb.prepare('SELECT COUNT(*) as c FROM activities').get() as { c: number }).c;
    expect(finalScheduleCount).toBe(initialScheduleCount);
    expect(finalActivityCount).toBe(initialActivityCount);

    // 4. Verify API queries confirm zero schedules
    const listRes = await request(app).get(`/api/projects/${projectId}/schedules`);
    expect(listRes.body.schedules).toHaveLength(0);
  });

  it('PASS 6 Valid Flow: Valid CSV and XLSX imports continue to succeed through normalization and validation', async () => {
    // 1. Import valid CSV
    const validCsvPath = path.join(fixturesDir, 'valid_schedule.csv');
    const csvRes = await request(app)
      .post(`/api/projects/${projectId}/schedules/import`)
      .attach('file', validCsvPath);

    expect(csvRes.status).toBe(201);
    expect(csvRes.body.success).toBe(true);
    expect(csvRes.body.activitiesImported).toBe(5);

    // 2. Import valid XLSX
    const validXlsxPath = path.join(fixturesDir, 'valid_schedule.xlsx');
    const xlsxRes = await request(app)
      .post(`/api/projects/${projectId}/schedules/import`)
      .attach('file', validXlsxPath);

    expect(xlsxRes.status).toBe(201);
    expect(xlsxRes.body.success).toBe(true);
    expect(xlsxRes.body.activitiesImported).toBe(3);

    // 3. Confirm both schedules and their activities are persisted
    const listRes = await request(app).get(`/api/projects/${projectId}/schedules`);
    expect(listRes.body.schedules).toHaveLength(2);
  });

  it('Health Endpoint: remains healthy throughout operations', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database.status).toBe('connected');
  });
});
