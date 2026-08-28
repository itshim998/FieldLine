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
import { ValidationError } from '../src/errors/AppError.js';

describe('Canonical Truth Protection & Progress Integration (Pass 19)', () => {
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
      name: 'Foundation Excavation',
      location: 'Block B',
      plannedStart: '2026-09-01',
      plannedFinish: '2026-09-15'
    });
    activity1Id = a1.id;

    const a2 = activityRepo.create({
      projectId,
      scheduleId,
      externalId: 'ACT-102',
      name: 'Foundation Concrete Pouring',
      location: 'Block B',
      plannedStart: '2026-09-16',
      plannedFinish: '2026-09-30'
    });
    activity2Id = a2.id;

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

  it('Low-confidence match: cannot create ActivityProgress (rejected by ProgressService)', async () => {
    // 1. Create a low-confidence match (suggested + unresolved)
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

    // 2. Attempt to normalize and record progress with ProgressService without confirmation
    await expect(
      () =>
        progressService.normalizeAndRecordProgress({
          projectId,
          updateId,
          matchId: lowMatch.id,
          fact: {
            reference: 'Excavation work',
            progress_percent: 55,
            status: 'in_progress'
          }
        })
    ).toThrow(ValidationError);

    // 3. Verify zero ActivityProgress records created in database
    const progressList = progressRepo.listByProjectId(projectId);
    expect(progressList).toHaveLength(0);
  });

  it('Medium-confidence suggested match: blocked until human confirms, then creates ActivityProgress', async () => {
    // 1. Create medium suggested match (suggested + awaiting_review)
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

    // 2. Before confirmation: ProgressService must block
    expect(() =>
      progressService.normalizeAndRecordProgress({
        projectId,
        updateId,
        matchId: suggestedMatch.id,
        fact: {
          reference: 'Excavation work',
          progress_percent: 55,
          status: 'in_progress'
        }
      })
    ).toThrow(ValidationError);

    expect(progressRepo.listByProjectId(projectId)).toHaveLength(0);

    // 3. Human confirms match
    const confirmedMatch = await matchingService.confirmMatch(projectId, suggestedMatch.id, 'Inspector Bob');
    expect(confirmedMatch.status).toBe('confirmed');
    expect(confirmedMatch.reviewedBy).toBe('Inspector Bob');

    // 4. After confirmation: existing ProgressService creates canonical ActivityProgress
    const recordedProgress = progressService.normalizeAndRecordProgress({
      projectId,
      updateId,
      matchId: confirmedMatch.id,
      fact: {
        reference: 'Excavation work',
        progress_percent: 55,
        status: 'in_progress'
      }
    });

    expect(recordedProgress).toBeDefined();
    expect(recordedProgress.activityId).toBe(activity1Id);
    expect(recordedProgress.actualPercent).toBe(55);
    expect(recordedProgress.status).toBe('in_progress');

    // 5. Verify persisted in DB
    const persisted = progressRepo.listByProjectId(projectId);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe(recordedProgress.id);
  });

  it('Low-confidence match resolved to different activity: creates ActivityProgress for the resolved activity', async () => {
    // 1. Create low-confidence unresolved match pointing to activity1Id
    const unresolvedMatch = matchRepo.create({
      projectId,
      progressUpdateId: updateId,
      activityId: activity1Id,
      confidenceScore: 0.41,
      matchMethod: 'text_similarity',
      status: 'suggested',
      confidenceTier: 'low',
      reviewState: 'unresolved'
    });

    // 2. Human resolves match to activity2Id
    const resolvedMatch = await matchingService.resolveMatch(
      projectId,
      unresolvedMatch.id,
      activity2Id,
      'Site Lead Charlie',
      'Observation specifically details concrete pour, not excavation'
    );

    expect(resolvedMatch.status).toBe('confirmed');
    expect(resolvedMatch.activityId).toBe(activity2Id);
    expect(resolvedMatch.matchMethod).toBe('manual');

    // 3. Record canonical progress via existing ProgressService
    const recordedProgress = progressService.normalizeAndRecordProgress({
      projectId,
      updateId,
      matchId: resolvedMatch.id,
      fact: {
        reference: 'Concrete pouring work',
        progress_percent: 30,
        status: 'in_progress'
      }
    });

    expect(recordedProgress.activityId).toBe(activity2Id);
    expect(recordedProgress.actualPercent).toBe(30);

    // Verify activity 2 has the progress record
    const act2Progress = progressRepo.listByActivityId(activity2Id, projectId);
    expect(act2Progress).toHaveLength(1);
    expect(act2Progress[0].actualPercent).toBe(30);

    // Verify activity 1 has NO progress record
    const act1Progress = progressRepo.listByActivityId(activity1Id, projectId);
    expect(act1Progress).toHaveLength(0);
  });
});
