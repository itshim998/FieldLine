import { Database as DatabaseType } from 'better-sqlite3';

export const name = '0002_core_domain_schema';

export function up(db: DatabaseType): void {
  db.exec(`
    -- 1. Projects table
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planning', 'active', 'paused', 'completed', 'archived')),
      start_date TEXT,
      target_end_date TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Schedules table
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0',
      source_type TEXT NOT NULL CHECK (source_type IN ('csv', 'xlsx', 'p6', 'manual')),
      source_filename TEXT,
      is_baseline INTEGER NOT NULL DEFAULT 1 CHECK (is_baseline IN (0, 1)),
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (project_id, id)
    );

    -- 3. Activities table
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      schedule_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      wbs_code TEXT,
      location TEXT,
      planned_start TEXT NOT NULL,
      planned_finish TEXT NOT NULL,
      planned_quantity REAL CHECK (planned_quantity IS NULL OR planned_quantity >= 0),
      unit TEXT,
      baseline_progress REAL NOT NULL DEFAULT 0.0 CHECK (baseline_progress >= 0.0 AND baseline_progress <= 100.0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id, schedule_id) REFERENCES schedules(project_id, id) ON DELETE CASCADE,
      UNIQUE (schedule_id, external_id),
      UNIQUE (project_id, id)
    );

    -- 4. Progress Updates table
    CREATE TABLE IF NOT EXISTS progress_updates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      report_date TEXT NOT NULL,
      reporter_name TEXT,
      reporter_role TEXT,
      source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'voice', 'pdf', 'xlsx', 'image', 'text')),
      raw_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'reviewed')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (project_id, id)
    );

    -- 5. Evidence table
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      progress_update_id TEXT,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL CHECK (file_type IN ('text', 'xlsx', 'pdf', 'image', 'transcript', 'other')),
      file_size_bytes INTEGER CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
      mime_type TEXT,
      metadata_json TEXT,
      uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id, progress_update_id) REFERENCES progress_updates(project_id, id) ON DELETE CASCADE,
      UNIQUE (project_id, id)
    );

    -- 6. Activity Matches table
    CREATE TABLE IF NOT EXISTS activity_matches (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      progress_update_id TEXT NOT NULL,
      evidence_id TEXT,
      activity_id TEXT NOT NULL,
      confidence_score REAL NOT NULL CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
      match_method TEXT NOT NULL CHECK (match_method IN ('exact_id', 'text_similarity', 'wbs_location', 'llm_assisted', 'manual')),
      matched_text TEXT,
      rationale TEXT,
      status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'confirmed', 'rejected')),
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id, progress_update_id) REFERENCES progress_updates(project_id, id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, activity_id) REFERENCES activities(project_id, id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, evidence_id) REFERENCES evidence(project_id, id) ON DELETE CASCADE
    );

    -- 7. Activity Progress table
    CREATE TABLE IF NOT EXISTS activity_progress (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      activity_id TEXT NOT NULL,
      progress_update_id TEXT,
      actual_percent REAL NOT NULL CHECK (actual_percent >= 0.0 AND actual_percent <= 100.0),
      actual_quantity REAL CHECK (actual_quantity IS NULL OR actual_quantity >= 0),
      actual_start TEXT,
      actual_finish TEXT,
      status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('not_started', 'started', 'in_progress', 'completed', 'delayed')),
      as_of_date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id, activity_id) REFERENCES activities(project_id, id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, progress_update_id) REFERENCES progress_updates(project_id, id) ON DELETE CASCADE
    );

    -- 8. Project Events table
    CREATE TABLE IF NOT EXISTS project_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      summary TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Relational and Lookup Indexes
    CREATE INDEX IF NOT EXISTS idx_schedules_project_id ON schedules(project_id);
    CREATE INDEX IF NOT EXISTS idx_activities_project_id ON activities(project_id);
    CREATE INDEX IF NOT EXISTS idx_activities_schedule_id ON activities(schedule_id);
    CREATE INDEX IF NOT EXISTS idx_activities_external_id ON activities(external_id);
    CREATE INDEX IF NOT EXISTS idx_activities_schedule_external ON activities(schedule_id, external_id);
    CREATE INDEX IF NOT EXISTS idx_progress_updates_project_date ON progress_updates(project_id, report_date);
    CREATE INDEX IF NOT EXISTS idx_evidence_project_id ON evidence(project_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_update_id ON evidence(progress_update_id);
    CREATE INDEX IF NOT EXISTS idx_activity_matches_project_id ON activity_matches(project_id);
    CREATE INDEX IF NOT EXISTS idx_activity_matches_update_id ON activity_matches(progress_update_id);
    CREATE INDEX IF NOT EXISTS idx_activity_matches_activity_id ON activity_matches(activity_id);
    CREATE INDEX IF NOT EXISTS idx_activity_progress_project_activity ON activity_progress(project_id, activity_id);
    CREATE INDEX IF NOT EXISTS idx_activity_progress_activity_id ON activity_progress(activity_id);
    CREATE INDEX IF NOT EXISTS idx_project_events_project_created ON project_events(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_project_events_event_type ON project_events(event_type);
  `);
}
