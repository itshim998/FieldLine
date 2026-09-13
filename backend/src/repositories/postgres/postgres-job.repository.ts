import type pg from 'pg';
import crypto from 'node:crypto';
import { getPostgresPool, runInPostgresTransaction } from '../../database/postgres.js';
import {
  ProcessingJob,
  CreateProcessingJobInput,
  ProcessingJobType,
  ProcessingJobStatus,
  CreateProjectEventInput,
  DocumentIngestionJobPayload,
  DocumentIngestionJobResult
} from '../../models/domain.types.js';
import { ConflictError, DatabaseError } from '../../errors/AppError.js';
import type { JobRepository } from '../../jobs/job.repository.js';

interface ProcessingJobDbRow {
  id: string;
  project_id: string;
  job_type: string;
  status: string;
  payload_json: string | Record<string, unknown>;
  result_json: string | Record<string, unknown> | null;
  error_message: string | null;
  attempt_count: number;
  locked_at: string | Date | null;
  created_at: string | Date;
  started_at: string | Date | null;
  completed_at: string | Date | null;
  updated_at: string | Date;
}

function toIsoString(val: string | Date | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  return new Date(val).toISOString();
}

function mapRowToProcessingJob(row: ProcessingJobDbRow): ProcessingJob {
  let parsedPayload: Record<string, unknown> | DocumentIngestionJobPayload = {};
  if (typeof row.payload_json === 'string') {
    try {
      parsedPayload = JSON.parse(row.payload_json);
    } catch {
      parsedPayload = {};
    }
  } else if (row.payload_json && typeof row.payload_json === 'object') {
    parsedPayload = row.payload_json as Record<string, unknown>;
  }

  let parsedResult: Record<string, unknown> | DocumentIngestionJobResult | null = null;
  if (typeof row.result_json === 'string') {
    try {
      parsedResult = JSON.parse(row.result_json);
    } catch {
      parsedResult = null;
    }
  } else if (row.result_json && typeof row.result_json === 'object') {
    parsedResult = row.result_json as Record<string, unknown>;
  }

  return {
    id: row.id,
    projectId: row.project_id,
    jobType: row.job_type as ProcessingJobType,
    status: row.status as ProcessingJobStatus,
    payload: parsedPayload,
    result: parsedResult,
    errorMessage: row.error_message,
    attemptCount: Number(row.attempt_count),
    lockedAt: toIsoString(row.locked_at),
    createdAt: toIsoString(row.created_at) || new Date().toISOString(),
    startedAt: toIsoString(row.started_at),
    completedAt: toIsoString(row.completed_at),
    updatedAt: toIsoString(row.updated_at) || new Date().toISOString()
  };
}

export class PostgresJobRepository implements JobRepository {
  private poolProvider: () => pg.Pool;

  constructor(poolProvider?: () => pg.Pool) {
    this.poolProvider = poolProvider || getPostgresPool;
  }

  private getPool(): pg.Pool {
    return this.poolProvider();
  }

  async create(input: CreateProcessingJobInput): Promise<ProcessingJob> {
    const id = input.id || crypto.randomUUID();
    const payloadJson = JSON.stringify(input.payload || {});

    try {
      const res = await this.getPool().query<ProcessingJobDbRow>(
        `INSERT INTO processing_jobs (
          id, project_id, job_type, status, payload_json, attempt_count
        ) VALUES ($1, $2, $3, 'queued', $4, 0)
        RETURNING *`,
        [id, input.projectId, input.jobType, payloadJson]
      );
      return mapRowToProcessingJob(res.rows[0]);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        throw new ConflictError(`Processing job with ID '${id}' already exists`);
      }
      throw new DatabaseError(`Failed to create processing job: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async createWithEvent(
    jobInput: CreateProcessingJobInput,
    eventInput: CreateProjectEventInput
  ): Promise<ProcessingJob> {
    const id = jobInput.id || crypto.randomUUID();
    const eventId = eventInput.id || crypto.randomUUID();
    const payloadJson = JSON.stringify(jobInput.payload || {});

    return runInPostgresTransaction(async (client) => {
      try {
        const jobRes = await client.query<ProcessingJobDbRow>(
          `INSERT INTO processing_jobs (
            id, project_id, job_type, status, payload_json, attempt_count
          ) VALUES ($1, $2, $3, 'queued', $4, 0)
          RETURNING *`,
          [id, jobInput.projectId, jobInput.jobType, payloadJson]
        );

        await client.query(
          `INSERT INTO project_events (
            id, project_id, event_type, entity_type, entity_id, summary, payload_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            eventId,
            eventInput.projectId,
            eventInput.eventType,
            eventInput.entityType ?? 'processing_job',
            id,
            eventInput.summary,
            eventInput.payloadJson ?? null
          ]
        );

        return mapRowToProcessingJob(jobRes.rows[0]);
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
          throw new ConflictError(`Processing job with ID '${id}' already exists`);
        }
        throw new DatabaseError(`Failed to create processing job with event: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }

  async getById(id: string): Promise<ProcessingJob | null> {
    const res = await this.getPool().query<ProcessingJobDbRow>(
      `SELECT * FROM processing_jobs WHERE id = $1`,
      [id]
    );
    return res.rows[0] ? mapRowToProcessingJob(res.rows[0]) : null;
  }

  async getByIdAndProjectId(id: string, projectId: string): Promise<ProcessingJob | null> {
    const res = await this.getPool().query<ProcessingJobDbRow>(
      `SELECT * FROM processing_jobs WHERE id = $1 AND project_id = $2`,
      [id, projectId]
    );
    return res.rows[0] ? mapRowToProcessingJob(res.rows[0]) : null;
  }

  async listByProjectId(projectId: string, jobType?: ProcessingJobType): Promise<ProcessingJob[]> {
    let res: pg.QueryResult<ProcessingJobDbRow>;
    if (jobType) {
      res = await this.getPool().query<ProcessingJobDbRow>(
        `SELECT * FROM processing_jobs
         WHERE project_id = $1 AND job_type = $2
         ORDER BY created_at DESC`,
        [projectId, jobType]
      );
    } else {
      res = await this.getPool().query<ProcessingJobDbRow>(
        `SELECT * FROM processing_jobs
         WHERE project_id = $1
         ORDER BY created_at DESC`,
        [projectId]
      );
    }
    return res.rows.map(mapRowToProcessingJob);
  }

  async findExistingActiveDocumentIngestionJob(projectId: string, evidenceId: string): Promise<ProcessingJob | null> {
    const res = await this.getPool().query<ProcessingJobDbRow>(
      `SELECT * FROM processing_jobs
       WHERE project_id = $1
         AND job_type = 'document_ingestion'
         AND status IN ('queued', 'processing')
       ORDER BY created_at DESC`,
      [projectId]
    );

    for (const row of res.rows) {
      try {
        const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
        if (payload && payload.evidenceId === evidenceId) {
          return mapRowToProcessingJob(row);
        }
      } catch {
        // Skip malformed payload
      }
    }
    return null;
  }

  async findLatestCompletedDocumentIngestionJob(projectId: string, evidenceId: string): Promise<ProcessingJob | null> {
    const res = await this.getPool().query<ProcessingJobDbRow>(
      `SELECT * FROM processing_jobs
       WHERE project_id = $1
         AND job_type = 'document_ingestion'
         AND status = 'completed'
       ORDER BY completed_at DESC, created_at DESC`,
      [projectId]
    );

    for (const row of res.rows) {
      try {
        const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
        if (payload && payload.evidenceId === evidenceId) {
          return mapRowToProcessingJob(row);
        }
      } catch {
        // Skip malformed payload
      }
    }
    return null;
  }

  async findOrCreateDocumentIngestionJob(
    projectId: string,
    evidenceId: string,
    eventSummary: string,
    eventPayloadJson: string
  ): Promise<{ job: ProcessingJob; isNew: boolean }> {
    return runInPostgresTransaction(async (client) => {
      // 1. Check for completed job first (idempotent completed reuse)
      const completedRes = await client.query<ProcessingJobDbRow>(
        `SELECT * FROM processing_jobs
         WHERE project_id = $1
           AND job_type = 'document_ingestion'
           AND status = 'completed'
         ORDER BY completed_at DESC, created_at DESC`,
        [projectId]
      );
      for (const row of completedRes.rows) {
        try {
          const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
          if (payload && payload.evidenceId === evidenceId) {
            return { job: mapRowToProcessingJob(row), isNew: false };
          }
        } catch {
          // ignore
        }
      }

      // 2. Check for active (queued or processing) job
      const activeRes = await client.query<ProcessingJobDbRow>(
        `SELECT * FROM processing_jobs
         WHERE project_id = $1
           AND job_type = 'document_ingestion'
           AND status IN ('queued', 'processing')
         ORDER BY created_at DESC`,
        [projectId]
      );
      for (const row of activeRes.rows) {
        try {
          const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
          if (payload && payload.evidenceId === evidenceId) {
            return { job: mapRowToProcessingJob(row), isNew: false };
          }
        } catch {
          // ignore
        }
      }

      // 3. Check if evidence ALREADY produced durable project state (e.g. post-commit job-status failure recovery)
      const evRes = await client.query<{ progress_update_id: string | null; file_type: string }>(
        `SELECT progress_update_id, file_type FROM evidence WHERE id = $1 AND project_id = $2`,
        [evidenceId, projectId]
      );
      const evRow = evRes.rows[0];
      if (evRow?.progress_update_id) {
        const puRes = await client.query<{ id: string }>(
          `SELECT id FROM progress_updates WHERE id = $1 AND project_id = $2`,
          [evRow.progress_update_id, projectId]
        );
        const puRow = puRes.rows[0];
        if (puRow) {
          const matchCountRes = await client.query<{ c: string | number }>(
            `SELECT count(*) as c FROM activity_matches WHERE progress_update_id = $1 AND project_id = $2`,
            [puRow.id, projectId]
          );
          const matchCount = Number(matchCountRes.rows[0]?.c ?? 0);
          const boundedResult = {
            evidenceId,
            progressUpdateId: puRow.id,
            matchCount,
            sourceType: evRow.file_type
          };

          const repairRes = await client.query<ProcessingJobDbRow>(
            `SELECT id FROM processing_jobs
             WHERE project_id = $1 AND job_type = 'document_ingestion' AND payload_json::text LIKE $2
             ORDER BY created_at DESC LIMIT 1`,
            [projectId, `%"evidenceId":"${evidenceId}"%`]
          );
          const existingAnyJob = repairRes.rows[0];
          if (existingAnyJob) {
            const now = new Date().toISOString();
            const updatedRes = await client.query<ProcessingJobDbRow>(
              `UPDATE processing_jobs
               SET status = 'completed',
                   result_json = $1,
                   completed_at = $2,
                   locked_at = NULL,
                   error_message = NULL,
                   updated_at = $3
               WHERE id = $4
               RETURNING *`,
              [JSON.stringify(boundedResult), now, now, existingAnyJob.id]
            );
            if (updatedRes.rows[0]) {
              return { job: mapRowToProcessingJob(updatedRes.rows[0]), isNew: false };
            }
          }
        }
      }

      // 4. Create new queued job with event
      const jobId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const payloadJson = JSON.stringify({ evidenceId });

      const jobInsertRes = await client.query<ProcessingJobDbRow>(
        `INSERT INTO processing_jobs (
          id, project_id, job_type, status, payload_json, attempt_count
        ) VALUES ($1, $2, 'document_ingestion', 'queued', $3, 0)
        RETURNING *`,
        [jobId, projectId, payloadJson]
      );

      await client.query(
        `INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json
        ) VALUES ($1, $2, 'processing_job_queued', 'processing_job', $3, $4, $5)`,
        [eventId, projectId, jobId, eventSummary, eventPayloadJson]
      );

      return { job: mapRowToProcessingJob(jobInsertRes.rows[0]), isNew: true };
    });
  }

  async claimNextQueued(): Promise<ProcessingJob | null> {
    return runInPostgresTransaction(async (client) => {
      // Concurrency-safe claiming with FOR UPDATE SKIP LOCKED
      const selectRes = await client.query<ProcessingJobDbRow>(
        `SELECT * FROM processing_jobs
         WHERE status = 'queued'
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`
      );

      const row = selectRes.rows[0];
      if (!row) {
        return null;
      }

      const now = new Date().toISOString();
      const updateRes = await client.query<ProcessingJobDbRow>(
        `UPDATE processing_jobs
         SET status = 'processing',
             started_at = $1,
             locked_at = $2,
             attempt_count = attempt_count + 1,
             updated_at = $3
         WHERE id = $4
         RETURNING *`,
        [now, now, now, row.id]
      );

      const updatedJob = updateRes.rows[0];

      // Record processing_job_started event
      await client.query(
        `INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          crypto.randomUUID(),
          row.project_id,
          'processing_job_started',
          'processing_job',
          row.id,
          `Document ingestion job ${row.id.slice(0, 8)} claimed and started`,
          JSON.stringify({
            jobId: row.id,
            jobType: row.job_type,
            attemptCount: Number(row.attempt_count) + 1
          })
        ]
      );

      return mapRowToProcessingJob(updatedJob);
    });
  }

  async markCompleted(
    id: string,
    result: Record<string, unknown> | DocumentIngestionJobResult
  ): Promise<ProcessingJob | null> {
    const now = new Date().toISOString();
    const resultJson = JSON.stringify(result);

    return runInPostgresTransaction(async (client) => {
      const lockRes = await client.query<ProcessingJobDbRow>(
        `SELECT * FROM processing_jobs WHERE id = $1 FOR UPDATE`,
        [id]
      );
      const existing = lockRes.rows[0];
      if (!existing) {
        return null;
      }

      const updateRes = await client.query<ProcessingJobDbRow>(
        `UPDATE processing_jobs
         SET status = 'completed',
             result_json = $1,
             completed_at = $2,
             locked_at = NULL,
             updated_at = $3
         WHERE id = $4
         RETURNING *`,
        [resultJson, now, now, id]
      );

      await client.query(
        `INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
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
        ]
      );

      return mapRowToProcessingJob(updateRes.rows[0]);
    });
  }

  async markFailed(id: string, errorMessage: string): Promise<ProcessingJob | null> {
    const now = new Date().toISOString();

    return runInPostgresTransaction(async (client) => {
      const lockRes = await client.query<ProcessingJobDbRow>(
        `SELECT * FROM processing_jobs WHERE id = $1 FOR UPDATE`,
        [id]
      );
      const existing = lockRes.rows[0];
      if (!existing) {
        return null;
      }

      const updateRes = await client.query<ProcessingJobDbRow>(
        `UPDATE processing_jobs
         SET status = 'failed',
             error_message = $1,
             completed_at = $2,
             locked_at = NULL,
             updated_at = $3
         WHERE id = $4
         RETURNING *`,
        [errorMessage, now, now, id]
      );

      await client.query(
        `INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
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
        ]
      );

      return mapRowToProcessingJob(updateRes.rows[0]);
    });
  }

  async requeueStaleProcessingJobs(leaseTimeoutMs: number = 5 * 60 * 1000): Promise<number> {
    const cutoffTime = new Date(Date.now() - leaseTimeoutMs).toISOString();
    const now = new Date().toISOString();

    const res = await this.getPool().query(
      `UPDATE processing_jobs
       SET status = 'queued',
           locked_at = NULL,
           updated_at = $1
       WHERE status = 'processing'
         AND (locked_at IS NULL OR locked_at < $2)`,
      [now, cutoffTime]
    );

    return res.rowCount ?? 0;
  }
}

export const postgresJobRepository: PostgresJobRepository = new PostgresJobRepository();
