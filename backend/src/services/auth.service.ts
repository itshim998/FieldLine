import crypto from 'node:crypto';
import { env } from '../config/env.js';
import type { MaybePromise } from '../database/provider.js';
import {
  AccountType,
  Project,
  ProjectAccount,
  ProjectAccountPublic,
  SessionIdentity,
  LoginInput,
  AuthResult
} from '../models/domain.types.js';
import {
  ProjectAccountRepository,
  projectAccountRepository
} from '../repositories/project-account.repository.js';
import {
  ProjectRepository,
  projectRepository
} from '../repositories/project.repository.js';
import {
  AuthenticationError,
  ValidationError,
  NotFoundError
} from '../errors/AppError.js';

export interface AuthServiceOptions {
  accountRepository?: ProjectAccountRepository;
  projectRepository?: ProjectRepository;
  sessionSecret?: string;
  defaultSessionDurationMs?: number;
}

export class AuthService {
  private accountRepo: ProjectAccountRepository;
  private projectRepo: ProjectRepository;
  private sessionSecret: string;
  private defaultDurationMs: number;

  constructor(options: AuthServiceOptions = {}) {
    this.accountRepo = options.accountRepository || projectAccountRepository;
    this.projectRepo = options.projectRepository || projectRepository;
    this.sessionSecret = options.sessionSecret || env.AUTH_SESSION_SECRET || 'fieldline-dev-session-secret-key-2026';
    this.defaultDurationMs = options.defaultSessionDurationMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
  }

  /**
   * Hashes a raw passcode/password using PBKDF2-HMAC-SHA512 with a 16-byte random salt.
   */
  hashPasscode(passcode: string): string {
    if (!passcode || typeof passcode !== 'string' || passcode.trim().length === 0) {
      throw new ValidationError('Passcode must be a non-empty string');
    }
    const iterations = 100000;
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto
      .pbkdf2Sync(passcode, salt, iterations, 64, 'sha512')
      .toString('hex');

    return `pbkdf2$${iterations}$${salt}$${derivedKey}`;
  }

  /**
   * Verifies a raw passcode against a stored PBKDF2 hash using constant-time comparison.
   */
  verifyPasscode(passcode: string, storedHash: string): boolean {
    if (!passcode || !storedHash) return false;

    const parts = storedHash.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
      return false;
    }

    const iterations = parseInt(parts[1], 10);
    const salt = parts[2];
    const originalDerivedHex = parts[3];

    if (isNaN(iterations) || !salt || !originalDerivedHex) {
      return false;
    }

    try {
      const computedKey = crypto.pbkdf2Sync(passcode, salt, iterations, 64, 'sha512');
      const originalKey = Buffer.from(originalDerivedHex, 'hex');

      if (computedKey.length !== originalKey.length) {
        return false;
      }

      return crypto.timingSafeEqual(computedKey, originalKey);
    } catch {
      return false;
    }
  }

  /**
   * Generates a tamper-proof HMAC-SHA256 signed session token.
   */
  createSessionToken(
    identity: Omit<SessionIdentity, 'issuedAt' | 'expiresAt' | 'sessionId'> & { sessionId?: string },
    durationMs?: number
  ): string {
    const now = Date.now();
    const expiresAt = now + (durationMs ?? this.defaultDurationMs);

    const payload: SessionIdentity = {
      sessionId: identity.sessionId || crypto.randomUUID(),
      projectId: identity.projectId,
      accountType: identity.accountType,
      displayName: identity.displayName,
      issuedAt: now,
      expiresAt
    };

    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.sessionSecret)
      .update(encodedPayload)
      .digest('base64url');

    return `${encodedPayload}.${signature}`;
  }

  /**
   * Verifies and decodes a signed session token.
   * Throws AuthenticationError if the token is tampered, malformed, or expired.
   */
  verifySessionToken(token: string): SessionIdentity {
    if (!token || typeof token !== 'string') {
      throw new AuthenticationError('Missing or invalid session token');
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new AuthenticationError('Malformed session token format');
    }

    const [encodedPayload, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', this.sessionSecret)
      .update(encodedPayload)
      .digest('base64url');

    const expectedBuf = Buffer.from(expectedSignature);
    const actualBuf = Buffer.from(signature);

    if (
      expectedBuf.length !== actualBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, actualBuf)
    ) {
      throw new AuthenticationError('Invalid session token signature');
    }

    let payload: SessionIdentity;
    try {
      const decodedJson = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
      payload = JSON.parse(decodedJson);
    } catch {
      throw new AuthenticationError('Invalid session token payload');
    }

    if (!payload.projectId || !payload.accountType || !payload.expiresAt) {
      throw new AuthenticationError('Incomplete session token payload');
    }

    if (Date.now() > payload.expiresAt) {
      throw new AuthenticationError('Session token has expired');
    }

    return payload;
  }

  /**
   * Authenticates against a project account using either projectId or projectCode.
   * Returns a signed session token and session identity.
   */
  async authenticate(input: LoginInput): Promise<AuthResult> {
    if (!input.passcode || typeof input.passcode !== 'string' || input.passcode.trim().length === 0) {
      throw new AuthenticationError('Passcode or password is required');
    }

    if (!input.accountType || (input.accountType !== 'worker' && input.accountType !== 'admin')) {
      throw new ValidationError("accountType must be either 'worker' or 'admin'");
    }

    // 1. Resolve project
    let project = null;
    if (input.projectId) {
      project = await this.projectRepo.getById(input.projectId);
    } else if (input.projectCode) {
      project = await this.projectRepo.getByCode(input.projectCode);
    } else {
      throw new ValidationError('Either projectId or projectCode must be provided for authentication');
    }

    if (!project) {
      throw new AuthenticationError('Invalid project credentials');
    }

    // 2. Resolve account for this project & account type
    const account = await this.accountRepo.findByProjectAndType(project.id, input.accountType);
    if (!account) {
      throw new AuthenticationError('Invalid project credentials');
    }

    // 3. Verify passcode
    const isMatch = this.verifyPasscode(input.passcode, account.credentialHash);
    if (!isMatch) {
      throw new AuthenticationError('Invalid project credentials');
    }

    // 4. Issue authenticated session token
    const sessionId = crypto.randomUUID();
    const token = this.createSessionToken({
      sessionId,
      projectId: project.id,
      accountType: account.accountType,
      displayName: account.displayName
    });

    const session = this.verifySessionToken(token);

    return {
      token,
      session,
      project: {
        id: project.id,
        code: project.code,
        name: project.name
      }
    };
  }

  /**
   * Provisions default accounts (Worker + Admin) for a given project.
   * Idempotently updates existing accounts or inserts missing ones.
   */
  provisionDefaultAccounts(
    projectId: string,
    options: {
      workerPin?: string;
      adminPassword?: string;
      workerDisplayName?: string;
      adminDisplayName?: string;
      replaceExisting?: boolean;
    } = {}
  ): MaybePromise<{ worker: ProjectAccount; admin: ProjectAccount }> {
    const projectRes = this.projectRepo.getById(projectId);
    if (projectRes instanceof Promise) {
      return (async () => {
        const project = await projectRes;
        if (!project) {
          throw new NotFoundError(`Project not found: ${projectId}`);
        }

        const workerPin = options.workerPin || '4444';
        const adminPassword = options.adminPassword || 'RefineryAdmin2026!';
        const workerDisplayName = options.workerDisplayName || 'Field Operations Crew';
        const adminDisplayName = options.adminDisplayName || 'Project Superintendent';

        // 1. Worker Account
        let worker = await this.accountRepo.findByProjectAndType(projectId, 'worker');
        if (!worker) {
          worker = await this.accountRepo.create({
            projectId,
            accountType: 'worker',
            credentialHash: this.hashPasscode(workerPin),
            displayName: workerDisplayName
          });
        } else if (options.replaceExisting) {
          await this.accountRepo.updateCredential(worker.id, this.hashPasscode(workerPin));
          worker = (await this.accountRepo.findById(worker.id))!;
        }

        // 2. Admin Account
        let admin = await this.accountRepo.findByProjectAndType(projectId, 'admin');
        if (!admin) {
          admin = await this.accountRepo.create({
            projectId,
            accountType: 'admin',
            credentialHash: this.hashPasscode(adminPassword),
            displayName: adminDisplayName
          });
        } else if (options.replaceExisting) {
          await this.accountRepo.updateCredential(admin.id, this.hashPasscode(adminPassword));
          admin = (await this.accountRepo.findById(admin.id))!;
        }

        return { worker, admin };
      })();
    }

    const project = projectRes as Project | null;
    if (!project) {
      throw new NotFoundError(`Project not found: ${projectId}`);
    }

    const workerPin = options.workerPin || '4444';
    const adminPassword = options.adminPassword || 'RefineryAdmin2026!';
    const workerDisplayName = options.workerDisplayName || 'Field Operations Crew';
    const adminDisplayName = options.adminDisplayName || 'Project Superintendent';

    // 1. Worker Account
    let worker = this.accountRepo.findByProjectAndType(projectId, 'worker') as ProjectAccount | null;
    if (!worker) {
      worker = this.accountRepo.create({
        projectId,
        accountType: 'worker',
        credentialHash: this.hashPasscode(workerPin),
        displayName: workerDisplayName
      }) as ProjectAccount;
    } else if (options.replaceExisting) {
      this.accountRepo.updateCredential(worker.id, this.hashPasscode(workerPin));
      worker = this.accountRepo.findById(worker.id) as ProjectAccount;
    }

    // 2. Admin Account
    let admin = this.accountRepo.findByProjectAndType(projectId, 'admin') as ProjectAccount | null;
    if (!admin) {
      admin = this.accountRepo.create({
        projectId,
        accountType: 'admin',
        credentialHash: this.hashPasscode(adminPassword),
        displayName: adminDisplayName
      }) as ProjectAccount;
    } else if (options.replaceExisting) {
      this.accountRepo.updateCredential(admin.id, this.hashPasscode(adminPassword));
      admin = this.accountRepo.findById(admin.id) as ProjectAccount;
    }

    return { worker, admin };
  }

  /**
   * Retrieves sanitized public account profiles for a project.
   */
  getPublicAccounts(projectId: string): MaybePromise<ProjectAccountPublic[]> {
    return this.accountRepo.listPublicByProjectId(projectId);
  }
}

export const authService = new AuthService();
