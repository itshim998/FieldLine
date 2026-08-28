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

describe('Pass 20 — Primary Project Dashboard Router (GET /api/projects/:projectId/dashboard)', () => {
  let app: ReturnType<typeof createApp>;
  let testProjectId: string;
  let otherProjectId: string;
  let testScheduleId: string;

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
      .send({ name: 'Central Express Link', code: 'CEL-01' });
    testProjectId = pRes.body.project.id;

    // Create second project for isolation testing
    const pRes2 = await request(app)
      .post('/api/projects')
      .send({ name: 'Secondary Spur Line', code: 'SSL-02' });
    otherProjectId = pRes2.body.project.id;

    // 2. Create baseline schedule for primary project
    const s1 = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Baseline Schedule v1',
      sourceType: 'csv'
    });
    testScheduleId = s1.id;

    // 3. Create activities
    const act1 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'FOUND-100',
      name: 'Foundation Pour Pier 1',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-10'
    });

    const act2 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'DECK-200',
      name: 'Deck Slab Pour',
      plannedStart: '2026-08-05',
      plannedFinish: '2026-08-25'
    });

    const actMilestone = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'MS-GROUND',
      name: 'Groundbreaking Milestone',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-01'
    });

    // 4. Create progress updates & matches
    const upd1 = progressUpdateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-15',
      reporterName: 'Vikram Chief Eng',
      reporterRole: 'Chief Engineer',
      sourceType: 'manual',
      rawText: 'Foundation complete 100%, deck delayed at 20%'
    });

    matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: upd1.id,
      activityId: act1.id,
      confidenceScore: 0.98,
      matchMethod: 'exact_id',
      matchedText: 'Foundation',
      rationale: 'Exact activity reference',
      status: 'confirmed',
      confidenceTier: 'high',
      reviewState: 'resolved',
      reviewedBy: 'system',
      reviewedAt: '2026-08-15T10:00:00.000Z'
    });

    matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: upd1.id,
      activityId: act2.id,
      confidenceScore: 0.60,
      matchMethod: 'text_similarity',
      matchedText: 'deck',
      rationale: 'Text match',
      status: 'suggested',
      confidenceTier: 'medium',
      reviewState: 'unresolved'
    });

    // Canonical observation for confirmed match
    progressRepo.create({
      projectId: testProjectId,
      activityId: act1.id,
      progressUpdateId: upd1.id,
      actualPercent: 100,
      actualStart: '2026-08-01',
      actualFinish: '2026-08-10',
      status: 'completed',
      asOfDate: '2026-08-15'
    });

    // Milestone observation
    progressRepo.create({
      projectId: testProjectId,
      activityId: actMilestone.id,
      actualPercent: 100,
      status: 'completed',
      asOfDate: '2026-08-15'
    });

    // Evidence upload for project
    evidenceRepo.create({
      projectId: testProjectId,
      progressUpdateId: upd1.id,
      fileName: 'site_photo_pier1.jpg',
      filePath: '/internal/storage/site_photo_pier1.jpg',
      fileType: 'image',
      fileSizeBytes: 2048576,
      mimeType: 'image/jpeg',
      contentSha256: 'sha256img123'
    });
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should return 200 with complete project dashboard composition', async () => {
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/dashboard`)
      .query({ asOfDate: '2026-08-15' });

    expect(res.status).toBe(200);

    // 1. Project Summary
    expect(res.body.project.id).toBe(testProjectId);
    expect(res.body.project.name).toBe('Central Express Link');
    expect(res.body.project.code).toBe('CEL-01');

    // 2. Health
    expect(res.body.health.asOfDate).toBe('2026-08-15');
    expect(typeof res.body.health.overallActualProgress).toBe('number');
    expect(typeof res.body.health.overallPlannedProgress).toBe('number');
    expect(typeof res.body.health.progressVariance).toBe('number');
    expect(['ON_TRACK', 'AHEAD', 'AT_RISK', 'DELAYED', 'COMPLETED']).toContain(
      res.body.health.overallRiskClassification
    );

    // 3. Activity Status
    expect(res.body.activityStatus.totalActivities).toBe(3);
    expect(typeof res.body.activityStatus.completed).toBe('number');
    expect(typeof res.body.activityStatus.onTrack).toBe('number');

    // 4. Milestones
    expect(Array.isArray(res.body.milestones.upcoming)).toBe(true);
    expect(Array.isArray(res.body.milestones.completed)).toBe(true);
    expect(Array.isArray(res.body.milestones.late)).toBe(true);
    expect(res.body.milestones.completed.length).toBeGreaterThanOrEqual(1);
    expect(res.body.milestones.completed[0].externalId).toBe('MS-GROUND');

    // 5. Attention
    expect(res.body.attention.unresolvedMatchesCount).toBe(1);
    expect(res.body.attention.unresolvedMatches[0].activityExternalId).toBe('DECK-200');

    // 6. Recent Updates
    expect(res.body.recentUpdates.length).toBe(1);
    expect(res.body.recentUpdates[0].reporterName).toBe('Vikram Chief Eng');
    expect(res.body.recentUpdates[0].matches.length).toBe(2);
    expect(res.body.recentUpdates[0].evidenceList.length).toBe(1);
    expect(res.body.recentUpdates[0].evidenceList[0].fileName).toBe('site_photo_pier1.jpg');
    // Ensure filesystem path is not exposed
    expect((res.body.recentUpdates[0].evidenceList[0] as any).filePath).toBeUndefined();
  });

  it('should use default snapshot date when asOfDate is omitted', async () => {
    const res = await request(app).get(`/api/projects/${testProjectId}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.body.health.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should return empty collections cleanly for a new project with no activities or updates', async () => {
    const res = await request(app).get(`/api/projects/${otherProjectId}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.body.project.id).toBe(otherProjectId);
    expect(res.body.health.overallActualProgress).toBe(0);
    expect(res.body.health.overallPlannedProgress).toBe(0);
    expect(res.body.activityStatus.totalActivities).toBe(0);
    expect(res.body.milestones.upcoming).toHaveLength(0);
    expect(res.body.milestones.completed).toHaveLength(0);
    expect(res.body.milestones.late).toHaveLength(0);
    expect(res.body.recentUpdates).toHaveLength(0);
    expect(res.body.attention.delayedCount).toBe(0);
    expect(res.body.attention.unresolvedMatchesCount).toBe(0);
  });

  it('should return 400 when invalid query parameters are supplied', async () => {
    const res1 = await request(app)
      .get(`/api/projects/${testProjectId}/dashboard`)
      .query({ asOfDate: 'invalid-date' });
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .get(`/api/projects/${testProjectId}/dashboard`)
      .query({ recentLimit: 0 });
    expect(res2.status).toBe(400);
  });

  it('should return 404 when project does not exist', async () => {
    const res = await request(app).get(
      '/api/projects/ffffffff-ffff-ffff-ffff-ffffffffffff/dashboard'
    );
    expect(res.status).toBe(404);
  });
});
