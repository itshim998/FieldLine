import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { MatchModelService } from '../src/ml/match/match-model.service.js';
import { AnomalyModelService } from '../src/ml/anomaly/anomaly-model.service.js';
import { FieldProgressExtraction } from '../src/ai/contracts/field-progress-extraction.contract.js';
import { ValidationError } from '../src/errors/AppError.js';

describe('Phase 31 — Canonical Truth Boundary Certification', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let updateRepo: SqliteProgressUpdateRepository;
  let matchRepo: SqliteActivityMatchRepository;
  let progressRepo: SqliteActivityProgressRepository;
  let eventRepo: SqliteProjectEventRepository;

  let matchModelService: MatchModelService;
  let anomalyModelService: AnomalyModelService;
  let matchingService: ActivityMatchingService;
  let progressService: DefaultProgressService;

  let projectId: string;
  let scheduleId: string;
  let pumpActivityId: string;
  let tankActivityId: string;
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

    matchModelService = new MatchModelService({ strict: true });
    anomalyModelService = new AnomalyModelService({ strict: true });

    matchingService = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      projectEventRepo: eventRepo,
      matchModelService,
      activityProgressRepo: progressRepo,
      anomalyModelService
    });

    progressService = new DefaultProgressService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      activityProgressRepo: progressRepo
    });

    const project = projectRepo.create({
      name: 'Refinery Expansion Unit 4',
      code: 'REFINERY-U4',
      status: 'active'
    });
    projectId = project.id;

    const schedule = scheduleRepo.create({
      projectId,
      name: 'Master Baseline Schedule',
      sourceType: 'p6'
    });
    scheduleId = schedule.id;

    const act1 = activityRepo.create({
      projectId,
      scheduleId,
      externalId: 'ACT-B02',
      name: 'Crude Pump Foundation Piling Works',
      description: 'Driven pile foundations at Area B crude pump bay',
      location: 'Area B',
      wbsCode: 'REF-U4-B02',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-30',
      baselineProgress: 0
    });
    pumpActivityId = act1.id;

    const act2 = activityRepo.create({
      projectId,
      scheduleId,
      externalId: 'ACT-B01',
      name: 'Crude Storage Tank Foundation Slab',
      description: 'Concrete slab pour at Area B storage tank',
      location: 'Area B',
      wbsCode: 'REF-U4-B01',
      plannedStart: '2026-07-15',
      plannedFinish: '2026-08-15',
      baselineProgress: 0
    });
    tankActivityId = act2.id;

    const update = updateRepo.create({
      projectId,
      reportDate: '2026-08-15',
      reporterName: 'Site Supervisor Chen',
      sourceType: 'manual',
      rawText: 'Progress update for Area B works'
    });
    updateId = update.id;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Test A — ML inference alone cannot mutate activity_progress
  // ---------------------------------------------------------------------------
  it('Test A: ML inference alone produces advisory numbers and leaves activity_progress untouched', () => {
    const initialRows = db.prepare('SELECT COUNT(*) as count FROM activity_progress').get() as { count: number };
    expect(initialRows.count).toBe(0);

    // Direct Match Model inference
    const matchFeatures = {
      name_similarity: 0.85,
      description_similarity: 0.72,
      location_exact_match: 1.0,
      location_similarity: 1.0,
      location_contradiction: 0.0,
      wbs_match: 1.0,
      exact_id_match: 1.0,
      score_gap_from_second_candidate: 0.35
    };
    const matchConfidence = matchModelService.predict(matchFeatures);
    expect(matchConfidence).toBeGreaterThan(0.5);

    // Direct Anomaly Model inference
    const anomalyFeatures = {
      progress_delta: 45.0,
      daily_velocity: 22.5,
      progress_variance: 15.0,
      reported_percent: 85.0,
      is_regression: 0.0
    };
    const anomalyPred = anomalyModelService.predict(anomalyFeatures);
    expect(anomalyPred.severity).toBe('high');
    expect(anomalyPred.reviewRecommended).toBe(true);

    // Assert that activity_progress table remains 100% empty
    const finalRows = db.prepare('SELECT COUNT(*) as count FROM activity_progress').get() as { count: number };
    expect(finalRows.count).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test B — Ambiguous / awaiting_review state cannot mutate canonical progress
  // ---------------------------------------------------------------------------
  it('Test B: Ambiguous ML matching result yields awaiting_review and never writes to activity_progress', async () => {
    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Foundation works in Area B',
          location: 'Area B',
          progress_percent: 30,
          status: 'in_progress'
        }
      ]
    };

    const matchResult = await matchingService.matchProgressUpdate(projectId, updateId, extraction, {
      persist: true
    });

    expect(matchResult.matches).toHaveLength(1);
    const persistedMatches = matchRepo.listByProgressUpdateId(updateId, projectId);
    expect(persistedMatches).toHaveLength(1);
    const topMatch = persistedMatches[0];
    expect(topMatch.reviewState).toBe('awaiting_review');
    expect(topMatch.status).toBe('suggested');

    // Verify activity_progress table remains completely empty
    const progressRows = db.prepare('SELECT COUNT(*) as count FROM activity_progress').get() as { count: number };
    expect(progressRows.count).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test C — Anomaly warning is advisory and does not mutate canonical progress
  // ---------------------------------------------------------------------------
  it('Test C: Anomaly alert flags update for review without mutating canonical progress', async () => {
    // 1. Establish baseline observation of 15% on 2026-08-10 via canonical service
    const setupMatch = matchRepo.create({
      projectId,
      progressUpdateId: updateId,
      activityId: pumpActivityId,
      confidenceScore: 1.0,
      matchMethod: 'exact_id',
      status: 'confirmed',
      confidenceTier: 'high',
      reviewState: 'resolved'
    });

    progressService.normalizeAndRecordProgress({
      projectId,
      updateId,
      matchId: setupMatch.id,
      fact: {
        reference: 'ACT-B02',
        location: 'Area B',
        progress_percent: 15,
        status: 'in_progress'
      },
      asOfDate: '2026-08-10',
      allowSuggested: false
    });

    const baselineCount = db.prepare('SELECT COUNT(*) as count FROM activity_progress').get() as { count: number };
    expect(baselineCount.count).toBe(1);

    // 2. Submit extreme progress report 2 days later: 15% -> 95%
    const update2 = updateRepo.create({
      projectId,
      reportDate: '2026-08-12',
      reporterName: 'Site Worker',
      sourceType: 'manual',
      rawText: 'ACT-B02 jumped to 95%'
    });

    const anomalousExtraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'ACT-B02 Crude pump foundation piling jumped to 95%',
          location: 'Area B',
          progress_percent: 95,
          status: 'in_progress'
        }
      ]
    };

    const matchResult = await matchingService.matchProgressUpdate(projectId, update2.id, anomalousExtraction, {
      persist: true
    });

    const candidate = matchResult.matches[0].bestMatch;
    expect(candidate).not.toBeNull();
    expect(candidate!.anomalyScore).toBeGreaterThan(0.75);
    expect(candidate!.anomalySeverity).toBe('high');
    expect(candidate!.anomalyReasons).toBeDefined();
    expect(candidate!.anomalyReasons!.length).toBeGreaterThan(0);

    // CRITICAL: activity_progress MUST NOT have been mutated by anomaly scoring or matching
    const postMatchCount = db.prepare('SELECT COUNT(*) as count FROM activity_progress').get() as { count: number };
    expect(postMatchCount.count).toBe(1);

    const currentObs = db.prepare('SELECT actual_percent FROM activity_progress WHERE activity_id = ?').get(pumpActivityId) as { actual_percent: number };
    expect(currentObs.actual_percent).toBe(15);
  });

  // ---------------------------------------------------------------------------
  // Test D — Supervisor confirmation flow: canonical progress changes ONLY via canonical service
  // ---------------------------------------------------------------------------
  it('Test D: Supervisor confirmation updates match status, and progress is committed solely through ProgressService', async () => {
    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Crude pump foundation piling completed to 65%',
          location: 'Area B',
          progress_percent: 65,
          status: 'in_progress'
        }
      ]
    };

    const matchResult = await matchingService.matchProgressUpdate(projectId, updateId, extraction, {
      persist: true
    });
    const persistedMatches = matchRepo.listByProgressUpdateId(updateId, projectId);
    expect(persistedMatches).toHaveLength(1);
    const suggestedMatch = persistedMatches[0];

    // Attempting to record canonical progress before confirmation must fail
    expect(() =>
      progressService.normalizeAndRecordProgress({
        projectId,
        updateId,
        matchId: suggestedMatch.id,
        fact: extraction.items[0],
        allowSuggested: false
      })
    ).toThrow(ValidationError);

    // 1. Human supervisor reviews and confirms the match
    const confirmedMatch = await matchingService.confirmMatch(projectId, suggestedMatch.id, 'Supervisor David');
    expect(confirmedMatch.status).toBe('confirmed');
    expect(confirmedMatch.reviewState).toBe('resolved');

    // Confirming match in activity_matches still has NOT touched activity_progress
    const preCommitCount = db.prepare('SELECT COUNT(*) as count FROM activity_progress').get() as { count: number };
    expect(preCommitCount.count).toBe(0);

    // 2. Canonical ProgressService commits progress
    const committed = progressService.normalizeAndRecordProgress({
      projectId,
      updateId,
      matchId: confirmedMatch.id,
      fact: extraction.items[0],
      allowSuggested: false
    });

    expect(committed.actualPercent).toBe(65);
    expect(committed.activityId).toBe(pumpActivityId);

    // Verify activity_progress now contains exactly 1 record
    const postCommitCount = db.prepare('SELECT COUNT(*) as count FROM activity_progress').get() as { count: number };
    expect(postCommitCount.count).toBe(1);

    // Verify atomic project event was generated for the progress commit
    const event = db.prepare("SELECT * FROM project_events WHERE event_type = 'progress_updated'").get() as any;
    expect(event).toBeDefined();
    expect(event.entity_id).toBe(committed.id);
  });

  // ---------------------------------------------------------------------------
  // Test E — Rejection does not mutate canonical progress
  // ---------------------------------------------------------------------------
  it('Test E: Rejection of proposed match prevents canonical progress mutation', async () => {
    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Foundation Piling in Area B',
          location: 'Area B',
          progress_percent: 40,
          status: 'in_progress'
        }
      ]
    };

    const matchResult = await matchingService.matchProgressUpdate(projectId, updateId, extraction, {
      persist: true
    });
    const persistedMatches = matchRepo.listByProgressUpdateId(updateId, projectId);
    expect(persistedMatches).toHaveLength(1);
    const matchId = persistedMatches[0].id;

    // Reject the match
    const rejected = await matchingService.rejectMatch(projectId, matchId, 'Supervisor David', 'Not relevant to unit 4');
    expect(rejected.status).toBe('rejected');

    // Attempting to record progress on rejected match must throw ValidationError
    expect(() =>
      progressService.normalizeAndRecordProgress({
        projectId,
        updateId,
        matchId: rejected.id,
        fact: extraction.items[0],
        allowSuggested: true
      })
    ).toThrow(ValidationError);

    // Verify activity_progress remains untouched
    const count = db.prepare('SELECT COUNT(*) as count FROM activity_progress').get() as { count: number };
    expect(count.count).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Machine-Checkable Static Boundary Audit
  // ---------------------------------------------------------------------------
  it('Static Audit: ML subsystem files contain zero SQL mutation statements on activity_progress', () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const mlDir = path.resolve(currentDir, '../src/ml');

    function readFilesRecursively(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...readFilesRecursively(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const mlFiles = readFilesRecursively(mlDir);
    expect(mlFiles.length).toBeGreaterThan(0);

    const forbiddenSqlKeywords = [
      'INSERT INTO activity_progress',
      'UPDATE activity_progress',
      'DELETE FROM activity_progress',
      'normalizeAndRecordProgress'
    ];

    for (const filePath of mlFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const keyword of forbiddenSqlKeywords) {
        expect(
          content.includes(keyword),
          `Boundary Violation: ML file ${path.basename(filePath)} contains forbidden keyword '${keyword}'`
        ).toBe(false);
      }
    }
  });

  it('Static Audit: Across backend/src, only SqliteActivityProgressRepository issues INSERT INTO activity_progress', () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const srcDir = path.resolve(currentDir, '../src');

    function scanFiles(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...scanFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const allSrcFiles = scanFiles(srcDir);
    const filesWithInsert: string[] = [];
    const filesWithUpdate: string[] = [];

    for (const file of allSrcFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes('INSERT INTO activity_progress')) {
        filesWithInsert.push(path.normalize(file));
      }
      if (content.includes('UPDATE activity_progress')) {
        filesWithUpdate.push(path.normalize(file));
      }
    }

    // Exactly one file may contain INSERT INTO activity_progress: activity-progress.repository.ts
    expect(filesWithInsert.length).toBe(1);
    expect(filesWithInsert[0]).toContain('activity-progress.repository.ts');

    // Zero files may contain UPDATE activity_progress (append-only table invariant)
    expect(filesWithUpdate.length).toBe(0);
  });
});
