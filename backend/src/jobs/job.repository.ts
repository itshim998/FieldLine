import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { getDatabase } from '../database/db.js';
import {
  ProcessingJob,
  CreateProcessingJobInput,
  ProcessingJobType,
  ProcessingJobStatus,
  CreateProjectEventInput,
  DocumentIngestionJobPayload,
  DocumentIngestionJobResult
} from '../models/domain.types.js';
import { ConflictError, DatabaseError } from '../errors/AppError.js';

export interface JobRepository {
  create(input: CreateProcessingJobInput): ProcessingJob;
  createWithEvent(
    jobInput: CreateProcessingJobInput,
    eventInput: CreateProjectEventInput
  ): ProcessingJob;
  getById(id: string): ProcessingJob | null;
  getByIdAndProjectId(id: string, projectId: string): ProcessingJob | null;
  listByProjectId(projectId: string, jobType?: ProcessingJobType): ProcessingJob[];
  findExistingActiveDocumentIngestionJob(projectId: string, evidenceId: string): ProcessingJob | null;
  claimNextQueued(): ProcessingJob | null;
  markCompleted(id: string, result: Record<string, unknown> | DocumentIngestionJobResult): ProcessingJob | null;
  markFailed(id: string, errorMessage: string): ProcessingJob | null;
  requeueStaleProcessingJobs(leaseTimeoutMs?: number): number;
}

interface ProcessingJobDbRow {
  id: string;
  project_id: string;
  job_type: string;
  status: string;
  payload_json: string;
  result_json: string | null;
  error_message: string | null;
  attempt_count: number;
  locked_at: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

function mapRowToProcessingJob(row: ProcessingJobDbRow): ProcessingJob {
  let parsedPayload: Record<string, unknown> | DocumentIngestionJobPayload = {};
  try {
    parsedPayload = JSON.parse(row.payload_json);
  } catch {
    parsedPayload = {};
  }

  let parsedResult: Record<string, unknown> | DocumentIngestionJobResult | null = null;
  if (row.result_json) {
    try {
      parsedResult = JSON.parse(row.result_json);
    } catch {
      parsedResult = null;
    }
  }

  return {
    id: row.id,
    projectId: row.project_id,
    jobType: row.job_type as ProcessingJobType,
    status: row.status as ProcessingJobStatus,
    payload: parsedPayload,
    result: parsedResult,
    errorMessage: row.error_message,
    attemptCount: row.attempt_count,
    lockedAt: row.locked_at,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  };
}

export class SqliteJobRepository implements JobRepository {
  private getDb: () => DatabaseType;

  constructor(dbProvider?: () => DatabaseType) {
    this.getDb = dbProvider || getDatabase;
  }

  create(input: CreateProcessingJobInput): ProcessingJob {
    const db = this.getDb();
    const id = input.id || crypto.randomUUID();
    const payloadJson = JSON.stringify(input.payload || {});

    const stmt = db.prepare(`
      INSERT INTO processing_jobs (
        id, project_id, job_type, status, payload_json, attempt_count
      ) VALUES (
        ?, ?, ?, 'queued', ?, 0
      )
    `);

    try {
      stmt.run(id, input.projectId, input.jobType, payloadJson);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw new ConflictError(`Processing job with ID '${id}' already exists`);
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new ConflictError(`Processing job with ID '${id}' already exists in this project`);
      }
      throw new DatabaseError(`Failed to create processing job: ${err instanceof Error ? err.message : String(err)}`);
    }

    const created = this.getByIdAndProjectId(id, input.projectId);
    if (!created) {
      throw new DatabaseError('Failed to retrieve newly created processing job');
    }
    return created;
  }

  createWithEvent(
    jobInput: CreateProcessingJobInput,
    eventInput: CreateProjectEventInput
  ): ProcessingJob {
    const db = this.getDb();
    const id = jobInput.id || crypto.randomUUID();
    const eventId = eventInput.id || crypto.randomUUID();
    const payloadJson = JSON.stringify(jobInput.payload || {});

    const insertJobStmt = db.prepare(`
      INSERT INTO processing_jobs (
        id, project_id, job_type, status, payload_json, attempt_count
      ) VALUES (
        ?, ?, ?, 'queued', ?, 0
      )
    `);

    const insertEventStmt = db.prepare(`
      INSERT INTO project_events (
        id, project_id, event_type, entity_type, entity_id, summary, payload_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const runTransaction = db.transaction(() => {
      insertJobStmt.run(id, jobInput.projectId, jobInput.jobType, payloadJson);

      insertEventStmt.run(
        eventId,
        eventInput.projectId,
        eventInput.eventType,
        eventInput.entityType ?? 'processing_job',
        id,
        eventInput.summary,
        eventInput.payloadJson ?? null
      );
    });

    try {
      runTransaction();
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw new ConflictError(`Processing job with ID '${id}' already exists`);
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new ConflictError(`Processing job with ID '${id}' already exists in this project`);
      }
      throw new DatabaseError(`Failed to create processing job with event: ${err instanceof Error ? err.message : String(err)}`);
    }

    const created = this.getByIdAndProjectId(id, jobInput.projectId);
    if (!created) {
      throw new DatabaseError('Failed to retrieve newly created processing job');
    }
    return created;
  }

  getById(id: string): ProcessingJob | null {
    const db = this.getDb();
    const row = db.prepare('SELECT * FROM processing_jobs WHERE id = ?').get(id) as ProcessingJobDbRow | undefined;
    return row ? mapRowToProcessingJob(row) : null;
  }

  getByIdAndProjectId(id: string, projectId: string): ProcessingJob | null {
    const db = this.getDb();
    const row = db.prepare(
      'SELECT * FROM processing_jobs WHERE id = ? AND project_id = ?'
    ).get(id, projectId) as ProcessingJobDbRow | undefined;
    return row ? mapRowToProcessingJob(row) : null;
  }

  listByProjectId(projectId: string, jobType?: ProcessingJobType): ProcessingJob[] {
    const db = this.getDb();
    let rows: ProcessingJobDbRow[];
    if (jobType) {
      rows = db.prepare(`
        SELECT * FROM processing_jobs
        WHERE project_id = ? AND job_type = ?
        ORDER BY created_at DESC
      `).all(projectId, jobType) as ProcessingJobDbRow[];
    } else {
      rows = db.prepare(`
        SELECT * FROM processing_jobs
        WHERE project_id = ?
        ORDER BY created_at DESC
      `).all(projectId) as ProcessingJobDbRow[];
    }
    return rows.map(mapRowToProcessingJob);
  }

  findExistingActiveDocumentIngestionJob(projectId: string, evidenceId: string): ProcessingJob | null {
    const db = this.getDb();
    const rows = db.prepare(`
      SELECT * FROM processing_jobs
      WHERE project_id = ?
        AND job_type = 'document_ingestion'
        AND status IN ('queued', 'processing')
      ORDER BY created_at DESC
    `).all(projectId) as ProcessingJobDbRow[];

    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload_json);
        if (payload && payload.evidenceId === evidenceId) {
          return mapRowToProcessingJob(row);
        }
      } catch {
        // Skip malformed payload
      }
    }
    return null;
  }

  claimNextQueued(): ProcessingJob | null {
    const db = this.getDb();

    return db.transaction(() => {
      const row = db.prepare(`
        SELECT * FROM processing_jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC, rowid ASC
        LIMIT 1
      `).get() as ProcessingJobDbRow | undefined;

      if (!row) {
        return null;
      }

      const now = new Date().toISOString();
      const updateStmt = db.prepare(`
        UPDATE processing_jobs
        SET status = 'processing',
            started_at = ?,
            locked_at = ?,
            attempt_count = attempt_count + 1,
            updated_at = ?
        WHERE id = ? AND status = 'queued'
      `);

      const res = updateStmt.run(now, now, now, row.id);
      if (res.changes === 0) {
        return null;
      }

      // Record processing_job_started event
      const insertEventStmt = db.prepare(`
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?
        )
      `);
      insertEventStmt.run(
        crypto.randomUUID(),
        row.project_id,
        'processing_job_started',
        'processing_job',
        row.id,
        `Document ingestion job ${row.id.slice(0, 8)} claimed and started`,
        JSON.stringify({
          jobId: row.id,
          jobType: row.job_type,
          attemptCount: row.attempt_count + 1
        })
      );

      const updatedRow = db.prepare('SELECT * FROM processing_jobs WHERE id = ?').get(row.id) as ProcessingJobDbRow;
      return mapRowToProcessingJob(updatedRow);
    })();
  }

  markCompleted(id: string, result: Record<string, unknown> | DocumentIngestionJobResult): ProcessingJob | null {
    const db = this.getDb();
    const now = new Date().toISOString();
    const resultJson = JSON.stringify(result);

    return db.transaction(() => {
      const existing = db.prepare('SELECT * FROM processing_jobs WHERE id = ?').get(id) as ProcessingJobDbRow | undefined;
      if (!existing) {
        return null;
      }

      const updateStmt = db.prepare(`
        UPDATE processing_jobs
        SET status = 'completed',
            result_json = ?,
            completed_at = ?,
            locked_at = NULL,
            updated_at = ?
        WHERE id = ?
      `);

      updateStmt.run(resultJson, now, now, id);

      // Record processing_job_completed event
      const insertEventStmt = db.prepare(`
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?
        )
      `);
      insertEventStmt.run(
        crypto.randomUUID(),
        existing.project_id,
        'processing_job_completed',
        'processing_job',
        id,
        `Document ingestion job ${id.slice(0, 8)} completed successfully`,
        JSON.stringify({
          jobId: id,
          jobType: existing.job_type,
          evidenceId: (result as DocumentIngestionJobResult).evidenceId,
          progressUpdateId: (result as DocumentIngestionJobResult).progressUpdateId,
          matchCount: (result as DocumentIngestionJobResult).matchCount
        })
      );

      const updatedRow = db.prepare('SELECT * FROM processing_jobs WHERE id = ?').get(id) as ProcessingJobDbRow;
      return mapRowToProcessingJob(updatedRow);
    })();
  }

  markFailed(id: string, errorMessage: string): ProcessingJob | null {
    const db = this.getDb();
    const now = new Date().toISOString();

    return db.transaction(() => {
      const existing = db.prepare('SELECT * FROM processing_jobs WHERE id = ?').get(id) as ProcessingJobDbRow | undefined;
      if (!existing) {
        return null;
      }

      const updateStmt = db.prepare(`
        UPDATE processing_jobs
        SET status = 'failed',
            error_message = ?,
            completed_at = ?,
            locked_at = NULL,
            updated_at = ?
        WHERE id = ?
      `);

      updateStmt.run(errorMessage, now, now, id);

      // Record processing_job_failed event
      const insertEventStmt = db.prepare(`
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?
        )
      `);
      insertEventStmt.run(
        crypto.randomUUID(),
        existing.project_id,
        'processing_job_failed',
        'processing_job',
        id,
        `Document ingestion job ${id.slice(0, 8)} failed: ${errorMessage.slice(0, 100)}`,
        JSON.stringify({
          jobId: id,
          jobType: existing.job_type,
          error: errorMessage
        })
      );

      const updatedRow = db.prepare('SELECT * FROM processing_jobs WHERE id = ?').get(id) as ProcessingJobDbRow;
      return mapRowToProcessingJob(updatedRow);
    })();
  }

  requeueStaleProcessingJobs(leaseTimeoutMs: number = 5 * 60 * 1000): number {
    const db = this.getDb();
    const cutoffTime = new Date(Date.now() - leaseTimeoutMs).toISOString();
    const now = new Date().toISOString();

    const updateStmt = db.prepare(`
      UPDATE processing_jobs
      SET status = 'queued',
          locked_at = NULL,
          updated_at = ?
      WHERE status = 'processing'
        AND (locked_at IS NULL OR locked_at < ?)
    `);

    const res = updateStmt.run(now, cutoffTime);
    return res.changes;
  }
}

export const jobRepository: JobRepository = new SqliteJobRepository();
