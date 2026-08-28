import { describe, it, expect, beforeEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { SqliteProjectEventRepository } from '../src/repositories/project-event.repository.js';
import { DefaultProgressSnapshotService } from '../src/services/snapshot/progress-snapshot.service.js';
import {
  DefaultProjectIntelligenceService,
  ProjectIntelligenceService
} from '../src/services/intelligence/project-intelligence.service.js';
import { NotFoundError, ValidationError } from '../src/errors/AppError.js';

describe('ProjectIntelligenceService (Deterministic Structured Fact Queries)', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let progressRepo: SqliteActivityProgressRepository;
  let eventRepo: SqliteProjectEventRepository;
  let intelligenceService: ProjectIntelligenceService;

  let projectAId: string;
  let projectBId: string;
  let scheduleAId: string;
  let scheduleBId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    progressRepo = new SqliteActivityProgressRepository(() => db);
    eventRepo = new SqliteProjectEventRepository(() => db);

    const snapshotService = new DefaultProgressSnapshotService({
      projectRepo,
      activityRepo,
      activityProgressRepo: progressRepo
    });

    intelligenceService = new DefaultProjectIntelligenceService({
      projectRepo,
      activityRepo,
      activityProgressRepo: progressRepo,
      projectEventRepo: eventRepo,
      progressSnapshotService: snapshotService
    });

    const pA = projectRepo.create({
      name: 'Corridor A Project',
      code: 'CAP-01',
      status: 'active'
    });
    projectAId = pA.id;

    const pB = projectRepo.create({
      name: 'Tunnel B Project',
      code: 'TBP-02',
      status: 'active'
    });
    projectBId = pB.id;

    const sA = scheduleRepo.create({
      projectId: projectAId,
      name: 'Corridor Baseline',
      sourceType: 'csv'
    });
    scheduleAId = sA.id;

    const sB = scheduleRepo.create({
      projectId: projectBId,
      name: 'Tunnel Baseline',
      sourceType: 'xlsx'
    });
    scheduleBId = sB.id;
  });

  it('should throw NotFoundError if project does not exist', () => {
    expect(() =>
      intelligenceService.getIntelligence('non-existent-id')
    ).toThrow(NotFoundError);
  });

  it('should validate query parameters and throw ValidationError on invalid inputs', () => {
    expect(() =>
      intelligenceService.getIntelligence(projectAId, { asOfDate: 'invalid-date' })
    ).toThrow(ValidationError);

    expect(() =>
      intelligenceService.getIntelligence(projectAId, { recentDays: -5 })
    ).toThrow(ValidationError);

    expect(() =>
      intelligenceService.getIntelligence(projectAId, { approachingDays: -1 })
    ).toThrow(ValidationError);
  });

  describe('1. Delayed Activities Query', () => {
    it('should return DELAYED activities and exclude non-delayed activities', () => {
      // Act 1: plannedFinish 2026-08-10, actual 50% as of 2026-08-15 -> DELAYED (overdue)
      const act1 = activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'ACT-DEL',
        name: 'Overdue Activity',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-10'
      });
      progressRepo.create({
        projectId: projectAId,
        activityId: act1.id,
        actualPercent: 50,
        status: 'in_progress',
        asOfDate: '2026-08-15'
      });

      // Act 2: plannedFinish 2026-08-25, actual 50% as of 2026-08-15 -> ON_TRACK
      activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'ACT-ONTRACK',
        name: 'On Track Activity',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-25'
      });

      const intel = intelligenceService.getIntelligence(projectAId, {
        asOfDate: '2026-08-15'
      });

      expect(intel.delayed).toHaveLength(1);
      expect(intel.delayed[0].externalId).toBe('ACT-DEL');
      expect(intel.delayed[0].classification).toBe('DELAYED');
      expect(intel.delayed[0].overdue).toBe(true);
      expect(intel.delayed[0].reasons[0].code).toBe('overdue');
    });
  });

  describe('2. At-Risk Activities Query', () => {
    it('should return AT_RISK activities and exclude ON_TRACK/AHEAD', () => {
      // Act 1: planned 2026-08-01 to 2026-08-20 (14 days elapsed of 19 => ~73.68% planned).
      // Actual 50% -> variance = -23.68% <= -10.0 => AT_RISK
      const actRisk = activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'ACT-RISK',
        name: 'Lagging Activity',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-20'
      });
      progressRepo.create({
        projectId: projectAId,
        activityId: actRisk.id,
        actualPercent: 50,
        status: 'in_progress',
        asOfDate: '2026-08-15'
      });

      // Act 2: ON_TRACK (100% completed)
      const actComp = activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'ACT-COMP',
        name: 'Done Activity',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-15'
      });
      progressRepo.create({
        projectId: projectAId,
        activityId: actComp.id,
        actualPercent: 100,
        status: 'completed',
        asOfDate: '2026-08-15'
      });

      const intel = intelligenceService.getIntelligence(projectAId, {
        asOfDate: '2026-08-15'
      });

      expect(intel.atRisk).toHaveLength(1);
      expect(intel.atRisk[0].externalId).toBe('ACT-RISK');
      expect(intel.atRisk[0].classification).toBe('AT_RISK');
      expect(intel.atRisk[0].progressVariance).toBeLessThan(-10);
    });
  });

  describe('3. Completed Today Query', () => {
    it('should return activities completed today (actualFinish === canonicalAsOfDate)', () => {
      // Act 1: completed on 2026-08-28 (actualFinish = 2026-08-28)
      const act1 = activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'ACT-DONE-TODAY',
        name: 'Finished Today',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-28'
      });
      progressRepo.create({
        projectId: projectAId,
        activityId: act1.id,
        actualPercent: 100,
        status: 'completed',
        actualFinish: '2026-08-28',
        asOfDate: '2026-08-28'
      });

      const intel = intelligenceService.getIntelligence(projectAId, {
        asOfDate: '2026-08-28'
      });

      expect(intel.completedToday).toHaveLength(1);
      expect(intel.completedToday[0].externalId).toBe('ACT-DONE-TODAY');
      expect(intel.completedToday[0].actualFinish).toBe('2026-08-28');
      expect(intel.completedToday[0].actualPercent).toBe(100);
      expect(intel.completedToday[0].status).toBe('completed');
    });

    it('should NOT return activities completed earlier even if observed today (completed earlier, observed today)', () => {
      // Act: completed on 2026-08-20, but latest observation as of 2026-08-28 shows completion
      const act = activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'ACT-DONE-EARLIER',
        name: 'Finished Earlier',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-20'
      });
      progressRepo.create({
        projectId: projectAId,
        activityId: act.id,
        actualPercent: 100,
        status: 'completed',
        actualFinish: '2026-08-20',
        asOfDate: '2026-08-28'
      });

      // Querying for 2026-08-28 must NOT include act because it completed on 2026-08-20
      const intelToday = intelligenceService.getIntelligence(projectAId, {
        asOfDate: '2026-08-28'
      });
      expect(intelToday.completedToday).toHaveLength(0);

      // Querying for 2026-08-20 (historical snapshot with matching observation)
      // If we record observation as-of 2026-08-20
      progressRepo.create({
        projectId: projectAId,
        activityId: act.id,
        actualPercent: 100,
        status: 'completed',
        actualFinish: '2026-08-20',
        asOfDate: '2026-08-20'
      });
      const intelHistorical = intelligenceService.getIntelligence(projectAId, {
        asOfDate: '2026-08-20'
      });
      expect(intelHistorical.completedToday).toHaveLength(1);
      expect(intelHistorical.completedToday[0].externalId).toBe('ACT-DONE-EARLIER');
    });

    it('should NOT return future completion for historical snapshot', () => {
      const act = activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'ACT-FUTURE-COMP',
        name: 'Future Completion',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-25'
      });
      progressRepo.create({
        projectId: projectAId,
        activityId: act.id,
        actualPercent: 100,
        status: 'completed',
        actualFinish: '2026-08-25',
        asOfDate: '2026-08-25'
      });

      // Query historical snapshot as of 2026-08-20 (before completion)
      const intel = intelligenceService.getIntelligence(projectAId, {
        asOfDate: '2026-08-20'
      });
      expect(intel.completedToday).toHaveLength(0);
    });

    it('should exclude activities with 100% progress but no actualFinish date (fallback behavior)', () => {
      const act = activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'ACT-NO-FINISH-DATE',
        name: 'No Actual Finish Date',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-28'
      });
      progressRepo.create({
        projectId: projectAId,
        activityId: act.id,
        actualPercent: 100,
        status: 'completed',
        actualFinish: null,
        asOfDate: '2026-08-28'
      });

      const intel = intelligenceService.getIntelligence(projectAId, {
        asOfDate: '2026-08-28'
      });
      // Excluded because actualFinish date is missing and we do not invent a completion date
      expect(intel.completedToday).toHaveLength(0);
    });

    it('should ensure evidence upload and job completion timestamps cannot create completedToday', () => {
      const act = activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'ACT-IN-PROGRESS',
        name: 'In Progress Activity',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-30'
      });
      // Activity is in_progress (50%)
      progressRepo.create({
        projectId: projectAId,
        activityId: act.id,
        actualPercent: 50,
        status: 'in_progress',
        asOfDate: '2026-08-28'
      });

      // Evidence uploaded on 2026-08-28
      db.prepare(`
        INSERT INTO evidence (id, project_id, file_name, file_path, file_type, uploaded_at, created_at)
        VALUES ('ev-test-1', ?, 'site_photo.jpg', '/uploads/photo.jpg', 'image', '2026-08-28T10:00:00.000Z', '2026-08-28T10:00:00.000Z')
      `).run(projectAId);

      // Job completed on 2026-08-28
      db.prepare(`
        INSERT INTO processing_jobs (id, project_id, job_type, status, payload_json, created_at, updated_at, completed_at)
        VALUES ('job-test-1', ?, 'document_ingestion', 'completed', '{}', '2026-08-28T10:00:00.000Z', '2026-08-28T10:05:00.000Z', '2026-08-28T10:05:00.000Z')
      `).run(projectAId);

      const intel = intelligenceService.getIntelligence(projectAId, {
        asOfDate: '2026-08-28'
      });

      // Must NOT appear in completedToday despite evidence and job completion on this date
      expect(intel.completedToday).toHaveLength(0);
    });
  });

  describe('4. Behind-Schedule Activities Query', () => {
    it('should return activities with varianceState behind', () => {
      // Planned: 2026-08-01 to 2026-08-20, asOfDate 2026-08-10 -> 47.37% planned
      // Actual 20% -> behind
      const actBehind = activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'ACT-BEHIND',
        name: 'Slow Excavation',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-20'
      });
      progressRepo.create({
        projectId: projectAId,
        activityId: actBehind.id,
        actualPercent: 20,
        status: 'in_progress',
        asOfDate: '2026-08-10'
      });

      // Act Ahead: planned 47.37%, actual 80%
      const actAhead = activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'ACT-AHEAD',
        name: 'Fast Excavation',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-20'
      });
      progressRepo.create({
        projectId: projectAId,
        activityId: actAhead.id,
        actualPercent: 80,
        status: 'in_progress',
        asOfDate: '2026-08-10'
      });

      const intel = intelligenceService.getIntelligence(projectAId, {
        asOfDate: '2026-08-10'
      });

      expect(intel.behindSchedule).toHaveLength(1);
      expect(intel.behindSchedule[0].externalId).toBe('ACT-BEHIND');
      expect(intel.behindSchedule[0].varianceState).toBe('behind');
      expect(intel.behindSchedule[0].progressVariance).toBeLessThan(-0.01);
    });
  });

  describe('5. Approaching Milestones Query', () => {
    it('should return zero-duration milestones within approaching window and exclude past or far future milestones', () => {
      // Milestone 1: planned 2026-08-18 (3 days away from 2026-08-15) -> approaching
      activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'M-APPROACH',
        name: 'Foundation Signoff',
        plannedStart: '2026-08-18',
        plannedFinish: '2026-08-18'
      });

      // Milestone 2: planned 2026-08-10 (past milestone) -> excluded
      activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'M-PAST',
        name: 'Groundbreaking',
        plannedStart: '2026-08-10',
        plannedFinish: '2026-08-10'
      });

      // Milestone 3: planned 2026-09-30 (far future > 14 days) -> excluded
      activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'M-FAR',
        name: 'Project Commissioning',
        plannedStart: '2026-09-30',
        plannedFinish: '2026-09-30'
      });

      // Standard non-milestone activity (duration > 0) -> excluded
      activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'ACT-STANDARD',
        name: 'Piling',
        plannedStart: '2026-08-18',
        plannedFinish: '2026-08-25'
      });

      const intel = intelligenceService.getIntelligence(projectAId, {
        asOfDate: '2026-08-15',
        approachingDays: 14
      });

      expect(intel.approachingMilestones).toHaveLength(1);
      expect(intel.approachingMilestones[0].externalId).toBe('M-APPROACH');
      expect(intel.approachingMilestones[0].milestoneDate).toBe('2026-08-18');
      expect(intel.approachingMilestones[0].daysUntil).toBe(3);
    });
  });

  describe('6. Stale Activities Query', () => {
    it('should classify unupdated activities and old observations as stale', () => {
      // Act 1: Never updated -> stale
      activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'ACT-NO-UPDATE',
        name: 'Unmonitored Activity',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-20'
      });

      // Act 2: Updated on 2026-08-01 (19 days ago relative to 2026-08-20 with recentDays=7) -> stale
      const actOld = activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'ACT-OLD-UPDATE',
        name: 'Old Monitored Activity',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-20'
      });
      progressRepo.create({
        projectId: projectAId,
        activityId: actOld.id,
        actualPercent: 10,
        status: 'in_progress',
        asOfDate: '2026-08-01'
      });

      // Act 3: Updated on 2026-08-18 (2 days ago relative to 2026-08-20) -> fresh, not stale
      const actFresh = activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'ACT-FRESH-UPDATE',
        name: 'Recently Monitored Activity',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-20'
      });
      progressRepo.create({
        projectId: projectAId,
        activityId: actFresh.id,
        actualPercent: 50,
        status: 'in_progress',
        asOfDate: '2026-08-18'
      });

      const intel = intelligenceService.getIntelligence(projectAId, {
        asOfDate: '2026-08-20',
        recentDays: 7
      });

      expect(intel.staleActivities).toHaveLength(2);
      // Deterministic sort: no updates first
      expect(intel.staleActivities[0].externalId).toBe('ACT-NO-UPDATE');
      expect(intel.staleActivities[0].hasAnyUpdate).toBe(false);
      expect(intel.staleActivities[0].latestUpdateDate).toBeNull();
      expect(intel.staleActivities[0].daysSinceUpdate).toBeNull();

      expect(intel.staleActivities[1].externalId).toBe('ACT-OLD-UPDATE');
      expect(intel.staleActivities[1].hasAnyUpdate).toBe(true);
      expect(intel.staleActivities[1].latestUpdateDate).toBe('2026-08-01');
      expect(intel.staleActivities[1].daysSinceUpdate).toBe(19);
    });
  });

  describe('7. Recent Changes & Security Sanitization', () => {
    it('should return sanitized recent events and exclude foreign project events', () => {
      // Insert event for Project A with a sensitive absolute path and error stack
      db.prepare(`
        INSERT INTO project_events (id, project_id, event_type, summary, payload_json, created_at)
        VALUES ('evt-1', ?, 'evidence_uploaded', 'Uploaded daily log', ?, '2026-08-19 10:00:00')
      `).run(
        projectAId,
        JSON.stringify({
          fileName: 'daily_log.pdf',
          filePath: 'C:\\Users\\Secret\\Desktop\\daily_log.pdf',
          errorStack: 'Error: secret stack trace at line 42',
          itemCount: 5
        })
      );

      // Insert event for Project B
      db.prepare(`
        INSERT INTO project_events (id, project_id, event_type, summary, created_at)
        VALUES ('evt-b', ?, 'progress_reported', 'Foreign report', '2026-08-19 11:00:00')
      `).run(projectBId);

      const intel = intelligenceService.getIntelligence(projectAId, {
        asOfDate: '2026-08-20',
        recentDays: 7
      });

      expect(intel.recentChanges).toHaveLength(1);
      const fact = intel.recentChanges[0];
      expect(fact.eventId).toBe('evt-1');
      expect(fact.eventType).toBe('evidence_uploaded');
      expect(fact.summary).toBe('Uploaded daily log');
      expect(fact.payload).toEqual({
        fileName: 'daily_log.pdf',
        itemCount: 5
      });
      // Sensitive fields stripped
      expect(fact.payload?.filePath).toBeUndefined();
      expect(fact.payload?.errorStack).toBeUndefined();
    });
  });

  describe('8. Determinism & Project Isolation', () => {
    it('should return identical structured facts across repeated calls', () => {
      const act = activityRepo.create({
        projectId: projectAId,
        scheduleId: scheduleAId,
        externalId: 'ACT-REPEAT',
        name: 'Repeatability Test',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-15'
      });
      progressRepo.create({
        projectId: projectAId,
        activityId: act.id,
        actualPercent: 40,
        status: 'in_progress',
        asOfDate: '2026-08-10'
      });

      const res1 = intelligenceService.getIntelligence(projectAId, {
        asOfDate: '2026-08-10'
      });
      const res2 = intelligenceService.getIntelligence(projectAId, {
        asOfDate: '2026-08-10'
      });

      expect(res1.delayed).toEqual(res2.delayed);
      expect(res1.atRisk).toEqual(res2.atRisk);
      expect(res1.behindSchedule).toEqual(res2.behindSchedule);
      expect(res1.completedToday).toEqual(res2.completedToday);
      expect(res1.approachingMilestones).toEqual(res2.approachingMilestones);
      expect(res1.staleActivities).toEqual(res2.staleActivities);
      expect(res1.recentChanges).toEqual(res2.recentChanges);
    });

    it('should strictly isolate facts between Project A and Project B', () => {
      // Activity in Project B
      const actB = activityRepo.create({
        projectId: projectBId,
        scheduleId: scheduleBId,
        externalId: 'ACT-B-ISOLATION',
        name: 'Foreign Activity',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-05'
      });
      progressRepo.create({
        projectId: projectBId,
        activityId: actB.id,
        actualPercent: 10,
        status: 'in_progress',
        asOfDate: '2026-08-10'
      });

      const intelA = intelligenceService.getIntelligence(projectAId, {
        asOfDate: '2026-08-10'
      });

      // No Project B activities should leak into Project A
      expect(intelA.delayed.some((a) => a.externalId === 'ACT-B-ISOLATION')).toBe(false);
      expect(intelA.atRisk.some((a) => a.externalId === 'ACT-B-ISOLATION')).toBe(false);
      expect(intelA.behindSchedule.some((a) => a.externalId === 'ACT-B-ISOLATION')).toBe(false);
      expect(intelA.staleActivities.some((a) => a.externalId === 'ACT-B-ISOLATION')).toBe(false);
    });
  });
});
