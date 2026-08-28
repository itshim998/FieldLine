import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { SqliteProjectEventRepository } from '../src/repositories/project-event.repository.js';
import { ActivityMatchingService } from '../src/services/matching/activity-matching.service.js';
import { FieldProgressExtraction } from '../src/ai/contracts/field-progress-extraction.contract.js';
import { NotFoundError, ValidationError } from '../src/errors/AppError.js';

describe('ActivityMatchingReview (Pass 19 Review Actions & Project Isolation)', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let updateRepo: SqliteProgressUpdateRepository;
  let matchRepo: SqliteActivityMatchRepository;
  let eventRepo: SqliteProjectEventRepository;
  let service: ActivityMatchingService;

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
    eventRepo = new SqliteProjectEventRepository(() => db);

    service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      projectEventRepo: eventRepo
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
    it('should auto-confirm high isolated match with reviewedBy=system and emit match_auto_confirmed', async () => {
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

      // Verify audit event
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
    });
  });

  describe('Human Review Actions (Confirm, Reject, Resolve)', () => {
    it('should allow human to confirm a suggested match with reviewer identity and timestamp', async () => {
      const suggestedMatch = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.72,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'medium',
        reviewState: 'awaiting_review'
      });

      const confirmed = await service.confirmMatch(projectAId, suggestedMatch.id, 'Engineer Bob');

      expect(confirmed.id).toBe(suggestedMatch.id);
      expect(confirmed.status).toBe('confirmed');
      expect(confirmed.reviewState).toBe('resolved');
      expect(confirmed.reviewedBy).toBe('Engineer Bob');
      expect(confirmed.reviewedAt).toBeTruthy();

      // Check DB
      const dbMatch = matchRepo.getById(suggestedMatch.id);
      expect(dbMatch?.status).toBe('confirmed');
      expect(dbMatch?.reviewedBy).toBe('Engineer Bob');

      // Check event
      const events = eventRepo.listByProjectId(projectAId);
      const confirmEvent = events.find((e) => e.eventType === 'match_confirmed');
      expect(confirmEvent).toBeDefined();
      expect(confirmEvent?.summary).toContain('Engineer Bob');
    });

    it('should allow human to reject a suggested match without deleting the record', async () => {
      const suggestedMatch = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.70,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'medium',
        reviewState: 'awaiting_review'
      });

      const rejected = await service.rejectMatch(
        projectAId,
        suggestedMatch.id,
        'Site Auditor',
        'Observation refers to future phase'
      );

      expect(rejected.id).toBe(suggestedMatch.id);
      expect(rejected.status).toBe('rejected');
      expect(rejected.reviewState).toBe('resolved');
      expect(rejected.reviewedBy).toBe('Site Auditor');
      expect(rejected.rationale).toContain('Observation refers to future phase');

      // Record still exists in DB
      const dbMatch = matchRepo.getById(suggestedMatch.id);
      expect(dbMatch).not.toBeNull();
      expect(dbMatch?.status).toBe('rejected');

      // Event emitted
      const events = eventRepo.listByProjectId(projectAId);
      const rejectEvent = events.find((e) => e.eventType === 'match_rejected');
      expect(rejectEvent).toBeDefined();
      expect(rejectEvent?.summary).toContain('Site Auditor');
    });

    it('should allow human to resolve an unresolved low-confidence match to a different project activity', async () => {
      const lowMatch = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.44,
        matchMethod: 'text_similarity',
        status: 'suggested',
        confidenceTier: 'low',
        reviewState: 'unresolved',
        rationale: 'Low text match.'
      });

      const resolved = await service.resolveMatch(
        projectAId,
        lowMatch.id,
        actA2Id, // Resolve to Activity A2
        'Project Manager Dave',
        'Field work actually corresponds to rebar'
      );

      expect(resolved.id).toBe(lowMatch.id);
      expect(resolved.activityId).toBe(actA2Id);
      expect(resolved.status).toBe('confirmed');
      expect(resolved.reviewState).toBe('resolved');
      expect(resolved.matchMethod).toBe('manual');
      expect(resolved.confidenceScore).toBe(0.44); // Historical confidence preserved
      expect(resolved.reviewedBy).toBe('Project Manager Dave');
      expect(resolved.rationale).toContain('Resolved manually');

      // Event emitted
      const events = eventRepo.listByProjectId(projectAId);
      const resolveEvent = events.find((e) => e.eventType === 'match_resolved');
      expect(resolveEvent).toBeDefined();
      expect(resolveEvent?.payloadJson).toContain(actA2Id);
    });

    it('should reject confirming an already rejected match', async () => {
      const rejectedMatch = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.50,
        matchMethod: 'text_similarity',
        status: 'rejected',
        reviewState: 'resolved',
        reviewedBy: 'Auditor'
      });

      await expect(
        service.confirmMatch(projectAId, rejectedMatch.id, 'Alice')
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('Project Isolation & Cross-Project Boundary Invariants', () => {
    it('should reject confirming Project A match through Project B (404 NotFoundError)', async () => {
      const matchA = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.70,
        matchMethod: 'text_similarity',
        status: 'suggested'
      });

      await expect(
        service.confirmMatch(projectBId, matchA.id, 'Hacker')
      ).rejects.toThrow(NotFoundError);
    });

    it('should reject rejecting Project A match through Project B (404 NotFoundError)', async () => {
      const matchA = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.70,
        matchMethod: 'text_similarity',
        status: 'suggested'
      });

      await expect(
        service.rejectMatch(projectBId, matchA.id, 'Hacker')
      ).rejects.toThrow(NotFoundError);
    });

    it('should reject resolving Project A match to Project B activity (404 NotFoundError)', async () => {
      const matchA = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.40,
        matchMethod: 'text_similarity',
        status: 'suggested',
        reviewState: 'unresolved'
      });

      await expect(
        service.resolveMatch(projectAId, matchA.id, actB1Id, 'Reviewer') // actB1Id belongs to Project B!
      ).rejects.toThrow(NotFoundError);
    });

    it('should not leak Project A review events into Project B event queries', async () => {
      const matchA = matchRepo.create({
        projectId: projectAId,
        progressUpdateId: updateAId,
        activityId: actA1Id,
        confidenceScore: 0.75,
        matchMethod: 'text_similarity',
        status: 'suggested'
      });

      await service.confirmMatch(projectAId, matchA.id, 'Reviewer Alice');

      const eventsA = eventRepo.listByProjectId(projectAId);
      const eventsB = eventRepo.listByProjectId(projectBId);

      expect(eventsA.some((e) => e.eventType === 'match_confirmed')).toBe(true);
      expect(eventsB.some((e) => e.eventType === 'match_confirmed')).toBe(false);
    });
  });
});
