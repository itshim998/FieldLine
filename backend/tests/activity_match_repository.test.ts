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
});
