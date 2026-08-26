import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { DatabaseError } from '../src/errors/AppError.js';

describe('SqliteActivityProgressRepository', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let updateRepo: SqliteProgressUpdateRepository;
  let progressRepo: SqliteActivityProgressRepository;

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
    progressRepo = new SqliteActivityProgressRepository(() => db);

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

    const a2 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-102',
      name: 'Foundation Concrete',
      location: 'Block B',
      wbsCode: '3.2',
      plannedStart: '2026-09-16',
      plannedFinish: '2026-09-30',
      plannedQuantity: 300,
      unit: 'm3'
    });
    testActivity2Id = a2.id;

    const u1 = updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-26',
      reporterName: 'Rajesh',
      sourceType: 'manual',
      rawText: 'Excavation 60% complete.'
    });
    testUpdateId = u1.id;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it('should create and retrieve an activity progress observation', () => {
    const row = progressRepo.create({
      projectId: testProjectId,
      activityId: testActivityId,
      progressUpdateId: testUpdateId,
      actualPercent: 60,
      actualQuantity: 300,
      actualStart: '2026-08-01',
      actualFinish: null,
      status: 'in_progress',
      asOfDate: '2026-08-26',
      notes: 'Quantity-derived progress: 300/500 m3 (60%).'
    });

    expect(row).toBeDefined();
    expect(row.id).toBeDefined();
    expect(row.projectId).toBe(testProjectId);
    expect(row.activityId).toBe(testActivityId);
    expect(row.progressUpdateId).toBe(testUpdateId);
    expect(row.actualPercent).toBe(60);
    expect(row.actualQuantity).toBe(300);
    expect(row.actualStart).toBe('2026-08-01');
    expect(row.status).toBe('in_progress');
    expect(row.asOfDate).toBe('2026-08-26');
    expect(row.notes).toContain('Quantity-derived progress');

    const fetched = progressRepo.getById(row.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(row.id);

    const projectScoped = progressRepo.getByIdAndProjectId(row.id, testProjectId);
    expect(projectScoped).not.toBeNull();
    expect(projectScoped?.id).toBe(row.id);

    const crossProject = progressRepo.getByIdAndProjectId(row.id, testProject2Id);
    expect(crossProject).toBeNull();
  });

  it('should list observations by activity and order newest asOfDate first', () => {
    progressRepo.create({
      projectId: testProjectId,
      activityId: testActivityId,
      progressUpdateId: testUpdateId,
      actualPercent: 40,
      actualQuantity: 200,
      status: 'in_progress',
      asOfDate: '2026-08-20'
    });

    progressRepo.create({
      projectId: testProjectId,
      activityId: testActivityId,
      progressUpdateId: testUpdateId,
      actualPercent: 60,
      actualQuantity: 300,
      status: 'in_progress',
      asOfDate: '2026-08-26'
    });

    const list = progressRepo.listByActivityId(testActivityId, testProjectId);
    expect(list).toHaveLength(2);
    expect(list[0].asOfDate).toBe('2026-08-26');
    expect(list[0].actualPercent).toBe(60);
    expect(list[1].asOfDate).toBe('2026-08-20');
    expect(list[1].actualPercent).toBe(40);
  });

  it('should retrieve the latest canonical observation by asOfDate regardless of creation order', () => {
    // Insert newer asOfDate first
    progressRepo.create({
      projectId: testProjectId,
      activityId: testActivityId,
      actualPercent: 60,
      asOfDate: '2026-08-26'
    });

    // Insert older asOfDate later (simulating late arrival)
    progressRepo.create({
      projectId: testProjectId,
      activityId: testActivityId,
      actualPercent: 40,
      asOfDate: '2026-08-20'
    });

    const latest = progressRepo.getLatestByActivityId(testActivityId, testProjectId);
    expect(latest).not.toBeNull();
    expect(latest?.asOfDate).toBe('2026-08-26');
    expect(latest?.actualPercent).toBe(60);
  });

  it('should atomically persist activity progress and project event', () => {
    const progress = progressRepo.createWithEvent(
      {
        projectId: testProjectId,
        activityId: testActivityId,
        progressUpdateId: testUpdateId,
        actualPercent: 75,
        status: 'in_progress',
        asOfDate: '2026-08-26',
        notes: 'Reported 75%'
      },
      {
        projectId: testProjectId,
        eventType: 'progress_updated',
        entityType: 'activity_progress',
        summary: 'Activity progress updated to 75%',
        payloadJson: JSON.stringify({ actualPercent: 75 })
      }
    );

    expect(progress).toBeDefined();
    expect(progress.actualPercent).toBe(75);

    // Verify event exists in DB
    const eventRow = db
      .prepare('SELECT * FROM project_events WHERE entity_id = ?')
      .get(progress.id) as { event_type: string; summary: string } | undefined;

    expect(eventRow).toBeDefined();
    expect(eventRow?.event_type).toBe('progress_updated');
    expect(eventRow?.summary).toBe('Activity progress updated to 75%');
  });

  it('should rollback transaction if event creation fails during createWithEvent', () => {
    // Attempting to create an event referencing a non-existent foreign project or invalid schema will trigger rollback
    expect(() => {
      progressRepo.createWithEvent(
        {
          projectId: testProjectId,
          activityId: testActivityId,
          progressUpdateId: testUpdateId,
          actualPercent: 80,
          status: 'in_progress',
          asOfDate: '2026-08-26'
        },
        {
          projectId: 'non-existent-project-id', // Foreign key violation!
          eventType: 'progress_updated',
          summary: 'Invalid event'
        }
      );
    }).toThrow(DatabaseError);

    // Verify no activity_progress row was persisted
    const progressRows = db
      .prepare('SELECT * FROM activity_progress WHERE actual_percent = 80')
      .all();
    expect(progressRows).toHaveLength(0);

    // Verify no project_events row was persisted
    const eventRows = db
      .prepare("SELECT * FROM project_events WHERE summary = 'Invalid event'")
      .all();
    expect(eventRows).toHaveLength(0);
  });

  it('should find existing observation for idempotency checking', () => {
    const created = progressRepo.create({
      projectId: testProjectId,
      activityId: testActivityId,
      progressUpdateId: testUpdateId,
      actualPercent: 60,
      actualQuantity: 300,
      status: 'in_progress',
      asOfDate: '2026-08-26'
    });

    const existing = progressRepo.findExistingObservation(
      testProjectId,
      testActivityId,
      testUpdateId,
      '2026-08-26',
      60,
      300,
      'in_progress'
    );

    expect(existing).not.toBeNull();
    expect(existing?.id).toBe(created.id);

    // Different percentage
    const diffPct = progressRepo.findExistingObservation(
      testProjectId,
      testActivityId,
      testUpdateId,
      '2026-08-26',
      70,
      300,
      'in_progress'
    );
    expect(diffPct).toBeNull();
  });

  it('should enforce cross-project trigger constraints on progressUpdateId', () => {
    // Create progress update in Project 2
    const u2 = updateRepo.create({
      projectId: testProject2Id,
      reportDate: '2026-08-26',
      sourceType: 'manual',
      rawText: 'Project 2 update'
    });

    // Attempting to attach Project 2 update to Project 1 activity_progress triggers SQLite ABORT
    expect(() => {
      progressRepo.create({
        projectId: testProjectId,
        activityId: testActivityId,
        progressUpdateId: u2.id, // belongs to Project 2!
        actualPercent: 50,
        asOfDate: '2026-08-26'
      });
    }).toThrow(DatabaseError);
  });

  it('should retrieve latest observation as-of date and exclude future observations', () => {
    // Observation at 2026-08-10: 25%
    const o1 = progressRepo.create({
      projectId: testProjectId,
      activityId: testActivityId,
      actualPercent: 25,
      asOfDate: '2026-08-10'
    });

    // Observation at 2026-08-20: 50%
    const o2 = progressRepo.create({
      projectId: testProjectId,
      activityId: testActivityId,
      actualPercent: 50,
      asOfDate: '2026-08-20'
    });

    // Observation at 2026-08-30: 75%
    const o3 = progressRepo.create({
      projectId: testProjectId,
      activityId: testActivityId,
      actualPercent: 75,
      asOfDate: '2026-08-30'
    });

    // As of 2026-08-05 (before any obs): null
    expect(
      progressRepo.getLatestByActivityIdAsOfDate(testActivityId, testProjectId, '2026-08-05')
    ).toBeNull();

    // As of 2026-08-15 (between o1 and o2): should return o1 (25%)
    const resAug15 = progressRepo.getLatestByActivityIdAsOfDate(
      testActivityId,
      testProjectId,
      '2026-08-15'
    );
    expect(resAug15).not.toBeNull();
    expect(resAug15?.id).toBe(o1.id);
    expect(resAug15?.actualPercent).toBe(25);

    // As of 2026-08-25 (between o2 and o3): should return o2 (50%)
    const resAug25 = progressRepo.getLatestByActivityIdAsOfDate(
      testActivityId,
      testProjectId,
      '2026-08-25'
    );
    expect(resAug25).not.toBeNull();
    expect(resAug25?.id).toBe(o2.id);
    expect(resAug25?.actualPercent).toBe(50);

    // As of 2026-09-01 (after o3): should return o3 (75%)
    const resSep01 = progressRepo.getLatestByActivityIdAsOfDate(
      testActivityId,
      testProjectId,
      '2026-09-01'
    );
    expect(resSep01).not.toBeNull();
    expect(resSep01?.id).toBe(o3.id);
    expect(resSep01?.actualPercent).toBe(75);

    // Cross-project check: querying for testProject2Id should return null
    expect(
      progressRepo.getLatestByActivityIdAsOfDate(testActivityId, testProject2Id, '2026-09-01')
    ).toBeNull();
  });
});

