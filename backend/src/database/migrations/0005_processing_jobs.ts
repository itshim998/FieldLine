import { Database as DatabaseType } from 'better-sqlite3';

export const name = '0005_processing_jobs';

/**
 * Migration 0005: Creates the processing_jobs table for in-process background job processing.
 */
export function up(db: DatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS processing_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      job_type TEXT NOT NULL CHECK (job_type IN ('document_ingestion')),
      status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
      payload_json TEXT NOT NULL,
      result_json TEXT,
      error_message TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      locked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (project_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_processing_jobs_project_created 
      ON processing_jobs (project_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_processing_jobs_project_status_created 
      ON processing_jobs (project_id, status, created_at);

    CREATE INDEX IF NOT EXISTS idx_processing_jobs_status_created 
      ON processing_jobs (status, created_at);
  `);
}
