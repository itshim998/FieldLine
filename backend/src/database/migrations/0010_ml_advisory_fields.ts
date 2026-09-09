import { Database as DatabaseType } from 'better-sqlite3';

export const name = '0010_ml_advisory_fields';

function tableExists(db: DatabaseType, tableName: string): boolean {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
  return row !== undefined;
}

function columnExists(db: DatabaseType, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((col) => col.name === columnName);
}

/**
 * Migration 0010: Adds advisory ML review columns to activity_matches:
 * - ml_confidence: Learned Match Model confidence score [0, 1]
 * - anomaly_score: Learned Anomaly Model continuous score [0, 1]
 * - anomaly_severity: Severity band ('normal' | 'review' | 'high')
 * - anomaly_reasons_json: Serialized diagnostic reasons citing statistical deviations
 *
 * CRITICAL CANONICAL BOUNDARY INVARIANT:
 * These columns store advisory review metadata ONLY to support asynchronous review.
 * They must NEVER touch activity_progress or modify deterministic risk calculations.
 */
export function up(db: DatabaseType): void {
  if (tableExists(db, 'activity_matches')) {
    if (!columnExists(db, 'activity_matches', 'ml_confidence')) {
      db.exec(`
        ALTER TABLE activity_matches ADD COLUMN ml_confidence REAL;
      `);
    }

    if (!columnExists(db, 'activity_matches', 'anomaly_score')) {
      db.exec(`
        ALTER TABLE activity_matches ADD COLUMN anomaly_score REAL;
      `);
    }

    if (!columnExists(db, 'activity_matches', 'anomaly_severity')) {
      db.exec(`
        ALTER TABLE activity_matches ADD COLUMN anomaly_severity TEXT CHECK (anomaly_severity IS NULL OR anomaly_severity IN ('normal', 'review', 'high'));
      `);
    }

    if (!columnExists(db, 'activity_matches', 'anomaly_reasons_json')) {
      db.exec(`
        ALTER TABLE activity_matches ADD COLUMN anomaly_reasons_json TEXT;
      `);
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_activity_matches_anomaly_severity
        ON activity_matches(project_id, anomaly_severity);
    `);
  }
}
