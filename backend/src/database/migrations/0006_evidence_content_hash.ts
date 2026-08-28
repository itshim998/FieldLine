import { Database as DatabaseType } from 'better-sqlite3';

export const name = '0006_evidence_content_hash';

function tableExists(db: DatabaseType, tableName: string): boolean {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
  return row !== undefined;
}

function columnExists(db: DatabaseType, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((col) => col.name === columnName);
}

/**
 * Migration 0006: Adds content_sha256 to evidence table and creates unique index
 * on (project_id, content_sha256) to enforce per-project content-level deduplication.
 */
export function up(db: DatabaseType): void {
  if (tableExists(db, 'evidence')) {
    if (!columnExists(db, 'evidence', 'content_sha256')) {
      db.exec(`
        ALTER TABLE evidence ADD COLUMN content_sha256 TEXT DEFAULT NULL;
      `);
    }

    // Create project-scoped unique index on (project_id, content_sha256) for non-null/non-empty hashes
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_evidence_project_content_sha256 
        ON evidence (project_id, content_sha256)
        WHERE content_sha256 != '' AND content_sha256 IS NOT NULL;
    `);
  }
}
