import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { DefaultProgressService } from '../src/services/progress/progress.service.js';
import { NotFoundError, ValidationError } from '../src/errors/AppError.js';

describe('Pass 10 — ProgressService Integration Tests', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let updateRepo: SqliteProgressUpdateRepository;
  let matchRepo: SqliteActivityMatchRepository;
  let progressRepo: SqliteActivityProgressRepository;
  let service: DefaultProgressService;

  let testProjectId: string;
  let testProject2Id: string;
  let testScheduleId: string;
  let testActivityId: string;
  let testUpdateId: string;
  let testConfirmedMatchId: string;
  let testSuggestedMatchId: string;
  let testRejectedMatchId: string;

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

    service = new DefaultProgressService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      activityProgressRepo: progressRepo
    });

    const p1 = projectRepo.create({
      name: 'Bullet Train Corridor',
      code: 'BTC-01',
      status: 'active'
    });
    testProjectId = p1.id;

    const p2 = projectRepo.create({
      name: 'Expressway Package 4',
      code: 'EXP-04',
      status: 'active'
    });
    testProject2Id = p2.id;

    const s1 = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Master Schedule Baseline',
      sourceType: 'csv'
    });
    testScheduleId = s1.id;

    const a1 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-101',
      name: 'Foundation Excavation',
      location: 'Block B',
      wbsCode: '3.1',
      plannedStart: '2026-09-01',
      plannedFinish: '2026-09-15',
      plannedQuantity: 500,
      unit: 'm3'
    });
    testActivityId = a1.id;

    const u1 = updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-26',
      reporterName: 'Rajesh',
      sourceType: 'manual',
      rawText: 'Excavation 60% complete at Block B.'
    });
    testUpdateId = u1.id;

    // Confirmed Match
    const mConfirmed = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivityId,
      confidenceScore: 0.95,
      matchMethod: 'exact_id',
      status: 'confirmed',
      reviewedBy: 'Lead Engineer'
    });
    testConfirmedMatchId = mConfirmed.id;

    // Suggested Match
    const mSuggested = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivityId,
      confidenceScore: 0.75,
      matchMethod: 'text_similarity',
      status: 'suggested'
    });
    testSuggestedMatchId = mSuggested.id;

    // Rejected Match
    const mRejected = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivityId,
      confidenceScore: 0.45,
      matchMethod: 'wbs_location',
      status: 'rejected',
      reviewedBy: 'Lead Engineer'
    });
    testRejectedMatchId = mRejected.id;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('Match Status Policy', () => {
    it('normalizes and records progress for a confirmed match', () => {
      const progress = service.normalizeAndRecordProgress({
        projectId: testProjectId,
        updateId: testUpdateId,
        matchId: testConfirmedMatchId,
        fact: {
          reference: 'Foundation Excavation',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        }
      });

      expect(progress).toBeDefined();
      expect(progress.actualPercent).toBe(60);
      expect(progress.activityId).toBe(testActivityId);
      expect(progress.status).toBe('in_progress');
      expect(progress.asOfDate).toBe('2026-08-26');
    });

    it('rejects normalization for a suggested match by default', () => {
      expect(() => {
        service.normalizeAndRecordProgress({
          projectId: testProjectId,
          updateId: testUpdateId,
          matchId: testSuggestedMatchId,
          fact: {
            reference: 'Foundation Excavation',
            location: 'Block B',
            progress_percent: 60,
            status: 'in_progress'
          }
        });
      }).toThrow(ValidationError);
    });

    it('allows suggested match when allowSuggested is explicitly set to true', () => {
      const progress = service.normalizeAndRecordProgress({
        projectId: testProjectId,
        updateId: testUpdateId,
        matchId: testSuggestedMatchId,
        fact: {
          reference: 'Foundation Excavation',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        },
        allowSuggested: true
      });

      expect(progress).toBeDefined();
      expect(progress.actualPercent).toBe(60);
    });

    it('always rejects normalization for a rejected match even with allowSuggested=true', () => {
      expect(() => {
        service.normalizeAndRecordProgress({
          projectId: testProjectId,
          updateId: testUpdateId,
          matchId: testRejectedMatchId,
          fact: {
            reference: 'Foundation Excavation',
            location: 'Block B',
            progress_percent: 60,
            status: 'in_progress'
          },
          allowSuggested: true
        });
      }).toThrow(ValidationError);
    });
  });

  describe('Quantity-Derived Calculations & Precedence in Service', () => {
    it('calculates quantity percentage in application code and persists correctly', () => {
      const progress = service.normalizeAndRecordProgress({
        projectId: testProjectId,
        updateId: testUpdateId,
        matchId: testConfirmedMatchId,
        fact: {
          reference: 'Foundation Excavation',
          location: 'Block B',
          progress_percent: null,
          status: 'in_progress'
        },
        actualQuantity: 300,
        quantityUnit: 'm3'
      });

      expect(progress.actualPercent).toBe(60); // 300 / 500 = 60%
      expect(progress.actualQuantity).toBe(300);
      expect(progress.notes).toContain('Quantity-derived progress');
    });

    it('rejects persistence when no deterministic numeric progress can be derived', () => {
      // Activity has plannedQuantity = 500, but no actual quantity and no progress_percent
      expect(() => {
        service.normalizeAndRecordProgress({
          projectId: testProjectId,
          updateId: testUpdateId,
          matchId: testConfirmedMatchId,
          fact: {
            reference: 'Foundation Excavation',
            location: 'Block B',
            progress_percent: null,
            status: 'in_progress'
          }
        });
      }).toThrow(ValidationError);
    });
  });

  describe('Chronology & Historical Date Preservation', () => {
    it('preserves earliest historical actualStart across sequential updates', () => {
      // 1. Initial report as of 2026-08-10 with start date 2026-08-10
      const p1 = service.normalizeAndRecordProgress({
        projectId: testProjectId,
        updateId: testUpdateId,
        matchId: testConfirmedMatchId,
        fact: {
          reference: 'Foundation Excavation',
          location: 'Block B',
          progress_percent: 30,
          status: 'in_progress'
        },
        asOfDate: '2026-08-10'
      });
      expect(p1.actualStart).toBe('2026-08-10');

      // 2. Second report arriving later as of 2026-08-26
      const u2 = updateRepo.create({
        projectId: testProjectId,
        reportDate: '2026-08-26',
        sourceType: 'manual',
        rawText: 'Progress advanced to 70%'
      });
      const m2 = matchRepo.create({
        projectId: testProjectId,
        progressUpdateId: u2.id,
        activityId: testActivityId,
        confidenceScore: 0.95,
        matchMethod: 'exact_id',
        status: 'confirmed'
      });

      const p2 = service.normalizeAndRecordProgress({
        projectId: testProjectId,
        updateId: u2.id,
        matchId: m2.id,
        fact: {
          reference: 'Foundation Excavation',
          location: 'Block B',
          progress_percent: 70,
          status: 'in_progress'
        },
        asOfDate: '2026-08-26'
      });

      // The actualStart on the new observation must preserve the earlier start date (2026-08-10), not 2026-08-26
      expect(p2.actualStart).toBe('2026-08-10');
      expect(p2.actualPercent).toBe(70);
    });
  });

  describe('Idempotency Behavior', () => {
    it('returns existing observation when repeated with identical parameters', () => {
      const first = service.normalizeAndRecordProgress({
        projectId: testProjectId,
        updateId: testUpdateId,
        matchId: testConfirmedMatchId,
        fact: {
          reference: 'Foundation Excavation',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        }
      });

      const second = service.normalizeAndRecordProgress({
        projectId: testProjectId,
        updateId: testUpdateId,
        matchId: testConfirmedMatchId,
        fact: {
          reference: 'Foundation Excavation',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        }
      });

      expect(second.id).toBe(first.id);
      expect(progressRepo.listByActivityId(testActivityId, testProjectId)).toHaveLength(1);
    });
  });

  describe('Cross-Project Isolation & Scoping', () => {
    it('rejects progress normalization when update belongs to different project', () => {
      const u2 = updateRepo.create({
        projectId: testProject2Id,
        reportDate: '2026-08-26',
        sourceType: 'manual',
        rawText: 'Project 2 update'
      });

      expect(() => {
        service.normalizeAndRecordProgress({
          projectId: testProjectId, // mismatched project!
          updateId: u2.id,
          matchId: testConfirmedMatchId,
          fact: {
            reference: 'Foundation Excavation',
            location: 'Block B',
            progress_percent: 60,
            status: 'in_progress'
          }
        });
      }).toThrow(NotFoundError);
    });

    it('rejects progress normalization when match belongs to different update', () => {
      const u2 = updateRepo.create({
        projectId: testProjectId,
        reportDate: '2026-08-26',
        sourceType: 'manual',
        rawText: 'Another update'
      });

      expect(() => {
        service.normalizeAndRecordProgress({
          projectId: testProjectId,
          updateId: u2.id, // match belongs to testUpdateId, not u2!
          matchId: testConfirmedMatchId,
          fact: {
            reference: 'Foundation Excavation',
            location: 'Block B',
            progress_percent: 60,
            status: 'in_progress'
          }
        });
      }).toThrow(ValidationError);
    });
  });
});
