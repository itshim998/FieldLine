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

  it('Low-confidence match: cannot create ActivityProgress (rejected by ProgressService)', () => {
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
    expect(() =>
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

  it('Auto-confirmed high-confidence match: directly eligible to record canonical ActivityProgress', async () => {
    // 1. Process unambiguous match with exact activity ID
    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'ACT-101',
          location: 'Block B',
          progress_percent: 75,
          status: 'in_progress'
        }
      ]
    };

    const matchResult = await matchingService.matchProgressUpdate(projectId, updateId, extraction);
    expect(matchResult.matches).toHaveLength(1);

    const matches = matchRepo.listByProgressUpdateId(updateId, projectId);
    expect(matches).toHaveLength(1);
    expect(matches[0].status).toBe('confirmed');
    expect(matches[0].confidenceTier).toBe('high');
    expect(matches[0].reviewedBy).toBe('system');

    // 2. ProgressService directly normalizes and records canonical progress
    const recordedProgress = progressService.normalizeAndRecordProgress({
      projectId,
      updateId,
      matchId: matches[0].id,
      fact: extraction.items[0]
    });

    expect(recordedProgress).toBeDefined();
    expect(recordedProgress.activityId).toBe(activity1Id);
    expect(recordedProgress.actualPercent).toBe(75);

    const persisted = progressRepo.listByProjectId(projectId);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].actualPercent).toBe(75);
  });

  it('Rejected match: cannot create ActivityProgress (throws ValidationError)', async () => {
    // 1. Create a match and reject it
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
      'Irrelevant observation'
    );
    expect(rejectedMatch.status).toBe('rejected');

    // 2. Attempting to record progress on a rejected match must throw ValidationError
    expect(() =>
      progressService.normalizeAndRecordProgress({
        projectId,
        updateId,
        matchId: rejectedMatch.id,
        fact: {
          reference: 'Excavation work',
          progress_percent: 50,
          status: 'in_progress'
        }
      })
    ).toThrow(ValidationError);

    // 3. Verify zero progress records persisted
    expect(progressRepo.listByProjectId(projectId)).toHaveLength(0);
  });

  it('Cross-project access: ProgressService rejects match belonging to a different project', () => {
    // 1. Create a second project with its own schedule, activity, and progress update
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
      rawText: 'Other update text'
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

    // 2. Attempting to record progress in projectId using otherProject match must fail
    expect(() =>
      progressService.normalizeAndRecordProgress({
        projectId, // Project A
        updateId,
        matchId: otherMatch.id, // Project B match
        fact: {
          reference: 'ACT-101',
          progress_percent: 40,
          status: 'in_progress'
        }
      })
    ).toThrow(NotFoundError);

    expect(progressRepo.listByProjectId(projectId)).toHaveLength(0);
    expect(progressRepo.listByProjectId(otherProject.id)).toHaveLength(0);
  });
});
