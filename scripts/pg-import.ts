import { getValidatedEnv } from '../backend/src/config/env.js';
import { initDatabase, closeDatabase } from '../backend/src/database/db.js';
import { initPostgres, closePostgres, runInPostgresTransaction } from '../backend/src/database/postgres.js';
import { runPostgresMigrations } from '../backend/src/database/postgres-migrator.js';

async function importSQLiteToPostgres(): Promise<void> {
  console.log('====================================================');
  console.log('📦 Importing SQLite Data into Supabase PostgreSQL');
  console.log('====================================================');

  const env = getValidatedEnv();
  if (!env.DATABASE_URL) {
    console.error('❌ Error: DATABASE_URL is not configured.');
    process.exit(1);
  }

  // 1. Initialize SQLite connection
  console.log(`🔍 Opening source SQLite database: ${env.DATABASE_PATH}`);
  const sqliteDb = initDatabase();

  // 2. Initialize PostgreSQL connection
  console.log('🐘 Connecting to destination PostgreSQL database...');
  const pool = await initPostgres({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL
  });

  // Ensure migrations are up to date
  console.log('🛠️ Verifying destination schema migrations...');
  await runPostgresMigrations(pool);

  const startTime = Date.now();
  const summary: Record<string, number> = {};

  await runInPostgresTransaction(async (client) => {
    // 1. system_metadata
    const metadataRows = sqliteDb.prepare('SELECT * FROM system_metadata').all() as Array<{
      key: string;
      value: string;
      updated_at: string;
    }>;
    for (const r of metadataRows) {
      await client.query(
        `INSERT INTO system_metadata (key, value, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [r.key, r.value, r.updated_at]
      );
    }
    summary.system_metadata = metadataRows.length;

    // 2. projects
    const projectRows = sqliteDb.prepare('SELECT * FROM projects').all() as Array<{
      id: string;
      code: string;
      name: string;
      description: string | null;
      baseline_start: string;
      baseline_end: string;
      contractor: string | null;
      created_at: string;
      updated_at: string;
    }>;
    for (const r of projectRows) {
      await client.query(
        `INSERT INTO projects (id, code, name, description, baseline_start, baseline_end, contractor, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           code = EXCLUDED.code, name = EXCLUDED.name, description = EXCLUDED.description,
           baseline_start = EXCLUDED.baseline_start, baseline_end = EXCLUDED.baseline_end,
           contractor = EXCLUDED.contractor, updated_at = EXCLUDED.updated_at`,
        [r.id, r.code, r.name, r.description, r.baseline_start, r.baseline_end, r.contractor, r.created_at, r.updated_at]
      );
    }
    summary.projects = projectRows.length;

    // 3. project_accounts
    const accountRows = sqliteDb.prepare('SELECT * FROM project_accounts').all() as Array<{
      id: string;
      project_id: string;
      role: string;
      username: string;
      display_name: string;
      credential_hash: string;
      is_active: number;
      last_login_at: string | null;
      created_at: string;
      updated_at: string;
    }>;
    for (const r of accountRows) {
      await client.query(
        `INSERT INTO project_accounts (id, project_id, role, username, display_name, credential_hash, is_active, last_login_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           role = EXCLUDED.role, username = EXCLUDED.username, display_name = EXCLUDED.display_name,
           credential_hash = EXCLUDED.credential_hash, is_active = EXCLUDED.is_active,
           last_login_at = EXCLUDED.last_login_at, updated_at = EXCLUDED.updated_at`,
        [r.id, r.project_id, r.role, r.username, r.display_name, r.credential_hash, Boolean(r.is_active), r.last_login_at, r.created_at, r.updated_at]
      );
    }
    summary.project_accounts = accountRows.length;

    // 4. schedules
    const scheduleRows = sqliteDb.prepare('SELECT * FROM schedules').all() as Array<{
      id: string;
      project_id: string;
      name: string;
      version: string | null;
      source_type: string;
      source_filename: string | null;
      is_active: number;
      imported_at: string;
      created_at: string;
    }>;
    for (const r of scheduleRows) {
      await client.query(
        `INSERT INTO schedules (id, project_id, name, version, source_type, source_filename, is_active, imported_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, version = EXCLUDED.version, source_type = EXCLUDED.source_type,
           source_filename = EXCLUDED.source_filename, is_active = EXCLUDED.is_active`,
        [r.id, r.project_id, r.name, r.version, r.source_type, r.source_filename, Boolean(r.is_active), r.imported_at, r.created_at]
      );
    }
    summary.schedules = scheduleRows.length;

    // 5. activities
    const activityRows = sqliteDb.prepare('SELECT * FROM activities').all() as Array<{
      id: string;
      schedule_id: string;
      project_id: string;
      external_id: string;
      name: string;
      wbs_code: string | null;
      planned_start: string;
      planned_end: string;
      planned_duration_days: number;
      weight: number;
      unit_of_measure: string | null;
      planned_quantity: number | null;
      created_at: string;
      updated_at: string;
    }>;
    for (const r of activityRows) {
      await client.query(
        `INSERT INTO activities (id, schedule_id, project_id, external_id, name, wbs_code, planned_start, planned_end, planned_duration_days, weight, unit_of_measure, planned_quantity, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO UPDATE SET
           external_id = EXCLUDED.external_id, name = EXCLUDED.name, wbs_code = EXCLUDED.wbs_code,
           planned_start = EXCLUDED.planned_start, planned_end = EXCLUDED.planned_end,
           planned_duration_days = EXCLUDED.planned_duration_days, weight = EXCLUDED.weight,
           unit_of_measure = EXCLUDED.unit_of_measure, planned_quantity = EXCLUDED.planned_quantity,
           updated_at = EXCLUDED.updated_at`,
        [r.id, r.schedule_id, r.project_id, r.external_id, r.name, r.wbs_code, r.planned_start, r.planned_end, r.planned_duration_days, r.weight, r.unit_of_measure, r.planned_quantity, r.created_at, r.updated_at]
      );
    }
    summary.activities = activityRows.length;

    // 6. progress_updates (must be before evidence since evidence references progress_update_id, and vice versa)
    const puRows = sqliteDb.prepare('SELECT * FROM progress_updates').all() as Array<{
      id: string;
      project_id: string;
      source_type: string;
      source_name: string;
      title: string | null;
      description: string | null;
      raw_text: string | null;
      status: string;
      report_date: string;
      created_at: string;
      updated_at: string;
    }>;
    for (const r of puRows) {
      await client.query(
        `INSERT INTO progress_updates (id, project_id, source_type, source_name, title, description, raw_text, status, report_date, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           source_type = EXCLUDED.source_type, source_name = EXCLUDED.source_name, title = EXCLUDED.title,
           description = EXCLUDED.description, raw_text = EXCLUDED.raw_text, status = EXCLUDED.status,
           report_date = EXCLUDED.report_date, updated_at = EXCLUDED.updated_at`,
        [r.id, r.project_id, r.source_type, r.source_name, r.title, r.description, r.raw_text, r.status, r.report_date, r.created_at, r.updated_at]
      );
    }
    summary.progress_updates = puRows.length;

    // 7. evidence
    const evidenceRows = sqliteDb.prepare('SELECT * FROM evidence').all() as Array<{
      id: string;
      project_id: string;
      progress_update_id: string | null;
      file_name: string;
      file_path: string;
      file_size_bytes: number;
      mime_type: string;
      file_hash: string | null;
      content_hash: string | null;
      evidence_type: string;
      uploaded_at: string;
      created_at: string;
    }>;
    for (const r of evidenceRows) {
      await client.query(
        `INSERT INTO evidence (id, project_id, progress_update_id, file_name, file_path, file_size_bytes, mime_type, file_hash, content_hash, evidence_type, uploaded_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
           progress_update_id = EXCLUDED.progress_update_id, file_name = EXCLUDED.file_name,
           file_path = EXCLUDED.file_path, file_size_bytes = EXCLUDED.file_size_bytes,
           mime_type = EXCLUDED.mime_type, file_hash = EXCLUDED.file_hash, content_hash = EXCLUDED.content_hash,
           evidence_type = EXCLUDED.evidence_type, uploaded_at = EXCLUDED.uploaded_at`,
        [r.id, r.project_id, r.progress_update_id, r.file_name, r.file_path, r.file_size_bytes, r.mime_type, r.file_hash, r.content_hash, r.evidence_type, r.uploaded_at, r.created_at]
      );
    }
    summary.evidence = evidenceRows.length;

    // 8. activity_progress
    const apRows = sqliteDb.prepare('SELECT * FROM activity_progress').all() as Array<{
      id: string;
      project_id: string;
      activity_id: string;
      progress_update_id: string | null;
      source_type: string;
      evidence_id: string | null;
      as_of_date: string;
      quantity_completed: number;
      percent_complete: number;
      notes: string | null;
      created_at: string;
    }>;
    for (const r of apRows) {
      await client.query(
        `INSERT INTO activity_progress (id, project_id, activity_id, progress_update_id, source_type, evidence_id, as_of_date, quantity_completed, percent_complete, notes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           as_of_date = EXCLUDED.as_of_date, quantity_completed = EXCLUDED.quantity_completed,
           percent_complete = EXCLUDED.percent_complete, notes = EXCLUDED.notes`,
        [r.id, r.project_id, r.activity_id, r.progress_update_id, r.source_type, r.evidence_id, r.as_of_date, r.quantity_completed, r.percent_complete, r.notes, r.created_at]
      );
    }
    summary.activity_progress = apRows.length;

    // 9. activity_matches
    const amRows = sqliteDb.prepare('SELECT * FROM activity_matches').all() as Array<{
      id: string;
      project_id: string;
      progress_update_id: string;
      evidence_id: string | null;
      activity_id: string;
      confidence_score: number;
      match_method: string;
      matched_text: string | null;
      rationale: string | null;
      status: string;
      confidence_tier: string | null;
      review_state: string | null;
      reviewed_by: string | null;
      reviewed_at: string | null;
      ml_confidence: number | null;
      anomaly_score: number | null;
      anomaly_severity: string | null;
      anomaly_reasons_json: string | null;
      created_at: string;
      updated_at: string;
    }>;
    for (const r of amRows) {
      await client.query(
        `INSERT INTO activity_matches (id, project_id, progress_update_id, evidence_id, activity_id, confidence_score, match_method, matched_text, rationale, status, confidence_tier, review_state, reviewed_by, reviewed_at, ml_confidence, anomaly_score, anomaly_severity, anomaly_reasons_json, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         ON CONFLICT (id) DO UPDATE SET
           confidence_score = EXCLUDED.confidence_score, match_method = EXCLUDED.match_method,
           matched_text = EXCLUDED.matched_text, rationale = EXCLUDED.rationale, status = EXCLUDED.status,
           confidence_tier = EXCLUDED.confidence_tier, review_state = EXCLUDED.review_state,
           reviewed_by = EXCLUDED.reviewed_by, reviewed_at = EXCLUDED.reviewed_at,
           ml_confidence = EXCLUDED.ml_confidence, anomaly_score = EXCLUDED.anomaly_score,
           anomaly_severity = EXCLUDED.anomaly_severity, anomaly_reasons_json = EXCLUDED.anomaly_reasons_json,
           updated_at = EXCLUDED.updated_at`,
        [r.id, r.project_id, r.progress_update_id, r.evidence_id, r.activity_id, r.confidence_score, r.match_method, r.matched_text, r.rationale, r.status, r.confidence_tier, r.review_state, r.reviewed_by, r.reviewed_at, r.ml_confidence, r.anomaly_score, r.anomaly_severity, r.anomaly_reasons_json, r.created_at, r.updated_at]
      );
    }
    summary.activity_matches = amRows.length;

    // 10. project_events
    const eventRows = sqliteDb.prepare('SELECT * FROM project_events').all() as Array<{
      id: string;
      project_id: string;
      event_type: string;
      entity_type: string;
      entity_id: string;
      summary: string;
      details_json: string | null;
      created_at: string;
    }>;
    for (const r of eventRows) {
      await client.query(
        `INSERT INTO project_events (id, project_id, event_type, entity_type, entity_id, summary, details_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           event_type = EXCLUDED.event_type, summary = EXCLUDED.summary, details_json = EXCLUDED.details_json`,
        [r.id, r.project_id, r.event_type, r.entity_type, r.entity_id, r.summary, r.details_json, r.created_at]
      );
    }
    summary.project_events = eventRows.length;

    // 11. operational_blockers
    const blockerRows = sqliteDb.prepare('SELECT * FROM operational_blockers').all() as Array<{
      id: string;
      project_id: string;
      activity_id: string | null;
      root_cause_category: string;
      description: string;
      severity: string;
      status: string;
      reported_by: string;
      reported_at: string;
      resolved_at: string | null;
      resolution_notes: string | null;
      created_at: string;
      updated_at: string;
    }>;
    for (const r of blockerRows) {
      await client.query(
        `INSERT INTO operational_blockers (id, project_id, activity_id, root_cause_category, description, severity, status, reported_by, reported_at, resolved_at, resolution_notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET
           root_cause_category = EXCLUDED.root_cause_category, description = EXCLUDED.description,
           severity = EXCLUDED.severity, status = EXCLUDED.status, resolved_at = EXCLUDED.resolved_at,
           resolution_notes = EXCLUDED.resolution_notes, updated_at = EXCLUDED.updated_at`,
        [r.id, r.project_id, r.activity_id, r.root_cause_category, r.description, r.severity, r.status, r.reported_by, r.reported_at, r.resolved_at, r.resolution_notes, r.created_at, r.updated_at]
      );
    }
    summary.operational_blockers = blockerRows.length;

    // 12. notification_outbox
    const notifRows = sqliteDb.prepare('SELECT * FROM notification_outbox').all() as Array<{
      id: string;
      project_id: string;
      event_type: string;
      channel: string;
      recipient: string;
      subject: string;
      payload_json: string;
      status: string;
      anomaly_confidence: number | null;
      explanation: string | null;
      delivery_status: string | null;
      error_message: string | null;
      retry_count: number;
      next_retry_at: string | null;
      locked_at: string | null;
      locked_by: string | null;
      created_at: string;
      updated_at: string;
    }>;
    for (const r of notifRows) {
      await client.query(
        `INSERT INTO notification_outbox (id, project_id, event_type, channel, recipient, subject, payload_json, status, anomaly_confidence, explanation, delivery_status, error_message, retry_count, next_retry_at, locked_at, locked_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status, delivery_status = EXCLUDED.delivery_status,
           error_message = EXCLUDED.error_message, retry_count = EXCLUDED.retry_count,
           next_retry_at = EXCLUDED.next_retry_at, locked_at = EXCLUDED.locked_at,
           locked_by = EXCLUDED.locked_by, updated_at = EXCLUDED.updated_at`,
        [r.id, r.project_id, r.event_type, r.channel, r.recipient, r.subject, r.payload_json, r.status, r.anomaly_confidence, r.explanation, r.delivery_status, r.error_message, r.retry_count, r.next_retry_at, r.locked_at, r.locked_by, r.created_at, r.updated_at]
      );
    }
    summary.notification_outbox = notifRows.length;

    // 13. processing_jobs
    const jobRows = sqliteDb.prepare('SELECT * FROM processing_jobs').all() as Array<{
      id: string;
      project_id: string;
      job_type: string;
      status: string;
      priority: number;
      payload: string;
      result: string | null;
      error_message: string | null;
      attempts: number;
      max_attempts: number;
      locked_at: string | null;
      locked_by: string | null;
      created_at: string;
      updated_at: string;
      completed_at: string | null;
    }>;
    for (const r of jobRows) {
      await client.query(
        `INSERT INTO processing_jobs (id, project_id, job_type, status, priority, payload, result, error_message, attempts, max_attempts, locked_at, locked_by, created_at, updated_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status, result = EXCLUDED.result, error_message = EXCLUDED.error_message,
           attempts = EXCLUDED.attempts, locked_at = EXCLUDED.locked_at, locked_by = EXCLUDED.locked_by,
           updated_at = EXCLUDED.updated_at, completed_at = EXCLUDED.completed_at`,
        [r.id, r.project_id, r.job_type, r.status, r.priority, r.payload, r.result, r.error_message, r.attempts, r.max_attempts, r.locked_at, r.locked_by, r.created_at, r.updated_at, r.completed_at]
      );
    }
    summary.processing_jobs = jobRows.length;
  });

  closeDatabase();
  await closePostgres();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n====================================================');
  console.log(`🎉 SQLite to PostgreSQL Import Complete in ${elapsed}s!`);
  console.log('====================================================');
  for (const [table, count] of Object.entries(summary)) {
    console.log(`   - ${table.padEnd(25)}: ${count} rows`);
  }
  console.log('====================================================');
}

importSQLiteToPostgres().catch(async (err) => {
  console.error('❌ Import failed:', err);
  closeDatabase();
  await closePostgres();
  process.exit(1);
});
