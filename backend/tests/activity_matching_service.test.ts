import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { ActivityMatchingService } from '../src/services/matching/activity-matching.service.js';
import { FieldProgressExtraction } from '../src/ai/contracts/field-progress-extraction.contract.js';
import { MockAIProvider } from '../src/ai/providers/mock-ai.provider.js';
import { DefaultAIService } from '../src/ai/services/ai.service.js';
import { DefaultLLMActivityDisambiguator } from '../src/services/matching/llm-disambiguator.js';
import { NotFoundError } from '../src/errors/AppError.js';

describe('ActivityMatchingService', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let updateRepo: SqliteProgressUpdateRepository;
  let matchRepo: SqliteActivityMatchRepository;
  let service: ActivityMatchingService;

  let testProjectId: string;
  let testProject2Id: string;
  let testScheduleId: string;
  let testUpdateId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    updateRepo = new SqliteProgressUpdateRepository(() => db);
    matchRepo = new SqliteActivityMatchRepository(() => db);

    service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo
    });

    const p1 = projectRepo.create({
      name: 'High Speed Rail Phase 1',
      code: 'HSR-01',
      status: 'active'
    });
    testProjectId = p1.id;

    const p2 = projectRepo.create({
      name: 'Metro Line 3',
      code: 'ML-03',
      status: 'active'
    });
    testProject2Id = p2.id;

    const s1 = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Baseline Schedule',
      sourceType: 'csv'
    });
    testScheduleId = s1.id;

    activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-101',
      name: 'Foundation Excavation',
      location: 'Block B',
      wbsCode: '3.1',
      plannedStart: '2026-09-01',
      plannedFinish: '2026-09-15'
    });

    activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-102',
      name: 'Foundation Concrete',
      location: 'Block B',
      wbsCode: '3.2',
      plannedStart: '2026-09-16',
      plannedFinish: '2026-09-30'
    });

    activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-103',
      name: 'Pier P12 Column Rebar',
      location: 'Pier P12',
      wbsCode: '4.1',
      plannedStart: '2026-10-01',
      plannedFinish: '2026-10-15'
    });

    const u1 = updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-26',
      reporterName: 'Supervisor Singh',
      sourceType: 'manual',
      rawText: 'Foundation excavation is around 60% complete at Block B.'
    });
    testUpdateId = u1.id;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it('should match field facts against activities and persist suggested matches with status="suggested"', async () => {
    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'foundation excavation work',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        }
      ]
    };

    const report = await service.matchProgressUpdate(testProjectId, testUpdateId, extraction);

    expect(report.matches).toHaveLength(1);
    const m = report.matches[0];
    expect(m.bestMatch).not.toBeNull();
    expect(m.bestMatch?.activityExternalId).toBe('ACT-101');
    expect(m.bestMatch?.confidenceScore).toBeGreaterThanOrEqual(0.80);
    expect(m.bestMatch?.matchMethod).toBe('wbs_location');
    expect(m.alternatives.length).toBeGreaterThanOrEqual(1);
    expect(m.alternatives[0].activityExternalId).toBe('ACT-102');

    // Verify persistence in SQLite
    const persisted = matchRepo.listByProgressUpdateId(testUpdateId, testProjectId);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].activityId).toBe(m.bestMatch?.activityId);
    expect(persisted[0].status).toBe('suggested'); // Crucial: NEVER confirmed automatically

    // Verify activity_progress table is completely untouched (Pass 10 boundary)
    const progressCount = db.prepare('SELECT COUNT(*) as count FROM activity_progress').get() as { count: number };
    expect(progressCount.count).toBe(0);
  });

  it('should handle multiple items and preserve alternatives ranking', async () => {
    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'foundation work',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        },
        {
          reference: 'Pier P12 Column Rebar',
          location: 'Pier P12',
          progress_percent: 40,
          status: 'in_progress'
        }
      ]
    };

    const report = await service.matchProgressUpdate(testProjectId, testUpdateId, extraction);

    expect(report.matches).toHaveLength(2);
    expect(report.matches[0].bestMatch).not.toBeNull();
    expect(report.matches[1].bestMatch?.activityExternalId).toBe('ACT-103');

    const persisted = matchRepo.listByProgressUpdateId(testUpdateId, testProjectId);
    expect(persisted).toHaveLength(2);
  });

  it('should be idempotent: repeated matching replaces previous suggestions without duplicates', async () => {
    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'foundation excavation',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        }
      ]
    };

    await service.matchProgressUpdate(testProjectId, testUpdateId, extraction);
    expect(matchRepo.listByProgressUpdateId(testUpdateId, testProjectId)).toHaveLength(1);

    // Re-run matching
    await service.matchProgressUpdate(testProjectId, testUpdateId, extraction);
    expect(matchRepo.listByProgressUpdateId(testUpdateId, testProjectId)).toHaveLength(1);
  });

  it('should throw NotFoundError if progress update belongs to a different project', async () => {
    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'foundation work',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        }
      ]
    };

    // testUpdateId belongs to testProjectId, not testProject2Id
    await expect(
      service.matchProgressUpdate(testProject2Id, testUpdateId, extraction)
    ).rejects.toThrow(NotFoundError);
  });

  it('should throw NotFoundError if project does not exist', async () => {
    const extraction: FieldProgressExtraction = {
      items: []
    };

    await expect(
      service.matchProgressUpdate('non-existent-proj', testUpdateId, extraction)
    ).rejects.toThrow(NotFoundError);
  });

  it('should return null bestMatch when fact confidence is below threshold without creating phantom matches', async () => {
    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Random generic cleaning at the northern perimeter',
          location: 'North gate',
          progress_percent: null,
          status: 'in_progress'
        }
      ]
    };

    const report = await service.matchProgressUpdate(testProjectId, testUpdateId, extraction);

    expect(report.matches).toHaveLength(1);
    expect(report.matches[0].bestMatch).toBeNull();
    expect(report.matches[0].alternatives).toHaveLength(0);

    const persisted = matchRepo.listByProgressUpdateId(testUpdateId, testProjectId);
    expect(persisted).toHaveLength(0);
  });

  it('should return empty matches when project has no activities', async () => {
    // Project 2 has no schedule/activities
    const u2 = updateRepo.create({
      projectId: testProject2Id,
      reportDate: '2026-08-26',
      sourceType: 'manual',
      rawText: 'Project 2 report'
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'foundation excavation',
          location: 'Block B',
          progress_percent: 50,
          status: 'in_progress'
        }
      ]
    };

    const report = await service.matchProgressUpdate(testProject2Id, u2.id, extraction);
    expect(report.matches).toHaveLength(1);
    expect(report.matches[0].bestMatch).toBeNull();
    expect(matchRepo.listByProgressUpdateId(u2.id, testProject2Id)).toHaveLength(0);
  });

  it('should support LLM-assisted disambiguation seam with MockAIProvider', async () => {
    const mockProvider = new MockAIProvider({
      mockStructuredResponse: {
        selectedActivityExternalId: 'ACT-102',
        rationale: 'Report indicates concrete placement stage of foundation',
        confidence: 0.92
      }
    });
    const mockAiService = new DefaultAIService(mockProvider);
    const disambiguator = new DefaultLLMActivityDisambiguator(mockAiService);

    const customService = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      llmDisambiguator: disambiguator
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'foundation work',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        }
      ]
    };

    const report = await customService.matchProgressUpdate(testProjectId, testUpdateId, extraction, {
      enableLlmDisambiguation: true,
      alternativeScoreMargin: 0.20 // Allow disambiguation for close candidates
    });

    expect(report.matches[0].bestMatch?.activityExternalId).toBe('ACT-102');
    expect(report.matches[0].bestMatch?.matchMethod).toBe('llm_assisted');
    expect(report.matches[0].bestMatch?.rationale).toContain('LLM disambiguation');
  });
});
