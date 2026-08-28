import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { SqliteProjectEventRepository } from '../src/repositories/project-event.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';

describe('Pass 17 — Full End-to-End Realistic Project Intelligence Fixture', () => {
  let app: ReturnType<typeof createApp>;
  let projectAId: string;
  let projectBId: string;
  let scheduleAId: string;
  let scheduleBId: string;

  const AS_OF_DATE = '2026-08-20';

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    const db = getDatabase();
    const scheduleRepo = new SqliteScheduleRepository(() => db);
    const activityRepo = new SqliteActivityRepository(() => db);
    const progressRepo = new SqliteActivityProgressRepository(() => db);
    const updateRepo = new SqliteProgressUpdateRepository(() => db);
    const eventRepo = new SqliteProjectEventRepository(() => db);

    // ==========================================
    // 1. Create Project A (Primary Testing Target)
    // ==========================================
    const pARes = await request(app)
      .post('/api/projects')
      .send({ name: 'Urban Metro Line 3', code: 'UML-03' });
    projectAId = pARes.body.project.id;

    const sA = scheduleRepo.create({
      projectId: projectAId,
      name: 'Baseline Schedule v1',
      sourceType: 'csv'
    });
    scheduleAId = sA.id;

    // Progress update on AS_OF_DATE
    const update1 = updateRepo.create({
      projectId: projectAId,
      reportDate: AS_OF_DATE,
      reporterName: 'Chief Resident Engineer',
      sourceType: 'manual',
      rawText: 'Execution update for August 20'
    });

    // Activity A: DELAYED (Planned finish passed 2026-08-10, actual progress 45%)
    const actA = activityRepo.create({
      projectId: projectAId,
      scheduleId: scheduleAId,
      externalId: 'ACT-A',
      name: 'Site Grading & Earthworks',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-10'
    });
    progressRepo.create({
      projectId: projectAId,
      activityId: actA.id,
      actualPercent: 45,
      status: 'in_progress',
      asOfDate: AS_OF_DATE
    });

    // Activity B: AT RISK (Planned 2026-08-01 to 2026-08-25, as of 08-20 planned is ~79%, actual is 50%, variance <= -10%)
    const actB = activityRepo.create({
      projectId: projectAId,
      scheduleId: scheduleAId,
      externalId: 'ACT-B',
      name: 'Retaining Wall Construction',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-25'
    });
    progressRepo.create({
      projectId: projectAId,
      activityId: actB.id,
      actualPercent: 50,
      status: 'in_progress',
      asOfDate: AS_OF_DATE
    });

    // Activity C: COMPLETED TODAY (Completed observation on 2026-08-20)
    const actC = activityRepo.create({
      projectId: projectAId,
      scheduleId: scheduleAId,
      externalId: 'ACT-C',
      name: 'Underground Utility Relocation',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-20'
    });
    progressRepo.create({
      projectId: projectAId,
      activityId: actC.id,
      progressUpdateId: update1.id,
      actualPercent: 100,
      status: 'completed',
      actualFinish: AS_OF_DATE,
      asOfDate: AS_OF_DATE
    });

    // Activity D: BEHIND SCHEDULE (Planned 2026-08-01 to 2026-08-30, planned ~65.5%, actual 60%, variance -5.5% -> behind)
    const actD = activityRepo.create({
      projectId: projectAId,
      scheduleId: scheduleAId,
      externalId: 'ACT-D',
      name: 'Pre-Cast Girder Fabrication',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-30'
    });
    progressRepo.create({
      projectId: projectAId,
      activityId: actD.id,
      actualPercent: 60,
      status: 'in_progress',
      asOfDate: AS_OF_DATE
    });

    // Activity E: APPROACHING MILESTONE (Zero-duration milestone on 2026-08-27, 7 days away from 08-20)
    activityRepo.create({
      projectId: projectAId,
      scheduleId: scheduleAId,
      externalId: 'ACT-E',
      name: 'Pier 12 Structural Sign-Off',
      plannedStart: '2026-08-27',
      plannedFinish: '2026-08-27'
    });

    // Activity F: NO RECENT UPDATE (Planned 2026-08-25 to 2026-08-30, never updated)
    activityRepo.create({
      projectId: projectAId,
      scheduleId: scheduleAId,
      externalId: 'ACT-F',
      name: 'Drainage Pipe Installation',
      plannedStart: '2026-08-25',
      plannedFinish: '2026-08-30'
    });

    // Recent project events for Project A on AS_OF_DATE
    eventRepo.create({
      projectId: projectAId,
      eventType: 'progress_updated',
      summary: 'Daily site progress logged for Aug 20',
      payloadJson: JSON.stringify({ reporter: 'CRE', count: 4 }),
      createdAt: '2026-08-20 10:00:00'
    });
    eventRepo.create({
      projectId: projectAId,
      eventType: 'evidence_uploaded',
      summary: 'Site inspection photos uploaded',
      payloadJson: JSON.stringify({ fileCount: 3 }),
      createdAt: '2026-08-20 11:30:00'
    });

    // ==========================================
    // 2. Create Project B (Isolation Target)
    // ==========================================
    const pBRes = await request(app)
      .post('/api/projects')
      .send({ name: 'Suburban Flyover Project', code: 'SFP-99' });
    projectBId = pBRes.body.project.id;

    const sB = scheduleRepo.create({
      projectId: projectBId,
      name: 'Flyover Baseline',
      sourceType: 'xlsx'
    });
    scheduleBId = sB.id;

    const actForeign = activityRepo.create({
      projectId: projectBId,
      scheduleId: scheduleBId,
      externalId: 'ACT-FOREIGN-DELAY',
      name: 'Foreign Delayed Activity',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-10'
    });
    progressRepo.create({
      projectId: projectBId,
      activityId: actForeign.id,
      actualPercent: 10,
      status: 'in_progress',
      asOfDate: AS_OF_DATE
    });

    eventRepo.create({
      projectId: projectBId,
      eventType: 'project_updated',
      summary: 'Foreign project settings modified',
      createdAt: '2026-08-20 09:00:00'
    });
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should accurately populate all 7 intelligence categories for realistic project A', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectAId}/intelligence`)
      .query({
        asOfDate: AS_OF_DATE,
        recentDays: 7,
        approachingDays: 14
      });

    expect(res.status).toBe(200);
    const body = res.body;

    // 1. Delayed
    expect(body.delayed).toHaveLength(1);
    expect(body.delayed[0].externalId).toBe('ACT-A');
    expect(body.delayed[0].classification).toBe('DELAYED');
    expect(body.delayed[0].overdue).toBe(true);

    // 2. At Risk
    expect(body.atRisk).toHaveLength(1);
    expect(body.atRisk[0].externalId).toBe('ACT-B');
    expect(body.atRisk[0].classification).toBe('AT_RISK');

    // 3. Completed Today
    expect(body.completedToday).toHaveLength(1);
    expect(body.completedToday[0].externalId).toBe('ACT-C');
    expect(body.completedToday[0].actualPercent).toBe(100);
    expect(body.completedToday[0].status).toBe('completed');
    expect(body.completedToday[0].asOfDate).toBe(AS_OF_DATE);

    // 4. Behind Schedule (Both ACT-A overdue, ACT-B strong variance, and ACT-D moderate variance are behind)
    expect(body.behindSchedule.map((b: { externalId: string }) => b.externalId)).toContain('ACT-D');
    const actDItem = body.behindSchedule.find((b: { externalId: string }) => b.externalId === 'ACT-D');
    expect(actDItem?.varianceState).toBe('behind');

    // 5. Approaching Milestones
    expect(body.approachingMilestones).toHaveLength(1);
    expect(body.approachingMilestones[0].externalId).toBe('ACT-E');
    expect(body.approachingMilestones[0].milestoneDate).toBe('2026-08-27');
    expect(body.approachingMilestones[0].daysUntil).toBe(7);

    // 6. Stale Activities (ACT-E has no updates, ACT-F has no updates)
    expect(body.staleActivities.some((s: { externalId: string }) => s.externalId === 'ACT-F')).toBe(true);
    const actFItem = body.staleActivities.find((s: { externalId: string }) => s.externalId === 'ACT-F');
    expect(actFItem?.hasAnyUpdate).toBe(false);
    expect(actFItem?.latestUpdateDate).toBeNull();

    // 7. Recent Changes
    expect(body.recentChanges).toHaveLength(2);
    expect(body.recentChanges[0].summary).toBe('Site inspection photos uploaded');
    expect(body.recentChanges[1].summary).toBe('Daily site progress logged for Aug 20');
  });

  it('should enforce 100% strict cross-project isolation', async () => {
    const resA = await request(app)
      .get(`/api/projects/${projectAId}/intelligence`)
      .query({ asOfDate: AS_OF_DATE });
    const resB = await request(app)
      .get(`/api/projects/${projectBId}/intelligence`)
      .query({ asOfDate: AS_OF_DATE });

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    // Project A must contain ZERO data from Project B
    const allForeignIdsInA = [
      ...resA.body.delayed.map((d: { externalId: string }) => d.externalId),
      ...resA.body.atRisk.map((r: { externalId: string }) => r.externalId),
      ...resA.body.behindSchedule.map((b: { externalId: string }) => b.externalId),
      ...resA.body.completedToday.map((c: { externalId: string }) => c.externalId),
      ...resA.body.approachingMilestones.map((m: { externalId: string }) => m.externalId),
      ...resA.body.staleActivities.map((s: { externalId: string }) => s.externalId)
    ];
    expect(allForeignIdsInA).not.toContain('ACT-FOREIGN-DELAY');

    const allForeignEventsInA = resA.body.recentChanges.map((e: { summary: string }) => e.summary);
    expect(allForeignEventsInA).not.toContain('Foreign project settings modified');

    // Project B must contain ONLY Project B delayed item
    expect(resB.body.delayed).toHaveLength(1);
    expect(resB.body.delayed[0].externalId).toBe('ACT-FOREIGN-DELAY');
    expect(resB.body.recentChanges).toHaveLength(1);
    expect(resB.body.recentChanges[0].summary).toBe('Foreign project settings modified');
  });
});
