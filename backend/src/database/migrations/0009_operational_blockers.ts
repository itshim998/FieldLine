import { Database as DatabaseType } from 'better-sqlite3';

export const name = '0009_operational_blockers';

function tableExists(db: DatabaseType, tableName: string): boolean {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
  return row !== undefined;
}

/**
 * Migration 0009: Creates operational_blockers table to support first-class
 * operational constraint reporting and tracking (Pass 33).
 */
export function up(db: DatabaseType): void {
  if (!tableExists(db, 'operational_blockers')) {
    db.exec(`
      CREATE TABLE operational_blockers (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        activity_id TEXT,
        category TEXT NOT NULL CHECK (category IN ('equipment', 'material', 'access', 'inspection', 'weather', 'safety', 'coordination')),
        description TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'resolved')) DEFAULT 'active',
        reporter_name TEXT NOT NULL,
        reporter_role TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        CONSTRAINT fk_operational_blockers_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        CONSTRAINT fk_operational_blockers_activity FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_operational_blockers_project_status 
        ON operational_blockers(project_id, status);

      CREATE INDEX IF NOT EXISTS idx_operational_blockers_activity 
        ON operational_blockers(activity_id);
    `);
  }
}
