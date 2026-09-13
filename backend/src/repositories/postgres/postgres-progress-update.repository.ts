import type { Pool, PoolClient } from 'pg';
import crypto from 'node:crypto';
import { getPostgresPool } from '../../database/postgres.js';
import {
  ProgressUpdate,
  CreateProgressUpdateInput,
  CreateActivityMatchInput,
  ActivityMatch
} from '../../models/domain.types.js';
import { AppError, ConflictError, DatabaseError, NotFoundError } from '../../errors/AppError.js';
import type {
  ProgressUpdateRepository,
  DocumentProcessingTxInput,
  DocumentProcessingTxResult
} from '../progress-update.repository.js';

interface ProgressUpdateDbRow {
  id: string;
  project_id: string;
  report_date: string;
  reporter_name: string | null;
  reporter_role: string | null;
  source_type: string;
  raw_text: string;
  status: string;
  created_at: string | Date;
  updated_at: string | Date;
}

function mapRowToProgressUpdate(row: ProgressUpdateDbRow): ProgressUpdate {
  return {
    id: row.id,
    projectId: row.project_id,
    reportDate: row.report_date,
    reporterName: row.reporter_name,
    reporterRole: row.reporter_role,
    sourceType: row.source_type as ProgressUpdate['sourceType'],
    rawText: row.raw_text,
    status: row.status as ProgressUpdate['status'],
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : row.updated_at.toISOString()
  };
}

export class PostgresProgressUpdateRepository implements ProgressUpdateRepository {
  private getPool: () => Pool;

  constructor(poolProvider?: () => Pool) {
    this.getPool = poolProvider || getPostgresPool;
  }

  async create(input: CreateProgressUpdateInput, client?: PoolClient): Promise<ProgressUpdate> {
    const pool = this.getPool();
    const conn = client || (await pool.connect());
    const shouldRelease = !client;

    const id = input.id || crypto.randomUUID();
    const sourceType = input.sourceType || 'manual';
    const status = input.status || 'received';
    const nowIso = new Date().toISOString();

    try {
      if (shouldRelease) {
        await conn.query('BEGIN');
      }

      const insertUpdateSql = `
        INSERT INTO progress_updates (
          id, project_id, report_date, reporter_name, reporter_role, source_type, raw_text, status, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        ) RETURNING *
      `;

      const updateRes = await conn.query(insertUpdateSql, [
        id,
        input.projectId,
        input.reportDate,
        input.reporterName ?? null,
        input.reporterRole ?? null,
        sourceType,
        input.rawText,
        status,
        nowIso,
        nowIso
      ]);

      const eventId = crypto.randomUUID();
      const insertEventSql = `
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7
        )
      `;

      await conn.query(insertEventSql, [
        eventId,
        input.projectId,
        'progress_reported',
        'progress_updates',
        id,
        'Manual progress report received',
        JSON.stringify({
          updateId: id,
          reportDate: input.reportDate,
          reporterName: input.reporterName ?? null,
          reporterRole: input.reporterRole ?? null,
          sourceType
        })
      ]);

      if (shouldRelease) {
        await conn.query('COMMIT');
      }

      return mapRowToProgressUpdate(updateRes.rows[0]);
    } catch (err: unknown) {
      if (shouldRelease) {
        try {
          await conn.query('ROLLBACK');
        } catch {}
      }
      if (err instanceof Error && 'code' in err) {
        const code = (err as { code: string }).code;
        if (code === '23503') {
          throw new NotFoundError(`Project with ID '${input.projectId}' not found`);
        }
        if (code === '23505') {
          throw new ConflictError(`Progress update with ID '${id}' already exists`);
        }
      }
      if (err instanceof AppError) {
        throw err;
      }
      throw new DatabaseError(`Failed to create progress update: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (shouldRelease) {
        conn.release();
      }
    }
  }

  async commitDocumentIngestionTransaction(
    input: DocumentProcessingTxInput
  ): Promise<DocumentProcessingTxResult> {
    const pool = this.getPool();
    const client = await pool.connect();

    const puId = input.progressUpdate.id || crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const sourceType = input.progressUpdate.sourceType || 'manual';
    const status = input.progressUpdate.status || 'received';

    try {
      await client.query('BEGIN');

      // 1. Insert progress update
      const insertUpdateSql = `
        INSERT INTO progress_updates (
          id, project_id, report_date, reporter_name, reporter_role, source_type, raw_text, status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        ) RETURNING *
      `;

      const updateRes = await client.query(insertUpdateSql, [
        puId,
        input.progressUpdate.projectId,
        input.progressUpdate.reportDate,
        input.progressUpdate.reporterName ?? null,
        input.progressUpdate.reporterRole ?? null,
        sourceType,
        input.progressUpdate.rawText,
        status
      ]);

      // 2. Insert event
      const insertEventSql = `
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7
        )
      `;

      await client.query(insertEventSql, [
        eventId,
        input.progressUpdate.projectId,
        'progress_reported',
        'progress_updates',
        puId,
        `Document ingestion report created for evidence '${input.evidenceId}'`,
        JSON.stringify({
          updateId: puId,
          reportDate: input.progressUpdate.reportDate,
          sourceType,
          evidenceId: input.evidenceId
        })
      ]);

      // 3. Attach evidence
      const attachRes = await client.query(
        `
        UPDATE evidence
        SET progress_update_id = $1
        WHERE id = $2 AND project_id = $3
      `,
        [puId, input.evidenceId, input.progressUpdate.projectId]
      );

      if ((attachRes.rowCount ?? 0) === 0) {
        throw new DatabaseError(`Evidence '${input.evidenceId}' could not be linked to report '${puId}'`);
      }

      // 4. Delete existing suggestions and insert suggested matches
      await client.query(
        `
        DELETE FROM activity_matches
        WHERE progress_update_id = $1 AND project_id = $2 AND status = 'suggested'
      `,
        [puId, input.progressUpdate.projectId]
      );

      const insertedMatches: ActivityMatch[] = [];
      const insertMatchSql = `
        INSERT INTO activity_matches (
          id, project_id, progress_update_id, evidence_id, activity_id,
          confidence_score, match_method, matched_text, rationale, status,
          confidence_tier, review_state, reviewed_by, reviewed_at,
          ml_confidence, anomaly_score, anomaly_severity, anomaly_reasons_json
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        ) RETURNING *
      `;

      for (const m of input.suggestedMatches) {
        const mId = m.id || crypto.randomUUID();
        const matchRes = await client.query(insertMatchSql, [
          mId,
          input.progressUpdate.projectId,
          puId,
          input.evidenceId,
          m.activityId,
          m.confidenceScore,
          m.matchMethod,
          m.matchedText ?? null,
          m.rationale ?? null,
          m.status || 'suggested',
          m.confidenceTier ?? null,
          m.reviewState ?? null,
          m.reviewedBy ?? null,
          m.reviewedAt ?? null,
          m.mlConfidence ?? null,
          m.anomalyScore ?? null,
          m.anomalySeverity ?? null,
          m.anomalyReasonsJson ?? null
        ]);

        const r = matchRes.rows[0];
        let anomalyReasons: string[] | null = null;
        if (r.anomaly_reasons_json) {
          try {
            const parsed = JSON.parse(r.anomaly_reasons_json);
            if (Array.isArray(parsed)) anomalyReasons = parsed;
          } catch {
            anomalyReasons = null;
          }
        }

        insertedMatches.push({
          id: r.id,
          projectId: r.project_id,
          progressUpdateId: r.progress_update_id,
          evidenceId: r.evidence_id,
          activityId: r.activity_id,
          confidenceScore: Number(r.confidence_score),
          matchMethod: r.match_method,
          matchedText: r.matched_text,
          rationale: r.rationale,
          status: r.status,
          confidenceTier: r.confidence_tier || null,
          reviewState: r.review_state || null,
          reviewedBy: r.reviewed_by,
          reviewedAt: r.reviewed_at,
          mlConfidence: r.ml_confidence !== null ? Number(r.ml_confidence) : null,
          anomalyScore: r.anomaly_score !== null ? Number(r.anomaly_score) : null,
          anomalySeverity: r.anomaly_severity || null,
          anomalyReasonsJson: r.anomaly_reasons_json || null,
          anomalyReasons,
          createdAt: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
          updatedAt: typeof r.updated_at === 'string' ? r.updated_at : r.updated_at.toISOString()
        });
      }

      await client.query('COMMIT');

      return {
        progressUpdate: mapRowToProgressUpdate(updateRes.rows[0]),
        matches: insertedMatches
      };
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      if (err instanceof AppError) {
        throw err;
      }
      throw new DatabaseError(`Failed to commit document processing transaction: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }

  async getById(id: string): Promise<ProgressUpdate | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM progress_updates WHERE id = $1', [id]);
      return res.rows.length > 0 ? mapRowToProgressUpdate(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch progress update by ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getByIdAndProjectId(id: string, projectId: string): Promise<ProgressUpdate | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM progress_updates WHERE id = $1 AND project_id = $2', [id, projectId]);
      return res.rows.length > 0 ? mapRowToProgressUpdate(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch progress update for project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByIds(ids: string[], projectId: string): Promise<ProgressUpdate[]> {
    if (ids.length === 0) return [];
    try {
      const pool = this.getPool();
      const res = await pool.query(
        `SELECT * FROM progress_updates WHERE project_id = $1 AND id = ANY($2) ORDER BY created_at DESC, id DESC`,
        [projectId, ids]
      );
      return res.rows.map(mapRowToProgressUpdate);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list progress updates for ID batch: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByProjectId(projectId: string): Promise<ProgressUpdate[]> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        `SELECT * FROM progress_updates WHERE project_id = $1 ORDER BY created_at DESC, id DESC`,
        [projectId]
      );
      return res.rows.map(mapRowToProgressUpdate);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list progress updates for project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async countByProjectId(projectId: string): Promise<number> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT COUNT(*) as count FROM progress_updates WHERE project_id = $1', [projectId]);
      return parseInt(res.rows[0].count, 10);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to count progress updates: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const pool = this.getPool();
      const res = await pool.query('DELETE FROM progress_updates WHERE id = $1', [id]);
      return (res.rowCount ?? 0) > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to delete progress update: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async deleteByIdAndProjectId(id: string, projectId: string): Promise<boolean> {
    try {
      const pool = this.getPool();
      const res = await pool.query('DELETE FROM progress_updates WHERE id = $1 AND project_id = $2', [id, projectId]);
      return (res.rowCount ?? 0) > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to delete progress update for project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const postgresProgressUpdateRepository = new PostgresProgressUpdateRepository();
