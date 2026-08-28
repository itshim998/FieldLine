import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { SqliteEvidenceRepository } from '../src/repositories/evidence.repository.js';

describe('Pass 21 — Activity Detail Router (GET /api/projects/:projectId/activities/:activityId)', () => {
  let app: ReturnType<typeof createApp>;
  let testProjectId: string;
  let otherProjectId: string;
  let testScheduleId: string;
  let testActivityId: string;
  let otherActivityId: string;

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    const db = getDatabase();
    const scheduleRepo = new SqliteScheduleRepository(() => db);
    const activityRepo = new SqliteActivityRepository(() => db);
    const progressRepo = new SqliteActivityProgressRepository(() => db);
    const progressUpdateRepo = new SqliteProgressUpdateRepository(() => db);
    const matchRepo = new SqliteActivityMatchRepository(() => db);
    const evidenceRepo = new SqliteEvidenceRepository(() => db);

    // 1. Create primary project
    const pRes = await request(app)
      .post('/api/projects')
      .send({ name: 'Commercial Tower Project', code: 'CTP-01' });
    testProjectId = pRes.body.project.id;

    // Create second project for isolation testing
    const pRes2 = await request(app)
      .post('/api/projects')
      .send({ name: 'Bridge Rehabilitation', code: 'BR-02' });
    otherProjectId = pRes2.body.project.id;

    // 2. Create baseline schedules
    const s1 = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Baseline Schedule v1',
      sourceType: 'csv'
    });
    testScheduleId = s1.id;

    const s2 = scheduleRepo.create({
      projectId: otherProjectId,
      name: 'Other Project Schedule',
      sourceType: 'csv'
    });

    // 3. Create target activity (Section 35 Scenario: Foundation — Block B)
    const act = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-1042',
      name: 'Foundation — Block B',
      description: 'Excavation and sub-slab concrete foundation for Block B',
      wbsCode: '03.02',
      location: 'East Wing',
      plannedStart: '2026-08-20',
      plannedFinish: '2026-08-30',
      plannedQuantity: 500,
      unit: 'm3',
      baselineProgress: 0
    });
    testActivityId = act.id;

    const otherAct = activityRepo.create({
      projectId: otherProjectId,
      scheduleId: s2.id,
      externalId: 'PIER-09',
      name: 'Bridge Pier Construction',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-20'
    });
    otherActivityId = otherAct.id;

    // 4. Create Progress Updates & Evidence
    const upd1 = progressUpdateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-22',
      reporterName: 'John Site Engineer',
      reporterRole: 'Site Engineer',
      sourceType: 'manual',
      rawText: 'Started foundation work 0%'
    });

    const upd2 = progressUpdateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-23',
      reporterName: 'Sarah QA',
      reporterRole: 'QA Manager',
      sourceType: 'xlsx',
      rawText: 'Concrete pour reached 35%'
    });

    const upd3 = progressUpdateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-24',
      reporterName: 'Dave Foreman',
      reporterRole: 'General Foreman',
      sourceType: 'pdf',
      rawText: 'Inspected pour at 60%'
    });

    // Evidence
    const ev1 = evidenceRepo.create({
      projectId: testProjectId,
      progressUpdateId: upd2.id,
      fileName: 'Report-003.xlsx',
      filePath: 'C:\\storage\\vault\\Report-003.xlsx',
      fileType: 'xlsx',
      fileSizeBytes: 54000
    });

    const ev2 = evidenceRepo.create({
      projectId: testProjectId,
      progressUpdateId: upd3.id,
      fileName: 'Report-004.pdf',
      filePath: 'C:\\storage\\vault\\Report-004.pdf',
      fileType: 'pdf',
      fileSizeBytes: 128000
    });

    db.prepare('UPDATE evidence SET uploaded_at = ? WHERE id = ?').run('2026-08-23 14:30:00', ev1.id);
    db.prepare('UPDATE evidence SET uploaded_at = ? WHERE id = ?').run('2026-08-24 17:00:00', ev2.id);

    // Matches
    matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: upd2.id,
      evidenceId: ev1.id,
      activityId: testActivityId,
      confidenceScore: 0.95,
      matchMethod: 'exact_id',
      matchedText: 'ACT-1042',
      status: 'confirmed',
      confidenceTier: 'high',
      reviewState: 'resolved',
      reviewedBy: 'system'
    });

    matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: upd3.id,
      evidenceId: ev2.id,
      activityId: testActivityId,
      confidenceScore: 0.92,
      matchMethod: 'text_similarity',
      matchedText: 'Foundation Block B',
      status: 'confirmed',
      confidenceTier: 'high',
      reviewState: 'resolved',
      reviewedBy: 'Dave Foreman'
    });

    // Observations
    progressRepo.create({
      projectId: testProjectId,
      activityId: testActivityId,
      progressUpdateId: upd1.id,
      actualPercent: 0,
      actualStart: '2026-08-22',
      status: 'started',
      asOfDate: '2026-08-22',
      notes: 'Site work started'
    });

    progressRepo.create({
      projectId: testProjectId,
      activityId: testActivityId,
      progressUpdateId: upd2.id,
      actualPercent: 35,
      actualStart: '2026-08-22',
      status: 'in_progress',
      asOfDate: '2026-08-23',
      notes: 'Pour at 35%'
    });

    progressRepo.create({
      projectId: testProjectId,
      activityId: testActivityId,
      progressUpdateId: upd3.id,
      actualPercent: 60,
      actualStart: '2026-08-22',
      status: 'in_progress',
      asOfDate: '2026-08-24',
      notes: 'Pour reached 60%'
    });
  });

  afterEach(() => {
    closeDatabase();
  });

  it('GET /api/projects/:projectId/activities/:activityId returns 200 with full DTO shape', async () => {
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/activities/${testActivityId}?asOfDate=2026-08-25`)
      .expect(200);

    expect(res.body).toHaveProperty('activity');
    expect(res.body).toHaveProperty('current');
    expect(res.body).toHaveProperty('timeline');
    expect(res.body).toHaveProperty('progressUpdates');
    expect(res.body).toHaveProperty('matches');
    expect(res.body).toHaveProperty('evidence');

    // Activity Identity
    expect(res.body.activity).toEqual({
      activityId: testActivityId,
      externalId: 'ACT-1042',
      name: 'Foundation — Block B',
      description: 'Excavation and sub-slab concrete foundation for Block B',
      wbsCode: '03.02',
      location: 'East Wing',
      scheduleId: testScheduleId,
      plannedStart: '2026-08-20',
      plannedFinish: '2026-08-30',
      plannedQuantity: 500,
      unit: 'm3',
      baselineProgress: 0
    });

    // Current State (As of 2026-08-25, 5 days elapsed out of 10 -> planned 50%, actual 60%)
    expect(res.body.current.actualProgress).toBe(60);
    expect(res.body.current.actualStart).toBe('2026-08-22');
    expect(res.body.current.asOfDate).toBe('2026-08-25');

    // Timeline
    expect(res.body.timeline).toHaveLength(3);
    expect(res.body.timeline[0]).toMatchObject({
      date: '2026-08-22',
      actualPercent: 0,
      status: 'started',
      source: 'manual'
    });
    expect(res.body.timeline[1]).toMatchObject({
      date: '2026-08-23',
      actualPercent: 35,
      status: 'in_progress',
      source: 'xlsx'
    });
    expect(res.body.timeline[2]).toMatchObject({
      date: '2026-08-24',
      actualPercent: 60,
      status: 'in_progress',
      source: 'pdf'
    });

    // Progress updates
    expect(res.body.progressUpdates).toHaveLength(3);

    // Matches
    expect(res.body.matches).toHaveLength(2);
    expect(res.body.matches.every((m: any) => m.canonicalProgressEligible === true)).toBe(true);

    // Evidence
    expect(res.body.evidence).toHaveLength(2);
    expect(res.body.evidence[0].fileName).toBe('Report-004.pdf');
    expect(res.body.evidence[1].fileName).toBe('Report-003.xlsx');

    // Filepath must never be leaked
    expect((res.body.evidence[0] as any).filePath).toBeUndefined();
    expect((res.body.evidence[1] as any).filePath).toBeUndefined();
  });

  it('GET /api/projects/:projectId/activities/:activityId with historical asOfDate excludes future observations', async () => {
    // Querying as of Aug 23 (Section 35 integration scenario)
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/activities/${testActivityId}?asOfDate=2026-08-23`)
      .expect(200);

    // Current actual progress as of Aug 23 must be 35%
    expect(res.body.current.actualProgress).toBe(35);
    expect(res.body.current.asOfDate).toBe('2026-08-23');

    // Timeline must only have Aug 22 and Aug 23 observations
    expect(res.body.timeline).toHaveLength(2);
    expect(res.body.timeline.map((t: any) => t.date)).toEqual(['2026-08-22', '2026-08-23']);
  });

  it('GET /api/projects/:projectId/activities/:activityId rejects invalid asOfDate with 400', async () => {
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/activities/${testActivityId}?asOfDate=bad-date`)
      .expect(400);

    expect(res.body.error).toBeDefined();
  });

  it('GET /api/projects/:projectId/activities/:activityId rejects non-existent activity with 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/activities/${fakeId}`)
      .expect(404);

    expect(res.body.error).toContain('not found');
  });

  it('GET /api/projects/:projectId/activities/:activityId rejects cross-project access with 404', async () => {
    // Request other project's activity under primary project URL
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/activities/${otherActivityId}`)
      .expect(404);

    expect(res.body.error).toContain('not found');
  });
});
