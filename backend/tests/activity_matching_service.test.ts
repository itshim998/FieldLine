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
  let testActivity1Id: string;
  let testActivity2Id: string;
  let testActivity3Id: string;
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

    const a1 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-101',
      name: 'Foundation Excavation',
      location: 'Block B',
      wbsCode: '3.1',
      plannedStart: '2026-09-01',
      plannedFinish: '2026-09-15'
    });
    testActivity1Id = a1.id;

    const a2 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-102',
      name: 'Foundation Concrete',
      location: 'Block B',
      wbsCode: '3.2',
      plannedStart: '2026-09-16',
      plannedFinish: '2026-09-30'
    });
    testActivity2Id = a2.id;

    const a3 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-103',
      name: 'Pier P12 Column Rebar',
      location: 'Pier P12',
      wbsCode: '4.1',
      plannedStart: '2026-10-01',
      plannedFinish: '2026-10-15'
    });
    testActivity3Id = a3.id;

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
    expect(persisted[0].status).toBe('confirmed'); // Pass 19: High isolated match is auto-confirmed
    expect(persisted[0].confidenceTier).toBe('high');
    expect(persisted[0].reviewState).toBe('resolved');

    // Verify activity_progress table is completely untouched (Pass 19 canonical truth protection)
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

  it('should be idempotent: repeated matching replaces previous suggestions without duplicates (Test C)', async () => {
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

    await service.matchProgressUpdate(testProjectId, testUpdateId, extraction);
    const firstMatches = matchRepo.listByProgressUpdateId(testUpdateId, testProjectId);
    expect(firstMatches).toHaveLength(1);
    expect(firstMatches[0].status).toBe('suggested');

    // Re-run matching
    await service.matchProgressUpdate(testProjectId, testUpdateId, extraction);
    const secondMatches = matchRepo.listByProgressUpdateId(testUpdateId, testProjectId);
    expect(secondMatches).toHaveLength(1);
    expect(secondMatches[0].status).toBe('suggested');
  });

  it('should preserve confirmed matches across automatic re-matching (Test A)', async () => {
    // 1. Initial matching generates a suggested match
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

    await service.matchProgressUpdate(testProjectId, testUpdateId, extraction);
    const initialMatches = matchRepo.listByProgressUpdateId(testUpdateId, testProjectId);
    expect(initialMatches).toHaveLength(1);
    const initialMatchId = initialMatches[0].id;

    // 2. Simulate human review confirming this match
    db.prepare(`
      UPDATE activity_matches 
      SET status = 'confirmed', reviewed_by = 'Engineer Alice', reviewed_at = '2026-08-26T10:00:00Z'
      WHERE id = ?
    `).run(initialMatchId);

    // 3. Re-run automatic matching
    await service.matchProgressUpdate(testProjectId, testUpdateId, extraction);

    // 4. Verify confirmed match still exists with all review metadata intact (not deleted/recreated)
    const allMatches = matchRepo.listByProgressUpdateId(testUpdateId, testProjectId);
    const confirmedMatch = allMatches.find(m => m.id === initialMatchId);

    expect(confirmedMatch).toBeDefined();
    expect(confirmedMatch?.id).toBe(initialMatchId);
    expect(confirmedMatch?.status).toBe('confirmed');
    expect(confirmedMatch?.reviewedBy).toBe('Engineer Alice');
    expect(confirmedMatch?.reviewedAt).toBe('2026-08-26T10:00:00Z');

    // Newly generated suggestion also exists
    const suggestedMatches = allMatches.filter(m => m.status === 'suggested');
    expect(suggestedMatches).toHaveLength(1);
  });

  it('should preserve rejected matches across automatic re-matching (Test B)', async () => {
    // 1. Manually create a rejected match with reviewer metadata using valid activity ID
    const rejectedMatch = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivity3Id,
      confidenceScore: 0.50,
      matchMethod: 'text_similarity',
      status: 'rejected',
      reviewedBy: 'Supervisor Bob',
      reviewedAt: '2026-08-26T11:00:00Z',
      rationale: 'Rejected by site manager: wrong work package'
    });

    // 2. Run matching
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

    // 3. Verify rejected match is preserved intact
    const retrieved = matchRepo.getById(rejectedMatch.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(rejectedMatch.id);
    expect(retrieved?.status).toBe('rejected');
    expect(retrieved?.reviewedBy).toBe('Supervisor Bob');
    expect(retrieved?.reviewedAt).toBe('2026-08-26T11:00:00Z');
    expect(retrieved?.rationale).toBe('Rejected by site manager: wrong work package');
  });

  it('should preserve confirmed and rejected matches while replacing suggested matches in mixed state (Test D)', async () => {
    // 1. Create a confirmed match using valid activity ID
    const mConfirmed = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivity1Id,
      confidenceScore: 0.95,
      matchMethod: 'exact_id',
      status: 'confirmed',
      reviewedBy: 'Lead Auditor',
      reviewedAt: '2026-08-26T09:00:00Z'
    });

    // 2. Create a rejected match using valid activity ID
    const mRejected = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivity3Id,
      confidenceScore: 0.45,
      matchMethod: 'text_similarity',
      status: 'rejected',
      reviewedBy: 'Lead Auditor',
      reviewedAt: '2026-08-26T09:30:00Z'
    });

    // 3. Create an old suggestion using valid activity ID
    const mOldSuggested = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivity2Id,
      confidenceScore: 0.60,
      matchMethod: 'text_similarity',
      status: 'suggested'
    });

    expect(matchRepo.listByProgressUpdateId(testUpdateId, testProjectId)).toHaveLength(3);

    // 4. Run automatic re-matching
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

    await service.matchProgressUpdate(testProjectId, testUpdateId, extraction);

    // 5. Verify results:
    const allMatches = matchRepo.listByProgressUpdateId(testUpdateId, testProjectId);
    
    // Confirmed preserved
    const retrievedConfirmed = allMatches.find(m => m.id === mConfirmed.id);
    expect(retrievedConfirmed).toBeDefined();
    expect(retrievedConfirmed?.status).toBe('confirmed');
    expect(retrievedConfirmed?.reviewedBy).toBe('Lead Auditor');

    // Rejected preserved
    const retrievedRejected = allMatches.find(m => m.id === mRejected.id);
    expect(retrievedRejected).toBeDefined();
    expect(retrievedRejected?.status).toBe('rejected');
    expect(retrievedRejected?.reviewedBy).toBe('Lead Auditor');

    // Old suggestion replaced (no longer in DB)
    expect(matchRepo.getById(mOldSuggested.id)).toBeNull();

    // New suggestion created
    const newSuggestions = allMatches.filter(m => m.status === 'suggested');
    expect(newSuggestions).toHaveLength(1);
    expect(newSuggestions[0].id).not.toBe(mOldSuggested.id);
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
