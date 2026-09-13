-- FieldLine Authoritative PostgreSQL Baseline Migration for Supabase
-- Covers all 14 domain and operational tables, indexes, constraints, and initial metadata.

-- 1. System Metadata
CREATE TABLE IF NOT EXISTS system_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Schema Migrations Tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Projects
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planning', 'active', 'paused', 'completed', 'archived')),
  start_date TEXT,
  target_end_date TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Schedules
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0',
  source_type TEXT NOT NULL CHECK (source_type IN ('csv', 'xlsx', 'p6', 'manual')),
  source_filename TEXT,
  is_baseline INTEGER NOT NULL DEFAULT 1 CHECK (is_baseline IN (0, 1)),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, id)
);

-- 5. Activities
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
  planned_quantity DOUBLE PRECISION CHECK (planned_quantity IS NULL OR planned_quantity >= 0),
  unit TEXT,
  baseline_progress DOUBLE PRECISION NOT NULL DEFAULT 0.0 CHECK (baseline_progress >= 0.0 AND baseline_progress <= 100.0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id, schedule_id) REFERENCES schedules(project_id, id) ON DELETE CASCADE,
  UNIQUE (schedule_id, external_id),
  UNIQUE (project_id, id)
);

-- 6. Progress Updates
CREATE TABLE IF NOT EXISTS progress_updates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_date TEXT NOT NULL,
  reporter_name TEXT,
  reporter_role TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'voice', 'pdf', 'xlsx', 'image', 'text')),
  raw_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'reviewed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, id)
);

-- 7. Evidence
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  progress_update_id TEXT REFERENCES progress_updates(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('text', 'xlsx', 'pdf', 'image', 'transcript', 'other')),
  file_size_bytes BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  mime_type TEXT,
  metadata_json TEXT,
  content_sha256 TEXT DEFAULT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, id)
);

-- 8. Activity Matches
CREATE TABLE IF NOT EXISTS activity_matches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  progress_update_id TEXT NOT NULL,
  evidence_id TEXT REFERENCES evidence(id) ON DELETE SET NULL,
  activity_id TEXT NOT NULL,
  confidence_score DOUBLE PRECISION NOT NULL CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  match_method TEXT NOT NULL CHECK (match_method IN ('exact_id', 'text_similarity', 'wbs_location', 'llm_assisted', 'manual')),
  matched_text TEXT,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'confirmed', 'rejected')),
  confidence_tier TEXT CHECK (confidence_tier IS NULL OR confidence_tier IN ('high', 'medium', 'low')),
  review_state TEXT CHECK (review_state IS NULL OR review_state IN ('unresolved', 'awaiting_review', 'resolved')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  ml_confidence DOUBLE PRECISION,
  anomaly_score DOUBLE PRECISION,
  anomaly_severity TEXT CHECK (anomaly_severity IS NULL OR anomaly_severity IN ('normal', 'review', 'high')),
  anomaly_reasons_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id, progress_update_id) REFERENCES progress_updates(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, activity_id) REFERENCES activities(project_id, id) ON DELETE CASCADE
);

-- 9. Activity Progress
CREATE TABLE IF NOT EXISTS activity_progress (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  progress_update_id TEXT REFERENCES progress_updates(id) ON DELETE SET NULL,
  actual_percent DOUBLE PRECISION NOT NULL CHECK (actual_percent >= 0.0 AND actual_percent <= 100.0),
  actual_quantity DOUBLE PRECISION CHECK (actual_quantity IS NULL OR actual_quantity >= 0),
  actual_start TEXT,
  actual_finish TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('not_started', 'started', 'in_progress', 'completed', 'delayed')),
  as_of_date TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id, activity_id) REFERENCES activities(project_id, id) ON DELETE CASCADE
);

-- 10. Project Events
CREATE TABLE IF NOT EXISTS project_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  summary TEXT NOT NULL,
  payload_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 11. Processing Jobs (In-process background queue)
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, id)
);

-- 12. Project Accounts (Two-Account Model: Worker vs Admin)
CREATE TABLE IF NOT EXISTS project_accounts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  account_type TEXT NOT NULL CHECK (account_type IN ('worker', 'admin')),
  credential_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, account_type)
);

-- 13. Operational Blockers
CREATE TABLE IF NOT EXISTS operational_blockers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  activity_id TEXT REFERENCES activities(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('equipment', 'material', 'access', 'inspection', 'weather', 'safety', 'coordination')),
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'resolved')) DEFAULT 'active',
  reporter_name TEXT NOT NULL,
  reporter_role TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

-- 14. Notification Outbox (Phase 4 Anomaly Alert Outbox)
CREATE TABLE IF NOT EXISTS notification_outbox (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  activity_match_id TEXT NOT NULL REFERENCES activity_matches(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('anomaly_alert')),
  channel TEXT NOT NULL CHECK (channel IN ('email')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'retry_wait', 'delivered', 'failed')),
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT,
  locked_at TEXT,
  last_attempt_at TEXT,
  delivered_at TEXT,
  provider_message_id TEXT,
  last_error_code TEXT,
  last_error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, activity_match_id, notification_type, channel)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_schedules_project_id ON schedules(project_id);
CREATE INDEX IF NOT EXISTS idx_activities_project_id ON activities(project_id);
CREATE INDEX IF NOT EXISTS idx_activities_schedule_id ON activities(schedule_id);
CREATE INDEX IF NOT EXISTS idx_activities_external_id ON activities(external_id);
CREATE INDEX IF NOT EXISTS idx_activities_schedule_external ON activities(schedule_id, external_id);

CREATE INDEX IF NOT EXISTS idx_progress_updates_project_date ON progress_updates(project_id, report_date);
CREATE INDEX IF NOT EXISTS idx_evidence_project_update ON evidence(project_id, progress_update_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_evidence_project_content_sha256 ON evidence (project_id, content_sha256)
  WHERE content_sha256 != '' AND content_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_matches_project_update ON activity_matches(project_id, progress_update_id);
CREATE INDEX IF NOT EXISTS idx_activity_matches_activity_status ON activity_matches(activity_id, status);
CREATE INDEX IF NOT EXISTS idx_activity_matches_review_state ON activity_matches(project_id, review_state);
CREATE INDEX IF NOT EXISTS idx_activity_matches_confidence_tier ON activity_matches(project_id, confidence_tier);
CREATE INDEX IF NOT EXISTS idx_activity_matches_anomaly_severity ON activity_matches(project_id, anomaly_severity);

CREATE INDEX IF NOT EXISTS idx_activity_progress_project_activity_date ON activity_progress(project_id, activity_id, as_of_date);
CREATE INDEX IF NOT EXISTS idx_project_events_project_created ON project_events(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_project_events_entity ON project_events(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_project_created ON processing_jobs (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_project_status_created ON processing_jobs (project_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status_created ON processing_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS idx_project_accounts_project_id ON project_accounts(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_accounts_project_type ON project_accounts(project_id, account_type);

CREATE INDEX IF NOT EXISTS idx_operational_blockers_project_status ON operational_blockers(project_id, status);
CREATE INDEX IF NOT EXISTS idx_operational_blockers_activity ON operational_blockers(activity_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_outbox_idempotency ON notification_outbox(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_next_attempt ON notification_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_project_created ON notification_outbox(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_activity_match ON notification_outbox(activity_match_id);

-- Initial Metadata
INSERT INTO system_metadata (key, value) VALUES
  ('schema_version', '0.3.0'),
  ('app_name', 'FieldLine'),
  ('sih_ps_id', 'SIH26122'),
  ('database_provider', 'postgres'),
  ('phase', 'Persistent Supabase PostgreSQL Migration')
ON CONFLICT(key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = CURRENT_TIMESTAMP;
