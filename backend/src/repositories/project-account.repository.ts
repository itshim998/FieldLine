import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { getDatabase } from '../database/db.js';
import {
  ProjectAccount,
  ProjectAccountPublic,
  CreateProjectAccountInput,
  AccountType
} from '../models/domain.types.js';
import { ConflictError, DatabaseError, NotFoundError } from '../errors/AppError.js';

import { MaybePromise } from '../database/provider.js';

export interface ProjectAccountRepository {
  create(input: CreateProjectAccountInput): MaybePromise<ProjectAccount>;
  findById(id: string): MaybePromise<ProjectAccount | null>;
  findByProjectAndType(projectId: string, accountType: AccountType): MaybePromise<ProjectAccount | null>;
  listByProjectId(projectId: string): MaybePromise<ProjectAccount[]>;
  listPublicByProjectId(projectId: string): MaybePromise<ProjectAccountPublic[]>;
  updateCredential(id: string, credentialHash: string): MaybePromise<boolean>;
  delete(id: string): MaybePromise<boolean>;
}

interface ProjectAccountDbRow {
  id: string;
  project_id: string;
  account_type: string;
  credential_hash: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

function mapRowToAccount(row: ProjectAccountDbRow): ProjectAccount {
  return {
    id: row.id,
    projectId: row.project_id,
    accountType: row.account_type as AccountType,
    credentialHash: row.credential_hash,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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

export class SqliteProjectAccountRepository implements ProjectAccountRepository {
  private getDb: () => DatabaseType;

  constructor(dbProvider?: () => DatabaseType) {
    this.getDb = dbProvider || getDatabase;
  }

  create(input: CreateProjectAccountInput): ProjectAccount {
    const db = this.getDb();
    const id = input.id || crypto.randomUUID();

    const stmt = db.prepare(`
      INSERT INTO project_accounts (
        id, project_id, account_type, credential_hash, display_name
      ) VALUES (
        ?, ?, ?, ?, ?
      )
    `);

    try {
      stmt.run(
        id,
        input.projectId,
        input.accountType,
        input.credentialHash,
        input.displayName
      );
    } catch (err: any) {
      if (err.code === 'SQLITE_CONSTRAINT' || (err.message && err.message.includes('UNIQUE'))) {
        throw new ConflictError(
          `Project account for type '${input.accountType}' already exists in project '${input.projectId}'`
        );
      }
      throw new DatabaseError(
        `Failed to create project account: ${err.message}`,
        err
      );
    }

    const created = this.findById(id);
    if (!created) {
      throw new DatabaseError(`Created project account could not be retrieved: ${id}`);
    }
    return created;
  }

  findById(id: string): ProjectAccount | null {
    const db = this.getDb();
    const row = db
      .prepare('SELECT * FROM project_accounts WHERE id = ?')
      .get(id) as ProjectAccountDbRow | undefined;

    return row ? mapRowToAccount(row) : null;
  }

  findByProjectAndType(projectId: string, accountType: AccountType): ProjectAccount | null {
    const db = this.getDb();
    const row = db
      .prepare('SELECT * FROM project_accounts WHERE project_id = ? AND account_type = ?')
      .get(projectId, accountType) as ProjectAccountDbRow | undefined;

    return row ? mapRowToAccount(row) : null;
  }

  listByProjectId(projectId: string): ProjectAccount[] {
    const db = this.getDb();
    const rows = db
      .prepare('SELECT * FROM project_accounts WHERE project_id = ? ORDER BY account_type ASC')
      .all(projectId) as ProjectAccountDbRow[];

    return rows.map(mapRowToAccount);
  }

  listPublicByProjectId(projectId: string): ProjectAccountPublic[] {
    return this.listByProjectId(projectId).map(toPublicAccount);
  }

  updateCredential(id: string, credentialHash: string): boolean {
    const db = this.getDb();
    const stmt = db.prepare(`
      UPDATE project_accounts
      SET credential_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const result = stmt.run(credentialHash, id);
    return result.changes > 0;
  }

  delete(id: string): boolean {
    const db = this.getDb();
    const stmt = db.prepare('DELETE FROM project_accounts WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}

export const sqliteProjectAccountRepository: ProjectAccountRepository = new SqliteProjectAccountRepository();

import { PostgresProjectAccountRepository } from './postgres/postgres-project-account.repository.js';
import { env } from '../config/env.js';

let _postgresProjectAccountRepoInstance: PostgresProjectAccountRepository | null = null;
export function getPostgresProjectAccountRepository(): PostgresProjectAccountRepository {
  if (!_postgresProjectAccountRepoInstance) {
    _postgresProjectAccountRepoInstance = new PostgresProjectAccountRepository();
  }
  return _postgresProjectAccountRepoInstance;
}

export const projectAccountRepository: ProjectAccountRepository = new Proxy(Object.create(sqliteProjectAccountRepository) as ProjectAccountRepository, {
  get(target, prop, receiver) {
    if (Object.prototype.hasOwnProperty.call(target, prop)) {
      return Reflect.get(target, prop, receiver);
    }
    const activeRepo: any = env.DATABASE_PROVIDER === 'postgres' ? getPostgresProjectAccountRepository() : sqliteProjectAccountRepository;
    const val = Reflect.get(activeRepo, prop, receiver);
    if (typeof val === 'function') {
      return val.bind(activeRepo);
    }
    return val;
  }
});
