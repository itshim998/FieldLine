import { describe, it, expect, beforeEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteProjectEventRepository } from '../src/repositories/project-event.repository.js';

describe('SqliteProjectEventRepository', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let eventRepo: SqliteProjectEventRepository;
  let projectAId: string;
  let projectBId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    projectRepo = new SqliteProjectRepository(() => db);
    eventRepo = new SqliteProjectEventRepository(() => db);

    const pA = projectRepo.create({
      name: 'Bridge Project A',
      code: 'BPA-01',
      status: 'active'
    });
    projectAId = pA.id;

    const pB = projectRepo.create({
      name: 'Highway Project B',
      code: 'HPB-02',
      status: 'active'
    });
    projectBId = pB.id;
  });

  it('should create and retrieve project events by ID and project ID', () => {
    const event = eventRepo.create({
      projectId: projectAId,
      eventType: 'progress_updated',
      entityType: 'activity_progress',
      entityId: 'act-prog-1',
      summary: 'Progress updated to 50%',
      payloadJson: JSON.stringify({ actualPercent: 50 })
    });

    expect(event.id).toBeDefined();
    expect(event.projectId).toBe(projectAId);
    expect(event.eventType).toBe('progress_updated');
    expect(event.summary).toBe('Progress updated to 50%');

    const fetched = eventRepo.getById(event.id, projectAId);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(event.id);

    // Cross-project query should return null
    const foreignFetched = eventRepo.getById(event.id, projectBId);
    expect(foreignFetched).toBeNull();
  });

  it('should list recent events scoped to project with limit', () => {
    for (let i = 1; i <= 10; i++) {
      db.prepare(`
        INSERT INTO project_events (id, project_id, event_type, summary, created_at)
        VALUES (?, ?, 'test_event', ?, ?)
      `).run(`evt-${i}`, projectAId, `Summary ${i}`, `2026-08-${String(10 + i).padStart(2, '0')} 12:00:00`);
    }

    // Insert for project B
    db.prepare(`
      INSERT INTO project_events (id, project_id, event_type, summary, created_at)
      VALUES (?, ?, 'foreign_event', 'Foreign summary', '2026-08-15 12:00:00')
    `).run('evt-foreign', projectBId);

    const recentA = eventRepo.listRecentByProject(projectAId, { limit: 5 });
    expect(recentA).toHaveLength(5);
    expect(recentA[0].id).toBe('evt-10');
    expect(recentA[4].id).toBe('evt-6');
    // Ensure no foreign events leaked
    expect(recentA.some((e) => e.projectId === projectBId)).toBe(false);
  });

  it('should filter events within asOfDate and sinceDate boundaries', () => {
    // Dates: 2026-08-10, 2026-08-15, 2026-08-20, 2026-08-25
    db.prepare(`
      INSERT INTO project_events (id, project_id, event_type, summary, created_at)
      VALUES ('e1', ?, 'test', 'Early', '2026-08-10 10:00:00'),
             ('e2', ?, 'test', 'Mid', '2026-08-15 15:30:00'),
             ('e3', ?, 'test', 'Target', '2026-08-20 23:59:59'),
             ('e4', ?, 'test', 'Future', '2026-08-25 08:00:00')
    `).run(projectAId, projectAId, projectAId, projectAId);

    const filtered = eventRepo.listRecentByProject(projectAId, {
      asOfDate: '2026-08-20',
      sinceDate: '2026-08-13'
    });

    // Should include e2 and e3, but exclude e1 (< 08-13) and e4 (> 08-20)
    expect(filtered.map((e) => e.id)).toEqual(['e3', 'e2']);
  });
});
