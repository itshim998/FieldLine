import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { SqliteProjectEventRepository } from '../src/repositories/project-event.repository.js';
import { ActivityMatchingService } from '../src/services/matching/activity-matching.service.js';
import { DefaultProgressService } from '../src/services/progress/progress.service.js';
import { FieldProgressExtraction } from '../src/ai/contracts/field-progress-extraction.contract.js';
import { ValidationError, NotFoundError } from '../src/errors/AppError.js';

describe('Canonical Truth Protection & Regression Scenarios (Pass 19)', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let updateRepo: SqliteProgressUpdateRepository;
  let matchRepo: SqliteActivityMatchRepository;
  let progressRepo: SqliteActivityProgressRepository;
  let eventRepo: SqliteProjectEventRepository;
  let matchingService: ActivityMatchingService;
  let progressService: DefaultProgressService;

  let projectId: string;
  let scheduleId: string;
  let activity1Id: string;
  let activity2Id: string;
  let activity3Id: string;
  let updateId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    updateRepo = new SqliteProgressUpdateRepository(() => db);
    matchRepo = new SqliteActivityMatchRepository(() => db);
    progressRepo = new SqliteActivityProgressRepository(() => db);
    eventRepo = new SqliteProjectEventRepository(() => db);

    matchingService = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      projectEventRepo: eventRepo
    });

    progressService = new DefaultProgressService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      activityProgressRepo: progressRepo
    });

    const project = projectRepo.create({
      name: 'High Speed Rail Phase 1',
      code: 'HSR-01',
      status: 'active'
    });
    projectId = project.id;

    const schedule = scheduleRepo.create({
      projectId,
      name: 'Baseline Schedule',
      sourceType: 'csv'
    });
    scheduleId = schedule.id;

    const a1 = activityRepo.create({
      projectId,
      scheduleId,
      externalId: 'ACT-101',
      name: 'Foundation Excavation Block B',
      location: 'Block B',
      plannedStart: '2026-09-01',
      plannedFinish: '2026-09-15'
    });
    activity1Id = a1.id;

    const a2 = activityRepo.create({
      projectId,
      scheduleId,
      externalId: 'ACT-102',
      name: 'Foundation Excavation Block C',
      location: 'Block C',
      plannedStart: '2026-09-16',
      plannedFinish: '2026-09-30'
    });
    activity2Id = a2.id;

    const a3 = activityRepo.create({
      projectId,
      scheduleId,
      externalId: 'ACT-103',
      name: 'Concrete Pouring Block B',
      location: 'Block B',
      plannedStart: '2026-10-01',
      plannedFinish: '2026-10-15'
    });
    activity3Id = a3.id;

    const update = updateRepo.create({
      projectId,
      reportDate: '2026-09-05',
      reporterName: 'Supervisor Alice',
      sourceType: 'manual',
      rawText: 'Excavation work is roughly 55% finished.'
    });
    updateId = update.id;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('Scenario A — Medium-confidence confirmation (Section 26)', () => {
    it('AI -> medium -> suggested -> human confirm -> confirmed -> canonical ProgressService', async () => {
      const suggestedMatch = matchRepo.create({
        projectId,
        progressUpdateId: updateId,
        activityId: activity1Id,
        confidenceScore: 0.72,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'medium',
        reviewState: 'awaiting_review'
      });

      // 1. Before human review: cannot create canonical progress
      expect(() =>
        progressService.normalizeAndRecordProgress({
          projectId,
          updateId,
          matchId: suggestedMatch.id,
          fact: { reference: 'Foundation Excavation', progress_percent: 55, status: 'in_progress' }
        })
      ).toThrow(ValidationError);
      expect(progressRepo.listByProjectId(projectId)).toHaveLength(0);

      // 2. Human confirms match
      const confirmedMatch = await matchingService.confirmMatch(projectId, suggestedMatch.id, 'Inspector Bob');
      expect(confirmedMatch.status).toBe('confirmed');
      expect(confirmedMatch.reviewState).toBe('resolved');
      expect(confirmedMatch.reviewedBy).toBe('Inspector Bob');

      // 3. Now canonical ProgressService creates progress
      const recorded = progressService.normalizeAndRecordProgress({
        projectId,
        updateId,
        matchId: confirmedMatch.id,
        fact: { reference: 'Foundation Excavation', progress_percent: 55, status: 'in_progress' }
      });
      expect(recorded.activityId).toBe(activity1Id);
      expect(recorded.actualPercent).toBe(55);
      expect(progressRepo.listByProjectId(projectId)).toHaveLength(1);
    });
  });

  describe('Scenario B — Low-confidence resolution (Section 26)', () => {
    it('AI -> low -> unresolved -> human selects alternative -> manual confirmed -> canonical ProgressService', async () => {
      const lowMatch = matchRepo.create({
        projectId,
        progressUpdateId: updateId,
        activityId: activity1Id,
        confidenceScore: 0.42,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'low',
        reviewState: 'unresolved'
      });

      // 1. Cannot directly confirm without resolving
      await expect(matchingService.confirmMatch(projectId, lowMatch.id, 'Alice')).rejects.toThrow(
        ValidationError
      );

      // 2. Human supervisor resolves to activity 3 (Concrete Pouring)
      const resolvedMatch = await matchingService.resolveMatch(
        projectId,
        lowMatch.id,
        activity3Id,
        'Site Lead Charlie',
        'Observation describes concrete pour'
      );
      expect(resolvedMatch.status).toBe('confirmed');
      expect(resolvedMatch.activityId).toBe(activity3Id);
      expect(resolvedMatch.matchMethod).toBe('manual');
      expect(resolvedMatch.confidenceScore).toBe(0.42); // AI confidence preserved!

      // 3. Record progress on resolved activity
      const recorded = progressService.normalizeAndRecordProgress({
        projectId,
        updateId,
        matchId: resolvedMatch.id,
        fact: { reference: 'Concrete work', progress_percent: 30, status: 'in_progress' }
      });
      expect(recorded.activityId).toBe(activity3Id);
      expect(recorded.actualPercent).toBe(30);

      const act3Progress = progressRepo.listByActivityId(activity3Id, projectId);
      expect(act3Progress).toHaveLength(1);
      expect(progressRepo.listByActivityId(activity1Id, projectId)).toHaveLength(0);
    });
  });

  describe('Scenario C — Rejection (Section 26)', () => {
    it('AI -> suggested -> human reject -> rejected -> no ActivityProgress', async () => {
      const candidateMatch = matchRepo.create({
        projectId,
        progressUpdateId: updateId,
        activityId: activity1Id,
        confidenceScore: 0.65,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'medium',
        reviewState: 'awaiting_review'
      });

      const rejectedMatch = await matchingService.rejectMatch(
        projectId,
        candidateMatch.id,
        'Site Auditor',
        'Irrelevant non-project activity'
      );
      expect(rejectedMatch.status).toBe('rejected');
      expect(rejectedMatch.reviewState).toBe('resolved');

      expect(() =>
        progressService.normalizeAndRecordProgress({
          projectId,
          updateId,
          matchId: rejectedMatch.id,
          fact: { reference: 'Irrelevant', progress_percent: 50, status: 'in_progress' }
        })
      ).toThrow(ValidationError);

      expect(progressRepo.listByProjectId(projectId)).toHaveLength(0);
    });
  });

  describe('Scenario D — Ambiguous high score (Section 26)', () => {
    it('High score without sufficient margin (e.g. 0.91 vs 0.90) -> NOT auto-confirmed -> awaiting review', async () => {
      // Both activity1 (Block B excavation) and activity2 (Block C excavation) match "Excavation" similarly
      const extraction: FieldProgressExtraction = {
        items: [
          {
            reference: 'Foundation Excavation', // Matches both ACT-101 and ACT-102 equally
            progress_percent: 50,
            status: 'in_progress'
          }
        ]
      };

      const matchResult = await matchingService.matchProgressUpdate(projectId, updateId, extraction);
      expect(matchResult.matches).toHaveLength(1);
      const match = matchResult.matches[0];

      // Because top two candidates have close scores, it must not auto-confirm
      expect(match.reviewDecision?.autoConfirm).toBe(false);

      const persisted = matchRepo.listByProgressUpdateId(updateId, projectId);
      expect(persisted).toHaveLength(1);
      expect(persisted[0].status).toBe('suggested');
      expect(persisted[0].reviewState).toBe('awaiting_review');
      expect(persisted[0].reviewedBy).toBeNull();
    });
  });

  describe('Scenario E — Isolated high confidence (Section 26)', () => {
    it('High confidence with exact ID and large margin -> auto-confirmed by system', async () => {
      const extraction: FieldProgressExtraction = {
        items: [
          {
            reference: 'ACT-101', // Exact ID -> 0.99 confidence
            location: 'Block B',
            progress_percent: 80,
            status: 'in_progress'
          }
        ]
      };

      const matchResult = await matchingService.matchProgressUpdate(projectId, updateId, extraction);
      expect(matchResult.matches[0].confidenceTier).toBe('high');
      expect(matchResult.matches[0].reviewDecision?.autoConfirm).toBe(true);

      const persisted = matchRepo.listByProgressUpdateId(updateId, projectId);
      expect(persisted[0].status).toBe('confirmed');
      expect(persisted[0].reviewedBy).toBe('system');
      expect(persisted[0].reviewedAt).not.toBeNull();
    });
  });

  describe('Scenario F — Historical immutability (Section 26)', () => {
    it('Confirmed match used for ActivityProgress cannot be retargeted with /resolve', async () => {
      const match = matchRepo.create({
        projectId,
        progressUpdateId: updateId,
        activityId: activity1Id,
        confidenceScore: 0.95,
        matchMethod: 'exact_id',
        status: 'confirmed',
        confidenceTier: 'high',
        reviewState: 'resolved',
        reviewedBy: 'system'
      });

      const progress = progressService.normalizeAndRecordProgress({
        projectId,
        updateId,
        matchId: match.id,
        fact: { reference: 'ACT-101', progress_percent: 80, status: 'in_progress' }
      });
      expect(progress.activityId).toBe(activity1Id);

      // Attempt to retarget match to activity2Id
      await expect(
        matchingService.resolveMatch(projectId, match.id, activity2Id, 'Supervisor', 'Wrong activity')
      ).rejects.toThrow(ValidationError);

      // Historical match remains pointing to activity1Id
      const currentMatch = matchRepo.getById(match.id);
      expect(currentMatch?.activityId).toBe(activity1Id);
      expect(currentMatch?.status).toBe('confirmed');

      // Canonical progress remains pointing to activity1Id
      const currentProgress = progressRepo.getById(progress.id);
      expect(currentProgress?.activityId).toBe(activity1Id);
    });
  });

  describe('Scenario G — Audit failure rollback (Section 26)', () => {
    it('Forced audit event failure rolls back review update completely', async () => {
      const match = matchRepo.create({
        projectId,
        progressUpdateId: updateId,
        activityId: activity1Id,
        confidenceScore: 0.75,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'medium',
        reviewState: 'awaiting_review'
      });

      // Inject trigger to force event insertion failure
      db.prepare(`
        CREATE TRIGGER force_audit_fail
        BEFORE INSERT ON project_events
        BEGIN
          SELECT RAISE(ABORT, 'Simulated audit event persistence failure');
        END;
      `).run();

      await expect(
        matchingService.confirmMatch(projectId, match.id, 'Engineer Bob')
      ).rejects.toThrow();

      // Verify match state is still suggested and not confirmed
      const dbMatch = matchRepo.getById(match.id);
      expect(dbMatch?.status).toBe('suggested');
      expect(dbMatch?.reviewState).toBe('awaiting_review');
      expect(dbMatch?.reviewedBy).toBeNull();
      expect(dbMatch?.reviewedAt).toBeNull();

      // Zero match_confirmed project events
      const events = eventRepo.listByProjectId(projectId);
      expect(events.filter((e) => e.eventType === 'match_confirmed')).toHaveLength(0);
    });
  });

  describe('Cross-Project Boundary Protection (Section 23)', () => {
    it('Cannot record progress using match from another project', () => {
      const otherProject = projectRepo.create({
        name: 'Other Project',
        code: 'OTH-01',
        status: 'active'
      });
      const otherSchedule = scheduleRepo.create({
        projectId: otherProject.id,
        name: 'Other Schedule',
        sourceType: 'csv'
      });
      const otherActivity = activityRepo.create({
        projectId: otherProject.id,
        scheduleId: otherSchedule.id,
        externalId: 'ACT-OTH-01',
        name: 'Other Activity',
        plannedStart: '2026-09-01',
        plannedFinish: '2026-09-15'
      });
      const otherUpdate = updateRepo.create({
        projectId: otherProject.id,
        reportDate: '2026-09-05',
        sourceType: 'manual',
        rawText: 'Other update'
      });
      const otherMatch = matchRepo.create({
        projectId: otherProject.id,
        progressUpdateId: otherUpdate.id,
        activityId: otherActivity.id,
        confidenceScore: 0.95,
        matchMethod: 'exact_id',
        status: 'confirmed',
        confidenceTier: 'high',
        reviewState: 'resolved'
      });

      expect(() =>
        progressService.normalizeAndRecordProgress({
          projectId, // Project A
          updateId,
          matchId: otherMatch.id, // Project B match
          fact: { reference: 'ACT-101', progress_percent: 40, status: 'in_progress' }
        })
      ).toThrow(NotFoundError);

      expect(progressRepo.listByProjectId(projectId)).toHaveLength(0);
    });
  });
});
