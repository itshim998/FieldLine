import { Database as DatabaseType } from 'better-sqlite3';

export const name = '0004_upgrade_cross_project_integrity';

function tableExists(db: DatabaseType, tableName: string): boolean {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
  return row !== undefined;
}

/**
 * Migration 0004: Upgrades existing databases to enforce cross-project referential integrity
 * and ensure proper ON DELETE SET NULL behavior on nullable references while preserving all data.
 */
export function up(db: DatabaseType): void {
  // 0. Drop existing triggers first to prevent invalid table references during rebuild
  db.exec(`
    DROP TRIGGER IF EXISTS trg_evidence_project_consistency_insert;
    DROP TRIGGER IF EXISTS trg_evidence_project_consistency_update;
    DROP TRIGGER IF EXISTS trg_activity_matches_evidence_consistency_insert;
    DROP TRIGGER IF EXISTS trg_activity_matches_evidence_consistency_update;
    DROP TRIGGER IF EXISTS trg_activity_progress_update_consistency_insert;
    DROP TRIGGER IF EXISTS trg_activity_progress_update_consistency_update;
  `);

  // 1. Rebuild schedules table with UNIQUE (project_id, id)
  if (tableExists(db, 'schedules')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schedules_v4 (
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
      INSERT OR IGNORE INTO schedules_v4 SELECT * FROM schedules;
      DROP TABLE IF EXISTS schedules;
      ALTER TABLE schedules_v4 RENAME TO schedules;
    `);
  }

  // 2. Rebuild activities table with composite FK to schedules(project_id, id) and UNIQUE (project_id, id)
  if (tableExists(db, 'activities')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activities_v4 (
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
      INSERT OR IGNORE INTO activities_v4 SELECT * FROM activities;
      DROP TABLE IF EXISTS activities;
      ALTER TABLE activities_v4 RENAME TO activities;
    `);
  }

  // 3. Rebuild progress_updates table with UNIQUE (project_id, id)
  if (tableExists(db, 'progress_updates')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS progress_updates_v4 (
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
      INSERT OR IGNORE INTO progress_updates_v4 SELECT * FROM progress_updates;
      DROP TABLE IF EXISTS progress_updates;
      ALTER TABLE progress_updates_v4 RENAME TO progress_updates;
    `);
  }

  // 4. Rebuild evidence table with ON DELETE SET NULL on progress_update_id and UNIQUE (project_id, id)
  if (tableExists(db, 'evidence')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS evidence_v4 (
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
        FOREIGN KEY (progress_update_id) REFERENCES progress_updates(id) ON DELETE SET NULL,
        UNIQUE (project_id, id)
      );
      INSERT OR IGNORE INTO evidence_v4 SELECT * FROM evidence;
      DROP TABLE IF EXISTS evidence;
      ALTER TABLE evidence_v4 RENAME TO evidence;
    `);
  }

  // 5. Rebuild activity_matches table with composite FKs for progress_updates and activities, and ON DELETE SET NULL on evidence_id
  if (tableExists(db, 'activity_matches')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_matches_v4 (
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
        FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE SET NULL
      );
      INSERT OR IGNORE INTO activity_matches_v4 SELECT * FROM activity_matches;
      DROP TABLE IF EXISTS activity_matches;
      ALTER TABLE activity_matches_v4 RENAME TO activity_matches;
    `);
  }

  // 6. Rebuild activity_progress table with composite FK for activity and ON DELETE SET NULL on progress_update_id
  if (tableExists(db, 'activity_progress')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_progress_v4 (
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
        FOREIGN KEY (progress_update_id) REFERENCES progress_updates(id) ON DELETE SET NULL
      );
      INSERT OR IGNORE INTO activity_progress_v4 SELECT * FROM activity_progress;
      DROP TABLE IF EXISTS activity_progress;
      ALTER TABLE activity_progress_v4 RENAME TO activity_progress;
    `);
  }

  // 7. Ensure integrity triggers if affected tables exist
  if (tableExists(db, 'evidence')) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_evidence_project_consistency_insert
      BEFORE INSERT ON evidence
      FOR EACH ROW
      WHEN NEW.progress_update_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: cross-project evidence reference')
        WHERE (SELECT project_id FROM progress_updates WHERE id = NEW.progress_update_id) != NEW.project_id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_evidence_project_consistency_update
      BEFORE UPDATE OF project_id, progress_update_id ON evidence
      FOR EACH ROW
      WHEN NEW.progress_update_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: cross-project evidence reference')
        WHERE (SELECT project_id FROM progress_updates WHERE id = NEW.progress_update_id) != NEW.project_id;
      END;

      CREATE INDEX IF NOT EXISTS idx_evidence_project_id ON evidence(project_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_update_id ON evidence(progress_update_id);
    `);
  }

  if (tableExists(db, 'activity_matches')) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_activity_matches_evidence_consistency_insert
      BEFORE INSERT ON activity_matches
      FOR EACH ROW
      WHEN NEW.evidence_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: cross-project match evidence reference')
        WHERE (SELECT project_id FROM evidence WHERE id = NEW.evidence_id) != NEW.project_id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_activity_matches_evidence_consistency_update
      BEFORE UPDATE OF project_id, evidence_id ON activity_matches
      FOR EACH ROW
      WHEN NEW.evidence_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: cross-project match evidence reference')
        WHERE (SELECT project_id FROM evidence WHERE id = NEW.evidence_id) != NEW.project_id;
      END;

      CREATE INDEX IF NOT EXISTS idx_activity_matches_project_id ON activity_matches(project_id);
      CREATE INDEX IF NOT EXISTS idx_activity_matches_update_id ON activity_matches(progress_update_id);
      CREATE INDEX IF NOT EXISTS idx_activity_matches_activity_id ON activity_matches(activity_id);
    `);
  }

  if (tableExists(db, 'activity_progress')) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_activity_progress_update_consistency_insert
      BEFORE INSERT ON activity_progress
      FOR EACH ROW
      WHEN NEW.progress_update_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: cross-project progress update reference')
        WHERE (SELECT project_id FROM progress_updates WHERE id = NEW.progress_update_id) != NEW.project_id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_activity_progress_update_consistency_update
      BEFORE UPDATE OF project_id, progress_update_id ON activity_progress
      FOR EACH ROW
      WHEN NEW.progress_update_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: cross-project progress update reference')
        WHERE (SELECT project_id FROM progress_updates WHERE id = NEW.progress_update_id) != NEW.project_id;
      END;

      CREATE INDEX IF NOT EXISTS idx_activity_progress_project_activity ON activity_progress(project_id, activity_id);
      CREATE INDEX IF NOT EXISTS idx_activity_progress_activity_id ON activity_progress(activity_id);
    `);
  }

  if (tableExists(db, 'schedules')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_schedules_project_id ON schedules(project_id);
    `);
  }

  if (tableExists(db, 'activities')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_activities_project_id ON activities(project_id);
      CREATE INDEX IF NOT EXISTS idx_activities_schedule_id ON activities(schedule_id);
      CREATE INDEX IF NOT EXISTS idx_activities_external_id ON activities(external_id);
      CREATE INDEX IF NOT EXISTS idx_activities_schedule_external ON activities(schedule_id, external_id);
    `);
  }

  if (tableExists(db, 'progress_updates')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_progress_updates_project_date ON progress_updates(project_id, report_date);
    `);
  }

  if (tableExists(db, 'project_events')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_project_events_project_created ON project_events(project_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_project_events_event_type ON project_events(event_type);
    `);
  }
}
