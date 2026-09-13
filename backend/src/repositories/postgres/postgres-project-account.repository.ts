import type { Pool } from 'pg';
import crypto from 'node:crypto';
import { getPostgresPool } from '../../database/postgres.js';
import {
  ProjectAccount,
  ProjectAccountPublic,
  CreateProjectAccountInput,
  AccountType
} from '../../models/domain.types.js';
import { ConflictError, DatabaseError } from '../../errors/AppError.js';
import type { ProjectAccountRepository } from '../project-account.repository.js';

interface ProjectAccountDbRow {
  id: string;
  project_id: string;
  account_type: string;
  credential_hash: string;
  display_name: string;
  created_at: string | Date;
  updated_at: string | Date;
}

function mapRowToAccount(row: ProjectAccountDbRow): ProjectAccount {
  return {
    id: row.id,
    projectId: row.project_id,
    accountType: row.account_type as AccountType,
    credentialHash: row.credential_hash,
    displayName: row.display_name,
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : row.updated_at.toISOString()
  };
}

function toPublicAccount(account: ProjectAccount): ProjectAccountPublic {
  return {
    id: account.id,
    projectId: account.projectId,
    accountType: account.accountType,
    displayName: account.displayName,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}

export class PostgresProjectAccountRepository implements ProjectAccountRepository {
  private getPool: () => Pool;

  constructor(poolProvider?: () => Pool) {
    this.getPool = poolProvider || getPostgresPool;
  }

  async create(input: CreateProjectAccountInput): Promise<ProjectAccount> {
    const pool = this.getPool();
    const id = input.id || crypto.randomUUID();

    const sql = `
      INSERT INTO project_accounts (
        id, project_id, account_type, credential_hash, display_name
      ) VALUES (
        $1, $2, $3, $4, $5
      ) RETURNING *
    `;

    try {
      const res = await pool.query(sql, [
        id,
        input.projectId,
        input.accountType,
        input.credentialHash,
        input.displayName
      ]);
      return mapRowToAccount(res.rows[0]);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        throw new ConflictError(
          `Project account for type '${input.accountType}' already exists in project '${input.projectId}'`
        );
      }
      throw new DatabaseError(
        `Failed to create project account: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async findById(id: string): Promise<ProjectAccount | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM project_accounts WHERE id = $1', [id]);
      return res.rows.length > 0 ? mapRowToAccount(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch project account: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async findByProjectAndType(projectId: string, accountType: AccountType): Promise<ProjectAccount | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        'SELECT * FROM project_accounts WHERE project_id = $1 AND account_type = $2',
        [projectId, accountType]
      );
      return res.rows.length > 0 ? mapRowToAccount(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch project account: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByProjectId(projectId: string): Promise<ProjectAccount[]> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        'SELECT * FROM project_accounts WHERE project_id = $1 ORDER BY account_type ASC',
        [projectId]
      );
      return res.rows.map(mapRowToAccount);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list project accounts: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listPublicByProjectId(projectId: string): Promise<ProjectAccountPublic[]> {
    const list = await this.listByProjectId(projectId);
    return list.map(toPublicAccount);
  }

  async updateCredential(id: string, credentialHash: string): Promise<boolean> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        'UPDATE project_accounts SET credential_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [credentialHash, id]
      );
      return (res.rowCount ?? 0) > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to update credential: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const pool = this.getPool();
      const res = await pool.query('DELETE FROM project_accounts WHERE id = $1', [id]);
      return (res.rowCount ?? 0) > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to delete account: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const postgresProjectAccountRepository = new PostgresProjectAccountRepository();
