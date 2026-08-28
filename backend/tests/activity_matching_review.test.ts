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
import { NotFoundError, ValidationError, DatabaseError } from '../src/errors/AppError.js';

describe('ActivityMatchingReview (Pass 19 Review Actions & Historical Immutability)', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let updateRepo: SqliteProgressUpdateRepository;
  let matchRepo: SqliteActivityMatchRepository;
  let progressRepo: SqliteActivityProgressRepository;
  let eventRepo: SqliteProjectEventRepository;
  let service: ActivityMatchingService;
  let progressService: DefaultProgressService;

  let projectAId: string;
  let projectBId: string;
  let scheduleAId: string;
  let scheduleBId: string;
  let actA1Id: string;
  let actA2Id: string;
  let actB1Id: string;
  let updateAId: string;

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

    service = new ActivityMatchingService({
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

    // Project A setup
    const pA = projectRepo.create({ name: 'Project Alpha', code: 'PRJ-A', status: 'active' });
    projectAId = pA.id;
    const sA = scheduleRepo.create({ projectId: projectAId, name: 'Schedule A', sourceType: 'csv' });
    scheduleAId = sA.id;
    const aA1 = activityRepo.create({
      projectId: projectAId,
      scheduleId: scheduleAId,
      externalId: 'ACT-A1',
      name: 'Foundation Excavation',
      location: 'Zone 1',
      plannedStart: '2026-09-01',
      plannedFinish: '2026-09-15'
    });
    actA1Id = aA1.id;
    const aA2 = activityRepo.create({
      projectId: projectAId,
      scheduleId: scheduleAId,
      externalId: 'ACT-A2',
      name: 'Foundation Rebar Placement',
      location: 'Zone 1',
      plannedStart: '2026-09-16',
      plannedFinish: '2026-09-30'
    });
    actA2Id = aA2.id;

    // Project B setup
    const pB = projectRepo.create({ name: 'Project Beta', code: 'PRJ-B', status: 'active' });
    projectBId = pB.id;
    const sB = scheduleRepo.create({ projectId: projectBId, name: 'Schedule B', sourceType: 'csv' });
    scheduleBId = sB.id;
    const aB1 = activityRepo.create({
      projectId: projectBId,
      scheduleId: scheduleBId,
      externalId: 'ACT-B1',
      name: 'Beta Foundation Excavation',
      location: 'Beta Site',
      plannedStart: '2026-09-01',
      plannedFinish: '2026-09-15'
    });
    actB1Id = aB1.id;

    const uA = updateRepo.create({
      projectId: projectAId,
      reportDate: '2026-09-02',
      reporterName: 'Supervisor Alice',
      sourceType: 'manual',
      rawText: 'Foundation excavation progressing at Zone 1.'
    });
    updateAId = uA.id;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('Automatic Confirmation & Suggested / Unresolved Routing', () => {
    it('should auto-confirm high isolated match with reviewedBy=system and emit match_auto_confirmed atomically', async () => {
      const extraction: FieldProgressExtraction = {
        items: [
          {
            reference: 'ACT-A1', // Exact ID match -> 0.99 confidence
            location: 'Zone 1',
            progress_percent: 40,
            status: 'in_progress'
          }
        ]
      };

      const result = await service.matchProgressUpdate(projectAId, updateAId, extraction);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].confidenceTier).toBe('high');
      expect(result.matches[0].reviewDecision?.autoConfirm).toBe(true);

      const persisted = matchRepo.listByProgressUpdateId(updateAId, projectAId);
      expect(persisted).toHaveLength(1);
      expect(persisted[0].status).toBe('confirmed');
      expect(persisted[0].confidenceTier).toBe('high');
      expect(persisted[0].reviewState).toBe('resolved');
      expect(persisted[0].reviewedBy).toBe('system');
      expect(persisted[0].reviewedAt).not.toBeNull();

      // Verify audit event persisted in same transaction
      const events = eventRepo.listByProjectId(projectAId);
      const autoConfirmEvent = events.find((e) => e.eventType === 'match_auto_confirmed');
      expect(autoConfirmEvent).toBeDefined();
      expect(autoConfirmEvent?.entityId).toBe(persisted[0].id);
    });

    it('should route medium match to suggested and awaiting_review without auto-confirming', async () => {
      const extraction: FieldProgressExtraction = {
        items: [
          {
            reference: 'Foundation Excavation',
            progress_percent: 50,
            status: 'in_progress'
          }
        ]
      };

      const result = await service.matchProgressUpdate(projectAId, updateAId, extraction);
      expect(result.matches).toHaveLength(1);

      const persisted = matchRepo.listByProgressUpdateId(updateAId, projectAId);
      expect(persisted).toHaveLength(1);
      expect(persisted[0].status).toBe('suggested');
      expect(persisted[0].reviewState).toBe('awaiting_review');
      expect(persisted[0].reviewedBy).toBeNull();
      expect(persisted[0].reviewedAt).toBeNull();

      const events = eventRepo.listByProjectId(projectAId);
      const suggestEvent = events.find((e) => e.eventType === 'match_suggested');
      expect(suggestEvent).toBeDefined();
      expect(suggestEvent?.entityId).toBe(persisted[0].id);
    });
  });

  describe('Legal State Transitions & Transition Matrix Validation (Sections 2, 14)', () => {
    it('awaiting_review -> confirm: accepted', async () => {
      const match = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.72,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'medium',
        reviewState: 'awaiting_review'
      });

      const confirmed = await service.confirmMatch(projectAId, match.id, 'Engineer Bob');
      expect(confirmed.status).toBe('confirmed');
      expect(confirmed.reviewState).toBe('resolved');
      expect(confirmed.reviewedBy).toBe('Engineer Bob');
    });

    it('awaiting_review -> reject: accepted', async () => {
      const match = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.70,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'medium',
        reviewState: 'awaiting_review'
      });

      const rejected = await service.rejectMatch(projectAId, match.id, 'Auditor', 'Not applicable');
      expect(rejected.status).toBe('rejected');
      expect(rejected.reviewState).toBe('resolved');
      expect(rejected.reviewedBy).toBe('Auditor');
    });

    it('unresolved -> resolve: accepted', async () => {
      const match = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.44,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'low',
        reviewState: 'unresolved'
      });

      const resolved = await service.resolveMatch(projectAId, match.id, actA2Id, 'Manager Dave');
      expect(resolved.status).toBe('confirmed');
      expect(resolved.reviewState).toBe('resolved');
      expect(resolved.activityId).toBe(actA2Id);
      expect(resolved.matchMethod).toBe('manual');
    });

    it('unresolved -> reject: accepted', async () => {
      const match = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.40,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'low',
        reviewState: 'unresolved'
      });

      const rejected = await service.rejectMatch(projectAId, match.id, 'Manager Dave');
      expect(rejected.status).toBe('rejected');
      expect(rejected.reviewState).toBe('resolved');
    });

    it('unresolved -> confirm: rejected with ValidationError', async () => {
      const match = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.40,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'low',
        reviewState: 'unresolved'
      });

      await expect(service.confirmMatch(projectAId, match.id, 'Alice')).rejects.toThrow(
        ValidationError
      );
    });

    it('confirmed -> confirm: rejected with ValidationError', async () => {
      const match = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.95,
        matchMethod: 'exact_id',
        status: 'confirmed',
        confidenceTier: 'high',
        reviewState: 'resolved',
        reviewedBy: 'system'
      });

      await expect(service.confirmMatch(projectAId, match.id, 'Bob')).rejects.toThrow(
        ValidationError
      );
    });

    it('confirmed -> reject: rejected with ValidationError', async () => {
      const match = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.95,
        matchMethod: 'exact_id',
        status: 'confirmed',
        confidenceTier: 'high',
        reviewState: 'resolved',
        reviewedBy: 'system'
      });

      await expect(service.rejectMatch(projectAId, match.id, 'Bob')).rejects.toThrow(
        ValidationError
      );
    });

    it('confirmed -> resolve: rejected with ValidationError', async () => {
      const match = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.95,
        matchMethod: 'exact_id',
        status: 'confirmed',
        confidenceTier: 'high',
        reviewState: 'resolved',
        reviewedBy: 'system'
      });

      await expect(service.resolveMatch(projectAId, match.id, actA2Id, 'Bob')).rejects.toThrow(
        ValidationError
      );
    });

    it('rejected -> confirm: rejected with ValidationError', async () => {
      const match = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.50,
        matchMethod: 'text_similarity',
        status: 'rejected',
        confidenceTier: 'medium',
        reviewState: 'resolved',
        reviewedBy: 'Auditor'
      });

      await expect(service.confirmMatch(projectAId, match.id, 'Alice')).rejects.toThrow(
        ValidationError
      );
    });

    it('rejected -> reject: rejected with ValidationError', async () => {
      const match = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.50,
        matchMethod: 'text_similarity',
        status: 'rejected',
        confidenceTier: 'medium',
        reviewState: 'resolved',
        reviewedBy: 'Auditor'
      });

      await expect(service.rejectMatch(projectAId, match.id, 'Alice')).rejects.toThrow(
        ValidationError
      );
    });

    it('rejected -> resolve: rejected with ValidationError', async () => {
      const match = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.50,
        matchMethod: 'text_similarity',
        status: 'rejected',
        confidenceTier: 'medium',
        reviewState: 'resolved',
        reviewedBy: 'Auditor'
      });

      await expect(service.resolveMatch(projectAId, match.id, actA2Id, 'Alice')).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe('Required Immutability Test (Section 15)', () => {
    it('confirmed match referenced by ActivityProgress cannot be retargeted with /resolve', async () => {
      // 1. Create confirmed match M1 for Foundation Excavation (actA1Id)
      const m1 = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.95,
        matchMethod: 'exact_id',
        status: 'confirmed',
        confidenceTier: 'high',
        reviewState: 'resolved',
        reviewedBy: 'system'
      });

      // 2. Create canonical progress from M1
      const progress = progressService.normalizeAndRecordProgress({
        projectId: projectAId,
        updateId: updateAId,
        matchId: m1.id,
        fact: {
          reference: 'ACT-A1',
          progress_percent: 60,
          status: 'in_progress'
        }
      });
      expect(progress.activityId).toBe(actA1Id);

      // 3. Attempt to resolve/retarget M1 to actA2Id (Foundation Rebar)
      await expect(
        service.resolveMatch(projectAId, m1.id, actA2Id, 'Malicious Lead', 'Retarget to Rebar')
      ).rejects.toThrow(ValidationError);

      // 4. Verify historical match record is unchanged
      const currentMatch = matchRepo.getById(m1.id);
      expect(currentMatch?.activityId).toBe(actA1Id);
      expect(currentMatch?.status).toBe('confirmed');

      // 5. Verify canonical ActivityProgress still points to actA1Id
      const currentProgress = progressRepo.getById(progress.id);
      expect(currentProgress?.activityId).toBe(actA1Id);
      expect(currentProgress?.actualPercent).toBe(60);
    });
  });

  describe('Atomic Transactions & Audit Failure Rollback (Sections 16, 17)', () => {
    it('Audit failure during confirm: rolls back match state completely', async () => {
      const match = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.75,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'medium',
        reviewState: 'awaiting_review'
      });

      // Force project_events insert to fail by adding a restrictive trigger on project_events
      db.prepare(`
        CREATE TRIGGER test_fail_confirm_event
        BEFORE INSERT ON project_events
        FOR EACH ROW
        WHEN NEW.event_type = 'match_confirmed'
        BEGIN
          SELECT RAISE(FAIL, 'Forced audit event failure');
        END;
      `).run();

      // Attempt to confirm match -> must throw DatabaseError
      await expect(
        service.confirmMatch(projectAId, match.id, 'Engineer Bob')
      ).rejects.toThrow();

      // Verify database state: match is STILL 'suggested' and reviewedBy is NULL (rolled back!)
      const dbMatch = matchRepo.getById(match.id);
      expect(dbMatch?.status).toBe('suggested');
      expect(dbMatch?.reviewState).toBe('awaiting_review');
      expect(dbMatch?.reviewedBy).toBeNull();
      expect(dbMatch?.reviewedAt).toBeNull();

      // Verify zero project_events exist for match_confirmed
      const events = eventRepo.listByProjectId(projectAId);
      expect(events.find((e) => e.eventType === 'match_confirmed')).toBeUndefined();
    });

    it('Audit failure during reject: rolls back match state completely', async () => {
      const match = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.75,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'medium',
        reviewState: 'awaiting_review'
      });

      db.prepare(`
        CREATE TRIGGER test_fail_reject_event
        BEFORE INSERT ON project_events
        FOR EACH ROW
        WHEN NEW.event_type = 'match_rejected'
        BEGIN
          SELECT RAISE(FAIL, 'Forced audit event failure');
        END;
      `).run();

      await expect(
        service.rejectMatch(projectAId, match.id, 'Auditor', 'Not relevant')
      ).rejects.toThrow();

      const dbMatch = matchRepo.getById(match.id);
      expect(dbMatch?.status).toBe('suggested');
      expect(dbMatch?.reviewState).toBe('awaiting_review');
      expect(dbMatch?.reviewedBy).toBeNull();

      const events = eventRepo.listByProjectId(projectAId);
      expect(events.find((e) => e.eventType === 'match_rejected')).toBeUndefined();
    });

    it('Audit failure during resolve: rolls back match state completely', async () => {
      const match = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.45,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'low',
        reviewState: 'unresolved'
      });

      db.prepare(`
        CREATE TRIGGER test_fail_resolve_event
        BEFORE INSERT ON project_events
        FOR EACH ROW
        WHEN NEW.event_type = 'match_resolved'
        BEGIN
          SELECT RAISE(FAIL, 'Forced audit event failure');
        END;
      `).run();

      await expect(
        service.resolveMatch(projectAId, match.id, actA2Id, 'Manager Dave')
      ).rejects.toThrow();

      const dbMatch = matchRepo.getById(match.id);
      expect(dbMatch?.status).toBe('suggested');
      expect(dbMatch?.reviewState).toBe('unresolved');
      expect(dbMatch?.activityId).toBe(actA1Id);
      expect(dbMatch?.matchMethod).toBe('text_similarity');

      const events = eventRepo.listByProjectId(projectAId);
      expect(events.find((e) => e.eventType === 'match_resolved')).toBeUndefined();
    });
  });

  describe('Project Isolation & Cross-Project Boundary Invariants (Section 23)', () => {
    it('Project A match cannot be confirmed through Project B (404 NotFoundError)', async () => {
      const matchA = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.70,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'medium',
        reviewState: 'awaiting_review'
      });

      await expect(
        service.confirmMatch(projectBId, matchA.id, 'Hacker')
      ).rejects.toThrow(NotFoundError);
    });

    it('Project A match cannot be rejected through Project B (404 NotFoundError)', async () => {
      const matchA = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.70,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'medium',
        reviewState: 'awaiting_review'
      });

      await expect(
        service.rejectMatch(projectBId, matchA.id, 'Hacker')
      ).rejects.toThrow(NotFoundError);
    });

    it('Project A match cannot resolve to Project B activity (404 NotFoundError)', async () => {
      const matchA = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.40,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'low',
        reviewState: 'unresolved'
      });

      await expect(
        service.resolveMatch(projectAId, matchA.id, actB1Id, 'Reviewer') // actB1Id belongs to Project B
      ).rejects.toThrow(NotFoundError);
    });

    it('Project A review events do not appear in Project B queries', async () => {
      const matchA = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.75,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'medium',
        reviewState: 'awaiting_review'
      });

      await service.confirmMatch(projectAId, matchA.id, 'Reviewer Alice');

      const eventsA = eventRepo.listByProjectId(projectAId);
      const eventsB = eventRepo.listByProjectId(projectBId);

      expect(eventsA.some((e) => e.eventType === 'match_confirmed')).toBe(true);
      expect(eventsB.some((e) => e.eventType === 'match_confirmed')).toBe(false);
    });
  });
});
