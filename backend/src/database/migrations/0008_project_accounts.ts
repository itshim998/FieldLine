import { Database as DatabaseType } from 'better-sqlite3';

export const name = '0008_project_accounts';

function tableExists(db: DatabaseType, tableName: string): boolean {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
  return row !== undefined;
}

/**
 * Migration 0008: Creates the project_accounts table to support the Two-Account Model
 * (Worker Account vs Admin Account per project) as defined in long_term_plan.md Section 8.
 */
export function up(db: DatabaseType): void {
  if (!tableExists(db, 'project_accounts')) {
    db.exec(`
      CREATE TABLE project_accounts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        account_type TEXT NOT NULL CHECK (account_type IN ('worker', 'admin')),
        credential_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_project_accounts_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        CONSTRAINT uq_project_accounts_project_type UNIQUE (project_id, account_type)
      );

      CREATE INDEX IF NOT EXISTS idx_project_accounts_project_id 
        ON project_accounts(project_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_project_accounts_project_type 
        ON project_accounts(project_id, account_type);
    `);
  }
}
