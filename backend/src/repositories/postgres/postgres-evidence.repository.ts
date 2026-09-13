import type { Pool } from 'pg';
import crypto from 'node:crypto';
import { getPostgresPool } from '../../database/postgres.js';
import {
  Evidence,
  CreateEvidenceInput,
  CreateProjectEventInput
} from '../../models/domain.types.js';
import { ConflictError, DatabaseError, NotFoundError } from '../../errors/AppError.js';
import type { EvidenceRepository } from '../evidence.repository.js';

interface EvidenceDbRow {
  id: string;
  project_id: string;
  progress_update_id: string | null;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size_bytes: number | string | null;
  mime_type: string | null;
  metadata_json: string | null;
  content_sha256: string | null;
  uploaded_at: string | Date;
  created_at: string | Date;
}

function mapRowToEvidence(row: EvidenceDbRow): Evidence {
  return {
    id: row.id,
    projectId: row.project_id,
    progressUpdateId: row.progress_update_id,
    fileName: row.file_name,
    filePath: row.file_path,
    fileType: row.file_type as Evidence['fileType'],
    fileSizeBytes: row.file_size_bytes !== null ? Number(row.file_size_bytes) : null,
    mimeType: row.mime_type,
    metadataJson: row.metadata_json,
    contentSha256: row.content_sha256 || null,
    uploadedAt: typeof row.uploaded_at === 'string' ? row.uploaded_at : row.uploaded_at.toISOString(),
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString()
  };
}

export class PostgresEvidenceRepository implements EvidenceRepository {
  private getPool: () => Pool;

  constructor(poolProvider?: () => Pool) {
    this.getPool = poolProvider || getPostgresPool;
  }

  async create(input: CreateEvidenceInput): Promise<Evidence> {
    const pool = this.getPool();
    const id = input.id || crypto.randomUUID();
    const contentSha256 = input.contentSha256 ?? null;

    const sql = `
      INSERT INTO evidence (
        id, project_id, progress_update_id, file_name, file_path,
        file_type, file_size_bytes, mime_type, metadata_json, content_sha256
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      ) RETURNING *
    `;

    try {
      const res = await pool.query(sql, [
        id,
        input.projectId,
        input.progressUpdateId ?? null,
        input.fileName,
        input.filePath,
        input.fileType,
        input.fileSizeBytes ?? null,
        input.mimeType ?? null,
        input.metadataJson ?? null,
        contentSha256
      ]);
      return mapRowToEvidence(res.rows[0]);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        throw new ConflictError(`Evidence with ID '${id}' or matching content already exists in this project`);
      }
      throw new DatabaseError(`Failed to create evidence: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async createWithEvent(
    evidenceInput: CreateEvidenceInput,
    eventInput: CreateProjectEventInput
  ): Promise<Evidence> {
    const pool = this.getPool();
    const client = await pool.connect();
    const id = evidenceInput.id || crypto.randomUUID();
    const eventId = eventInput.id || crypto.randomUUID();
    const contentSha256 = evidenceInput.contentSha256 ?? null;

    try {
      await client.query('BEGIN');

      const insertEvidenceSql = `
        INSERT INTO evidence (
          id, project_id, progress_update_id, file_name, file_path,
          file_type, file_size_bytes, mime_type, metadata_json, content_sha256
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        ) RETURNING *
      `;

      const evRes = await client.query(insertEvidenceSql, [
        id,
        evidenceInput.projectId,
        evidenceInput.progressUpdateId ?? null,
        evidenceInput.fileName,
        evidenceInput.filePath,
        evidenceInput.fileType,
        evidenceInput.fileSizeBytes ?? null,
        evidenceInput.mimeType ?? null,
        evidenceInput.metadataJson ?? null,
        contentSha256
      ]);

      const insertEventSql = `
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7
        )
      `;

      await client.query(insertEventSql, [
        eventId,
        eventInput.projectId,
        eventInput.eventType,
        eventInput.entityType ?? 'evidence',
        eventInput.entityId ?? id,
        eventInput.summary ?? 'Evidence file uploaded',
        eventInput.payloadJson ?? null
      ]);

      await client.query('COMMIT');
      return mapRowToEvidence(evRes.rows[0]);
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        throw new ConflictError(`Evidence with ID '${id}' or matching content already exists in this project`);
      }
      throw new DatabaseError(`Failed to persist evidence and event atomically: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }

  async findByProjectIdAndHash(projectId: string, contentSha256: string): Promise<Evidence | null> {
    if (!contentSha256 || !contentSha256.trim()) return null;
    try {
      const pool = this.getPool();
      const res = await pool.query(
        'SELECT * FROM evidence WHERE project_id = $1 AND content_sha256 = $2',
        [projectId, contentSha256.trim().toLowerCase()]
      );
      return res.rows.length > 0 ? mapRowToEvidence(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch evidence by hash: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async updateContentSha256(id: string, contentSha256: string): Promise<boolean> {
    try {
      const pool = this.getPool();
      const res = await pool.query('UPDATE evidence SET content_sha256 = $1 WHERE id = $2', [contentSha256, id]);
      return (res.rowCount ?? 0) > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to update evidence content hash: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listUnreconciledLegacyEvidence(): Promise<Evidence[]> {
    try {
      const pool = this.getPool();
      const res = await pool.query("SELECT * FROM evidence WHERE content_sha256 IS NULL OR content_sha256 = '' ORDER BY created_at ASC");
      return res.rows.map(mapRowToEvidence);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list unreconciled legacy evidence: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getById(id: string): Promise<Evidence | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM evidence WHERE id = $1', [id]);
      return res.rows.length > 0 ? mapRowToEvidence(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch evidence by ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getByIdAndProjectId(id: string, projectId: string): Promise<Evidence | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM evidence WHERE id = $1 AND project_id = $2', [id, projectId]);
      return res.rows.length > 0 ? mapRowToEvidence(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch evidence by ID and Project ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByProjectId(projectId: string): Promise<Evidence[]> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        'SELECT * FROM evidence WHERE project_id = $1 ORDER BY uploaded_at DESC, created_at DESC',
        [projectId]
      );
      return res.rows.map(mapRowToEvidence);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list evidence for project '${projectId}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByProgressUpdateId(progressUpdateId: string, projectId?: string): Promise<Evidence[]> {
    try {
      const pool = this.getPool();
      let res;
      if (projectId) {
        res = await pool.query(
          'SELECT * FROM evidence WHERE progress_update_id = $1 AND project_id = $2 ORDER BY uploaded_at DESC, created_at DESC',
          [progressUpdateId, projectId]
        );
      } else {
        res = await pool.query(
          'SELECT * FROM evidence WHERE progress_update_id = $1 ORDER BY uploaded_at DESC, created_at DESC',
          [progressUpdateId]
        );
      }
      return res.rows.map(mapRowToEvidence);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list evidence for progress update '${progressUpdateId}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByProgressUpdateIds(progressUpdateIds: string[], projectId: string): Promise<Evidence[]> {
    if (progressUpdateIds.length === 0) return [];
    try {
      const pool = this.getPool();
      const res = await pool.query(
        'SELECT * FROM evidence WHERE project_id = $1 AND progress_update_id = ANY($2) ORDER BY progress_update_id ASC, uploaded_at DESC, created_at DESC, id ASC',
        [projectId, progressUpdateIds]
      );
      return res.rows.map(mapRowToEvidence);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list evidence for progress update batch: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByActivityId(activityId: string, projectId: string): Promise<Evidence[]> {
    try {
      const pool = this.getPool();
      const sql = `
        SELECT DISTINCT e.*
        FROM evidence e
        WHERE e.project_id = $1
          AND (
            e.id IN (
              SELECT am.evidence_id
              FROM activity_matches am
              WHERE am.project_id = $2 AND am.activity_id = $3 AND am.evidence_id IS NOT NULL AND am.status = 'confirmed'
            )
            OR e.progress_update_id IN (
              SELECT am.progress_update_id
              FROM activity_matches am
              WHERE am.project_id = $4 AND am.activity_id = $5 AND am.status = 'confirmed'
            )
            OR e.progress_update_id IN (
              SELECT ap.progress_update_id
              FROM activity_progress ap
              WHERE ap.project_id = $6 AND ap.activity_id = $7 AND ap.progress_update_id IS NOT NULL
            )
          )
        ORDER BY e.uploaded_at DESC, e.created_at DESC
      `;
      const res = await pool.query(sql, [projectId, projectId, activityId, projectId, activityId, projectId, activityId]);
      return res.rows.map(mapRowToEvidence);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list traceable evidence for activity '${activityId}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async countByProjectId(projectId: string): Promise<number> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT COUNT(*) as count FROM evidence WHERE project_id = $1', [projectId]);
      return parseInt(res.rows[0].count, 10);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to count evidence for project '${projectId}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async attachToProgressUpdate(evidenceId: string, progressUpdateId: string, projectId: string): Promise<boolean> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        'UPDATE evidence SET progress_update_id = $1 WHERE id = $2 AND project_id = $3',
        [progressUpdateId, evidenceId, projectId]
      );
      return (res.rowCount ?? 0) > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to attach evidence '${evidenceId}' to progress update '${progressUpdateId}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async delete(id: string, projectId?: string): Promise<boolean> {
    try {
      const pool = this.getPool();
      let res;
      if (projectId) {
        res = await pool.query('DELETE FROM evidence WHERE id = $1 AND project_id = $2', [id, projectId]);
      } else {
        res = await pool.query('DELETE FROM evidence WHERE id = $1', [id]);
      }
      return (res.rowCount ?? 0) > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to delete evidence '${id}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async deleteByIdAndProjectId(id: string, projectId: string): Promise<boolean> {
    return this.delete(id, projectId);
  }
}

export const postgresEvidenceRepository = new PostgresEvidenceRepository();
