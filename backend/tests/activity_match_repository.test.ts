import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { DatabaseError } from '../src/errors/AppError.js';

describe('SqliteActivityMatchRepository', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let updateRepo: SqliteProgressUpdateRepository;
  let matchRepo: SqliteActivityMatchRepository;

  let testProjectId: string;
  let testProject2Id: string;
  let testScheduleId: string;
  let testActivityId: string;
  let testActivity2Id: string;
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
      plannedFinish: '2026-09-15'
    });
    testActivityId = a1.id;

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

    const u1 = updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-26',
      reporterName: 'Rajesh',
      sourceType: 'manual',
      rawText: 'Foundation excavation is progressing at Block B.'
    });
    testUpdateId = u1.id;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it('should create an activity match suggestion and persist all fields accurately', () => {
    const match = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivityId,
      confidenceScore: 0.88,
      matchMethod: 'text_similarity',
      matchedText: 'Foundation Excavation',
      rationale: 'High token overlap with activity name and location matches Block B',
      status: 'suggested'
    });

    expect(match).toBeDefined();
    expect(match.id).toBeDefined();
    expect(match.projectId).toBe(testProjectId);
    expect(match.progressUpdateId).toBe(testUpdateId);
    expect(match.activityId).toBe(testActivityId);
    expect(match.confidenceScore).toBe(0.88);
    expect(match.matchMethod).toBe('text_similarity');
    expect(match.matchedText).toBe('Foundation Excavation');
    expect(match.status).toBe('suggested');
    expect(match.createdAt).toBeDefined();
    expect(match.updatedAt).toBeDefined();
  });

  it('should batch create multiple activity matches via createMany in transaction', () => {
    const matches = matchRepo.createMany([
      {
        projectId: testProjectId,
        progressUpdateId: testUpdateId,
        activityId: testActivityId,
        confidenceScore: 0.88,
        matchMethod: 'text_similarity',
        rationale: 'Primary candidate',
        status: 'suggested'
      },
      {
        projectId: testProjectId,
        progressUpdateId: testUpdateId,
        activityId: testActivity2Id,
        confidenceScore: 0.72,
        matchMethod: 'wbs_location',
        rationale: 'Secondary candidate in same location',
        status: 'suggested'
      }
    ]);

    expect(matches).toHaveLength(2);
    expect(matches[0].confidenceScore).toBe(0.88);
    expect(matches[1].confidenceScore).toBe(0.72);

    const retrieved = matchRepo.listByProgressUpdateId(testUpdateId, testProjectId);
    expect(retrieved).toHaveLength(2);
  });

  it('should retrieve activity match by ID and with project scoping', () => {
    const created = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivityId,
      confidenceScore: 0.95,
      matchMethod: 'exact_id',
      status: 'suggested'
    });

    const found = matchRepo.getById(created.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);

    const projectScopedMatch = matchRepo.getByIdAndProjectId(created.id, testProjectId);
    expect(projectScopedMatch).not.toBeNull();
    expect(projectScopedMatch?.id).toBe(created.id);

    const crossProjectMismatch = matchRepo.getByIdAndProjectId(created.id, testProject2Id);
    expect(crossProjectMismatch).toBeNull();
  });

  it('should list activity matches for a project', () => {
    matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivityId,
      confidenceScore: 0.9,
      matchMethod: 'text_similarity'
    });

    const projectMatches = matchRepo.listByProjectId(testProjectId);
    expect(projectMatches).toHaveLength(1);

    const project2Matches = matchRepo.listByProjectId(testProject2Id);
    expect(project2Matches).toHaveLength(0);
  });

  it('should delete matches by progressUpdateId', () => {
    matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivityId,
      confidenceScore: 0.85,
      matchMethod: 'text_similarity'
    });

    matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivity2Id,
      confidenceScore: 0.65,
      matchMethod: 'wbs_location'
    });

    expect(matchRepo.listByProgressUpdateId(testUpdateId, testProjectId)).toHaveLength(2);

    const deletedCount = matchRepo.deleteByProgressUpdateId(testUpdateId, testProjectId);
    expect(deletedCount).toBe(2);
    expect(matchRepo.listByProgressUpdateId(testUpdateId, testProjectId)).toHaveLength(0);
  });

  it('should enforce cross-project referential integrity between update and activity', () => {
    // Create update in Project 2
    const u2 = updateRepo.create({
      projectId: testProject2Id,
      reportDate: '2026-08-26',
      sourceType: 'manual',
      rawText: 'Project 2 update'
    });

    // Attempting to match Project 2 update with Project 1 activity in Project 1 should fail
    expect(() => {
      matchRepo.create({
        projectId: testProjectId,
        progressUpdateId: u2.id, // belongs to Project 2!
        activityId: testActivityId, // belongs to Project 1
        confidenceScore: 0.8,
        matchMethod: 'text_similarity'
      });
    }).toThrow(DatabaseError);

    // Attempting to match in Project 2 with Project 1 activity should fail composite FK
    expect(() => {
      matchRepo.create({
        projectId: testProject2Id,
        progressUpdateId: u2.id,
        activityId: testActivityId, // belongs to Project 1!
        confidenceScore: 0.8,
        matchMethod: 'text_similarity'
      });
    }).toThrow(DatabaseError);
  });

  it('should cascade delete activity matches when project is deleted', () => {
    const match = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivityId,
      confidenceScore: 0.9,
      matchMethod: 'exact_id'
    });

    expect(matchRepo.getById(match.id)).not.toBeNull();

    // Delete project
    projectRepo.delete(testProjectId);

    // Activity match should be cascade deleted
    expect(matchRepo.getById(match.id)).toBeNull();
  });

  it('should delete only suggested matches via deleteSuggestedByProgressUpdateId while preserving confirmed and rejected rows', () => {
    // 1. Suggested match
    const mSuggested = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivityId,
      confidenceScore: 0.85,
      matchMethod: 'text_similarity',
      status: 'suggested'
    });

    // 2. Confirmed match
    const mConfirmed = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivity2Id,
      confidenceScore: 0.95,
      matchMethod: 'exact_id',
      status: 'confirmed',
      reviewedBy: 'Senior Engineer',
      reviewedAt: '2026-08-26T10:00:00Z'
    });

    // 3. Delete only suggested matches
    const deletedCount = matchRepo.deleteSuggestedByProgressUpdateId(testUpdateId, testProjectId);
    expect(deletedCount).toBe(1);

    // Verify suggested is deleted
    expect(matchRepo.getById(mSuggested.id)).toBeNull();

    // Verify confirmed is preserved
    const retrievedConfirmed = matchRepo.getById(mConfirmed.id);
    expect(retrievedConfirmed).not.toBeNull();
    expect(retrievedConfirmed?.status).toBe('confirmed');
    expect(retrievedConfirmed?.reviewedBy).toBe('Senior Engineer');

    // Verify cross-project scoping: calling with testProject2Id deletes 0 rows
    const crossDeleteCount = matchRepo.deleteSuggestedByProgressUpdateId(testUpdateId, testProject2Id);
    expect(crossDeleteCount).toBe(0);
  });

  it('should cascade delete activity matches when progress update is deleted', () => {
    const match = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivityId,
      confidenceScore: 0.9,
      matchMethod: 'exact_id'
    });

    expect(matchRepo.getById(match.id)).not.toBeNull();

    // Delete progress update
    updateRepo.delete(testUpdateId);

    // Activity match should be cascade deleted
    expect(matchRepo.getById(match.id)).toBeNull();
  });

  it('should execute confirmMatchAtomically updating match and inserting project event in one transaction', () => {
    const match = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivityId,
      confidenceScore: 0.75,
      matchMethod: 'text_similarity',
      status: 'suggested',
      confidenceTier: 'medium',
      reviewState: 'awaiting_review'
    });

    const nowIso = new Date().toISOString();
    const confirmed = matchRepo.confirmMatchAtomically({
      id: match.id,
      projectId: testProjectId,
      reviewer: 'Engineer Alex',
      nowIso
    });

    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.reviewState).toBe('resolved');
    expect(confirmed.reviewedBy).toBe('Engineer Alex');

    // Verify event in DB
    const eventRow = db.prepare(`
      SELECT * FROM project_events WHERE entity_id = ? AND event_type = 'match_confirmed'
    `).get(match.id) as { summary: string; project_id: string } | undefined;
    expect(eventRow).toBeDefined();
    expect(eventRow?.project_id).toBe(testProjectId);
  });

  it('should execute rejectMatchAtomically updating match and inserting project event in one transaction', () => {
    const match = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivityId,
      confidenceScore: 0.75,
      matchMethod: 'text_similarity',
      status: 'suggested',
      confidenceTier: 'medium',
      reviewState: 'awaiting_review'
    });

    const nowIso = new Date().toISOString();
    const rejected = matchRepo.rejectMatchAtomically({
      id: match.id,
      projectId: testProjectId,
      reviewer: 'Lead Auditor',
      nowIso,
      rationale: 'Irrelevant item',
      reason: 'Out of scope'
    });

    expect(rejected.status).toBe('rejected');
    expect(rejected.reviewState).toBe('resolved');
    expect(rejected.reviewedBy).toBe('Lead Auditor');

    const eventRow = db.prepare(`
      SELECT * FROM project_events WHERE entity_id = ? AND event_type = 'match_rejected'
    `).get(match.id) as { summary: string; project_id: string } | undefined;
    expect(eventRow).toBeDefined();
  });

  it('should execute resolveMatchAtomically retargeting activity, setting manual method and inserting event', () => {
    const match = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivityId,
      confidenceScore: 0.45,
      matchMethod: 'text_similarity',
      status: 'suggested',
      confidenceTier: 'low',
      reviewState: 'unresolved'
    });

    const nowIso = new Date().toISOString();
    const resolved = matchRepo.resolveMatchAtomically({
      id: match.id,
      projectId: testProjectId,
      targetActivityId: testActivity2Id,
      targetActivityName: 'Foundation Concrete',
      targetActivityExternalId: 'ACT-102',
      originalActivityId: testActivityId,
      reviewer: 'Supervisor Sam',
      rationale: 'Resolved to ACT-102',
      nowIso
    });

    expect(resolved.status).toBe('confirmed');
    expect(resolved.activityId).toBe(testActivity2Id);
    expect(resolved.matchMethod).toBe('manual');
    expect(resolved.confidenceScore).toBe(0.45); // original score preserved

    const eventRow = db.prepare(`
      SELECT * FROM project_events WHERE entity_id = ? AND event_type = 'match_resolved'
    `).get(match.id) as { summary: string; project_id: string } | undefined;
    expect(eventRow).toBeDefined();
  });

  it('should execute persistMatchesAndEventsAtomically in a single atomic transaction', () => {
    const matchInputs = [
      {
        projectId: testProjectId,
        progressUpdateId: testUpdateId,
        activityId: testActivityId,
        confidenceScore: 0.95,
        matchMethod: 'exact_id' as const,
        status: 'confirmed' as const,
        confidenceTier: 'high' as const,
        reviewState: 'resolved' as const,
        reviewedBy: 'system',
        reviewedAt: new Date().toISOString()
      },
      {
        projectId: testProjectId,
        progressUpdateId: testUpdateId,
        activityId: testActivity2Id,
        confidenceScore: 0.72,
        matchMethod: 'text_similarity' as const,
        status: 'suggested' as const,
        confidenceTier: 'medium' as const,
        reviewState: 'awaiting_review' as const
      }
    ];

    const eventInputs = [
      {
        projectId: testProjectId,
        eventType: 'match_auto_confirmed',
        entityType: 'activity_matches',
        entityId: 'dummy-1',
        summary: 'Auto-confirmed'
      },
      {
        projectId: testProjectId,
        eventType: 'match_suggested',
        entityType: 'activity_matches',
        entityId: 'dummy-2',
        summary: 'Suggested'
      }
    ];

    const results = matchRepo.persistMatchesAndEventsAtomically({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      matches: matchInputs,
      events: eventInputs
    });

    expect(results).toHaveLength(2);
    const confirmedRow = results.find((r) => r.status === 'confirmed');
    const suggestedRow = results.find((r) => r.status === 'suggested');
    expect(confirmedRow).toBeDefined();
    expect(suggestedRow).toBeDefined();

    const events = db.prepare(`
      SELECT * FROM project_events WHERE project_id = ? AND event_type IN ('match_auto_confirmed', 'match_suggested')
    `).all(testProjectId);
    expect(events).toHaveLength(2);
  });

  describe('listByProgressUpdateIds (Batch Query & Project Isolation)', () => {
    it('should return empty array for empty update IDs without executing query', () => {
      const results = matchRepo.listByProgressUpdateIds([], testProjectId);
      expect(results).toEqual([]);
    });

    it('should batch query matches for multiple updates deterministically and enforce project isolation', () => {
      // Create second update for project 1
      const update2 = updateRepo.create({
        projectId: testProjectId,
        reportDate: '2026-08-27',
        reporterName: 'Worker 2',
        sourceType: 'manual',
        rawText: 'Report 2'
      });

      // Matches for Project 1 Update 1
      matchRepo.create({
        projectId: testProjectId,
        progressUpdateId: testUpdateId,
        activityId: testActivityId,
        confidenceScore: 0.95,
        matchMethod: 'exact_id',
        status: 'confirmed'
      });

      // Matches for Project 1 Update 2
      matchRepo.create({
        projectId: testProjectId,
        progressUpdateId: update2.id,
        activityId: testActivity2Id,
        confidenceScore: 0.88,
        matchMethod: 'text_similarity',
        status: 'suggested'
      });

      // Project 2 with separate update and match
      const project2 = projectRepo.create({ name: 'Project Two', code: 'P2' });
      const schedule2 = scheduleRepo.create({ projectId: project2.id, name: 'S2', sourceType: 'manual' });
      const actP2 = activityRepo.create({
        projectId: project2.id,
        scheduleId: schedule2.id,
        externalId: 'ACT-P2',
        name: 'Project 2 Activity',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-10'
      });
      const updateP2 = updateRepo.create({
        projectId: project2.id,
        reportDate: '2026-08-28',
        reporterName: 'Worker P2',
        sourceType: 'manual',
        rawText: 'Project 2 report'
      });
      matchRepo.create({
        projectId: project2.id,
        progressUpdateId: updateP2.id,
        activityId: actP2.id,
        confidenceScore: 0.99,
        matchMethod: 'exact_id',
        status: 'confirmed'
      });

      // Batch query across Project 1 update IDs
      const p1Results = matchRepo.listByProgressUpdateIds([testUpdateId, update2.id], testProjectId);
      expect(p1Results).toHaveLength(2);
      expect(p1Results.every((m) => m.projectId === testProjectId)).toBe(true);

      // Verify Project 2 cannot read Project 1 updates even if passed Project 1 update IDs
      const p2Results = matchRepo.listByProgressUpdateIds([testUpdateId, update2.id], project2.id);
      expect(p2Results).toHaveLength(0);

      // Verify Project 2 can read its own update ID
      const p2OwnResults = matchRepo.listByProgressUpdateIds([updateP2.id], project2.id);
      expect(p2OwnResults).toHaveLength(1);
      expect(p2OwnResults[0].projectId).toBe(project2.id);
    });
  });
});
