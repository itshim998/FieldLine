import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { getDatabase } from '../database/db.js';
import {
  Evidence,
  CreateEvidenceInput,
  CreateProjectEventInput
} from '../models/domain.types.js';
import { ConflictError, DatabaseError, NotFoundError } from '../errors/AppError.js';

import { MaybePromise } from '../database/provider.js';

export interface EvidenceRepository {
  create(input: CreateEvidenceInput): MaybePromise<Evidence>;
  createWithEvent(
    evidenceInput: CreateEvidenceInput,
    eventInput: CreateProjectEventInput
  ): MaybePromise<Evidence>;
  getById(id: string): MaybePromise<Evidence | null>;
  getByIdAndProjectId(id: string, projectId: string): MaybePromise<Evidence | null>;
  findByProjectIdAndHash(projectId: string, contentSha256: string): MaybePromise<Evidence | null>;
  updateContentSha256(id: string, contentSha256: string): MaybePromise<boolean>;
  listUnreconciledLegacyEvidence(): MaybePromise<Evidence[]>;
  listByProjectId(projectId: string): MaybePromise<Evidence[]>;
  listByProgressUpdateId(progressUpdateId: string, projectId?: string): MaybePromise<Evidence[]>;
  listByProgressUpdateIds(progressUpdateIds: string[], projectId: string): MaybePromise<Evidence[]>;
  listByActivityId(activityId: string, projectId: string): MaybePromise<Evidence[]>;
  countByProjectId(projectId: string): MaybePromise<number>;
  attachToProgressUpdate(evidenceId: string, progressUpdateId: string, projectId: string): MaybePromise<boolean>;
  delete(id: string, projectId?: string): MaybePromise<boolean>;
  deleteByIdAndProjectId(id: string, projectId: string): MaybePromise<boolean>;
}

interface EvidenceDbRow {
  id: string;
  project_id: string;
  progress_update_id: string | null;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  metadata_json: string | null;
  content_sha256: string | null;
  uploaded_at: string;
  created_at: string;
}

function mapRowToEvidence(row: EvidenceDbRow): Evidence {
  return {
    id: row.id,
    projectId: row.project_id,
    progressUpdateId: row.progress_update_id,
    fileName: row.file_name,
    filePath: row.file_path,
    fileType: row.file_type as Evidence['fileType'],
    fileSizeBytes: row.file_size_bytes,
    mimeType: row.mime_type,
    metadataJson: row.metadata_json,
    contentSha256: row.content_sha256 || null,
    uploadedAt: row.uploaded_at,
    createdAt: row.created_at
  };
}

export class SqliteEvidenceRepository implements EvidenceRepository {
  private getDb: () => DatabaseType;

  constructor(dbProvider?: () => DatabaseType) {
    this.getDb = dbProvider || getDatabase;
  }

  create(input: CreateEvidenceInput): Evidence {
    const db = this.getDb();
    const id = input.id || crypto.randomUUID();
    const contentSha256 = input.contentSha256 ?? null;

    const stmt = db.prepare(`
      INSERT INTO evidence (
        id, project_id, progress_update_id, file_name, file_path,
        file_type, file_size_bytes, mime_type, metadata_json, content_sha256
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    try {
      stmt.run(
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
      );
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw new ConflictError(`Evidence with ID '${id}' already exists`);
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new ConflictError(`Evidence with ID '${id}' or matching content already exists in this project`);
      }
      if (err instanceof Error && err.message.includes('cross-project evidence reference')) {
        throw new ConflictError('Cannot associate evidence with a progress update from another project');
      }
      throw new DatabaseError(`Failed to create evidence: ${err instanceof Error ? err.message : String(err)}`);
    }

    const created = this.getByIdAndProjectId(id, input.projectId);
    if (!created) {
      throw new DatabaseError('Failed to retrieve newly created evidence');
    }
    return created;
  }

  createWithEvent(
    evidenceInput: CreateEvidenceInput,
    eventInput: CreateProjectEventInput
  ): Evidence {
    const db = this.getDb();
    const id = evidenceInput.id || crypto.randomUUID();
    const eventId = eventInput.id || crypto.randomUUID();
    const contentSha256 = evidenceInput.contentSha256 ?? null;

    const insertEvidenceStmt = db.prepare(`
      INSERT INTO evidence (
        id, project_id, progress_update_id, file_name, file_path,
        file_type, file_size_bytes, mime_type, metadata_json, content_sha256
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
      insertEvidenceStmt.run(
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
      );

      insertEventStmt.run(
        eventId,
        eventInput.projectId,
        eventInput.eventType,
        eventInput.entityType ?? 'evidence',
        eventInput.entityId ?? id,
        eventInput.summary ?? 'Evidence file uploaded',
        eventInput.payloadJson ?? null
      );
    });

    try {
      runTransaction();
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw new ConflictError(`Evidence with ID '${id}' already exists`);
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new ConflictError(`Evidence with ID '${id}' or matching content already exists in this project`);
      }
      if (err instanceof Error && err.message.includes('cross-project evidence reference')) {
        throw new ConflictError('Cannot associate evidence with a progress update from another project');
      }
      throw new DatabaseError(`Failed to persist evidence and event atomically: ${err instanceof Error ? err.message : String(err)}`);
    }

    const created = this.getByIdAndProjectId(id, evidenceInput.projectId);
    if (!created) {
      throw new DatabaseError('Failed to retrieve newly created evidence');
    }
    return created;
  }

  findByProjectIdAndHash(projectId: string, contentSha256: string): Evidence | null {
    if (!contentSha256 || !contentSha256.trim()) {
      return null;
    }
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM evidence WHERE project_id = ? AND content_sha256 = ?');
      const row = stmt.get(projectId, contentSha256.trim().toLowerCase()) as EvidenceDbRow | undefined;
      return row ? mapRowToEvidence(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch evidence by hash: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  updateContentSha256(id: string, contentSha256: string): boolean {
    try {
      const db = this.getDb();
      const stmt = db.prepare('UPDATE evidence SET content_sha256 = ? WHERE id = ?');
      const res = stmt.run(contentSha256, id);
      return res.changes > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to update evidence content hash: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  listUnreconciledLegacyEvidence(): Evidence[] {
    try {
      const db = this.getDb();
      const stmt = db.prepare("SELECT * FROM evidence WHERE content_sha256 IS NULL OR content_sha256 = '' ORDER BY created_at ASC");
      const rows = stmt.all() as EvidenceDbRow[];
      return rows.map(mapRowToEvidence);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list unreconciled legacy evidence: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getById(id: string): Evidence | null {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM evidence WHERE id = ?');
      const row = stmt.get(id) as EvidenceDbRow | undefined;
      return row ? mapRowToEvidence(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch evidence by ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getByIdAndProjectId(id: string, projectId: string): Evidence | null {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM evidence WHERE id = ? AND project_id = ?');
      const row = stmt.get(id, projectId) as EvidenceDbRow | undefined;
      return row ? mapRowToEvidence(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch evidence by ID and Project ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  listByProjectId(projectId: string): Evidence[] {
    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        SELECT * FROM evidence
        WHERE project_id = ?
        ORDER BY uploaded_at DESC, created_at DESC
      `);
      const rows = stmt.all(projectId) as EvidenceDbRow[];
      return rows.map(mapRowToEvidence);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list evidence for project '${projectId}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  listByProgressUpdateId(progressUpdateId: string, projectId?: string): Evidence[] {
    try {
      const db = this.getDb();
      if (projectId) {
        const stmt = db.prepare(`
          SELECT * FROM evidence
          WHERE progress_update_id = ? AND project_id = ?
          ORDER BY uploaded_at DESC, created_at DESC
        `);
        const rows = stmt.all(progressUpdateId, projectId) as EvidenceDbRow[];
        return rows.map(mapRowToEvidence);
      } else {
        const stmt = db.prepare(`
          SELECT * FROM evidence
          WHERE progress_update_id = ?
          ORDER BY uploaded_at DESC, created_at DESC
        `);
        const rows = stmt.all(progressUpdateId) as EvidenceDbRow[];
        return rows.map(mapRowToEvidence);
      }
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list evidence for progress update '${progressUpdateId}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  listByProgressUpdateIds(progressUpdateIds: string[], projectId: string): Evidence[] {
    if (progressUpdateIds.length === 0) {
      return [];
    }

    try {
      const db = this.getDb();
      const placeholders = progressUpdateIds.map(() => '?').join(',');
      const stmt = db.prepare(`
        SELECT * FROM evidence
        WHERE project_id = ? AND progress_update_id IN (${placeholders})
        ORDER BY progress_update_id ASC, uploaded_at DESC, created_at DESC, id ASC
      `);
      const rows = stmt.all(projectId, ...progressUpdateIds) as EvidenceDbRow[];
      return rows.map(mapRowToEvidence);
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to list evidence for progress update batch: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  listByActivityId(activityId: string, projectId: string): Evidence[] {
    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        SELECT DISTINCT e.*
        FROM evidence e
        WHERE e.project_id = ?
          AND (
            e.id IN (
              SELECT am.evidence_id
              FROM activity_matches am
              WHERE am.project_id = ? AND am.activity_id = ? AND am.evidence_id IS NOT NULL AND am.status = 'confirmed'
            )
            OR e.progress_update_id IN (
              SELECT am.progress_update_id
              FROM activity_matches am
              WHERE am.project_id = ? AND am.activity_id = ? AND am.status = 'confirmed'
            )
            OR e.progress_update_id IN (
              SELECT ap.progress_update_id
              FROM activity_progress ap
              WHERE ap.project_id = ? AND ap.activity_id = ? AND ap.progress_update_id IS NOT NULL
            )
          )
        ORDER BY e.uploaded_at DESC, e.created_at DESC
      `);
      const rows = stmt.all(projectId, projectId, activityId, projectId, activityId, projectId, activityId) as EvidenceDbRow[];
      return rows.map(mapRowToEvidence);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list traceable evidence for activity '${activityId}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  countByProjectId(projectId: string): number {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT COUNT(*) as count FROM evidence WHERE project_id = ?');
      const row = stmt.get(projectId) as { count: number };
      return row ? row.count : 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to count evidence for project '${projectId}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  attachToProgressUpdate(evidenceId: string, progressUpdateId: string, projectId: string): boolean {
    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        UPDATE evidence
        SET progress_update_id = ?
        WHERE id = ? AND project_id = ?
      `);
      const result = stmt.run(progressUpdateId, evidenceId, projectId);
      return result.changes > 0;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('cross-project evidence reference')) {
        throw new ConflictError('Cannot associate evidence with a progress update from another project');
      }
      throw new DatabaseError(`Failed to attach evidence '${evidenceId}' to progress update '${progressUpdateId}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  delete(id: string, projectId?: string): boolean {
    try {
      const db = this.getDb();
      let result;
      if (projectId) {
        const stmt = db.prepare('DELETE FROM evidence WHERE id = ? AND project_id = ?');
        result = stmt.run(id, projectId);
      } else {
        const stmt = db.prepare('DELETE FROM evidence WHERE id = ?');
        result = stmt.run(id);
      }
      return result.changes > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to delete evidence '${id}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  deleteByIdAndProjectId(id: string, projectId: string): boolean {
    return this.delete(id, projectId);
  }
}

export const sqliteEvidenceRepository: EvidenceRepository = new SqliteEvidenceRepository();

import { PostgresEvidenceRepository } from './postgres/postgres-evidence.repository.js';
import { env } from '../config/env.js';

let _postgresEvidenceRepoInstance: PostgresEvidenceRepository | null = null;
export function getPostgresEvidenceRepository(): PostgresEvidenceRepository {
  if (!_postgresEvidenceRepoInstance) {
    _postgresEvidenceRepoInstance = new PostgresEvidenceRepository();
  }
  return _postgresEvidenceRepoInstance;
}

export const evidenceRepository: EvidenceRepository = new Proxy(Object.create(sqliteEvidenceRepository) as EvidenceRepository, {
  get(target, prop, receiver) {
    if (Object.prototype.hasOwnProperty.call(target, prop)) {
      return Reflect.get(target, prop, receiver);
    }
    const activeRepo: any = env.DATABASE_PROVIDER === 'postgres' ? getPostgresEvidenceRepository() : sqliteEvidenceRepository;
    const val = Reflect.get(activeRepo, prop, receiver);
    if (typeof val === 'function') {
      return val.bind(activeRepo);
    }
    return val;
  }
});
