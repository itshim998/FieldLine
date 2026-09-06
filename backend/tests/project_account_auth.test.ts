import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteProjectAccountRepository } from '../src/repositories/project-account.repository.js';
import { AuthService } from '../src/services/auth.service.js';
import { AuthenticationError, ConflictError, ValidationError } from '../src/errors/AppError.js';

describe('Pass 28 — Project Account Credentials & Session Identity', () => {
  let app: ReturnType<typeof createApp>;
  let projectRepo: SqliteProjectRepository;
  let accountRepo: SqliteProjectAccountRepository;
  let authService: AuthService;
  let projectId: string;
  const projectCode = 'TEST-PROJ-01';

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });
    const db = getDatabase();
    projectRepo = new SqliteProjectRepository(() => db);
    accountRepo = new SqliteProjectAccountRepository(() => db);
    authService = new AuthService({
      accountRepository: accountRepo,
      projectRepository: projectRepo,
      sessionSecret: 'test-secret-key-12345'
    });

    const project = projectRepo.create({
      code: projectCode,
      name: 'Test Refinery Unit',
      description: 'Project account authentication test'
    });
    projectId = project.id;

    // Create app with default router
    app = createApp();
  });

  afterEach(() => {
    closeDatabase();
  });

  // =========================================================================
  // 1. Repository & Database Constraints
  // =========================================================================
  describe('1. ProjectAccountRepository & Constraints', () => {
    it('creates and retrieves a worker account', () => {
      const hash = authService.hashPasscode('4444');
      const account = accountRepo.create({
        projectId,
        accountType: 'worker',
        credentialHash: hash,
        displayName: 'Field Crew Alpha'
      });

      expect(account).toBeDefined();
      expect(account.id).toBeDefined();
      expect(account.projectId).toBe(projectId);
      expect(account.accountType).toBe('worker');
      expect(account.credentialHash).toBe(hash);
      expect(account.displayName).toBe('Field Crew Alpha');

      const found = accountRepo.findById(account.id);
      expect(found).not.toBeNull();
      expect(found?.displayName).toBe('Field Crew Alpha');
    });

    it('creates and retrieves an admin account', () => {
      const hash = authService.hashPasscode('SuperAdminPass123!');
      const account = accountRepo.create({
        projectId,
        accountType: 'admin',
        credentialHash: hash,
        displayName: 'Project Lead Superintendent'
      });

      expect(account.accountType).toBe('admin');
      const byType = accountRepo.findByProjectAndType(projectId, 'admin');
      expect(byType).not.toBeNull();
      expect(byType?.id).toBe(account.id);
    });

    it('enforces unique constraint: only one worker account per project', () => {
      accountRepo.create({
        projectId,
        accountType: 'worker',
        credentialHash: authService.hashPasscode('1111'),
        displayName: 'First Worker'
      });

      expect(() => {
        accountRepo.create({
          projectId,
          accountType: 'worker',
          credentialHash: authService.hashPasscode('2222'),
          displayName: 'Second Worker'
        });
      }).toThrow(ConflictError);
    });

    it('enforces unique constraint: only one admin account per project', () => {
      accountRepo.create({
        projectId,
        accountType: 'admin',
        credentialHash: authService.hashPasscode('AdminPass1'),
        displayName: 'Lead 1'
      });

      expect(() => {
        accountRepo.create({
          projectId,
          accountType: 'admin',
          credentialHash: authService.hashPasscode('AdminPass2'),
          displayName: 'Lead 2'
        });
      }).toThrow(ConflictError);
    });

    it('allows separate accounts for different projects with same account type', () => {
      const p2 = projectRepo.create({ code: 'PROJ-02', name: 'Second Project' });

      const a1 = accountRepo.create({
        projectId,
        accountType: 'worker',
        credentialHash: authService.hashPasscode('1234'),
        displayName: 'Worker P1'
      });

      const a2 = accountRepo.create({
        projectId: p2.id,
        accountType: 'worker',
        credentialHash: authService.hashPasscode('1234'),
        displayName: 'Worker P2'
      });

      expect(a1.id).not.toBe(a2.id);
      expect(accountRepo.listByProjectId(projectId)).toHaveLength(1);
      expect(accountRepo.listByProjectId(p2.id)).toHaveLength(1);
    });

    it('cascades deletion of accounts when project is deleted', () => {
      accountRepo.create({
        projectId,
        accountType: 'worker',
        credentialHash: authService.hashPasscode('1234'),
        displayName: 'Worker P1'
      });
      accountRepo.create({
        projectId,
        accountType: 'admin',
        credentialHash: authService.hashPasscode('adminpass'),
        displayName: 'Admin P1'
      });

      expect(accountRepo.listByProjectId(projectId)).toHaveLength(2);

      // Foreign key cascade on project deletion
      projectRepo.delete(projectId);
      expect(accountRepo.listByProjectId(projectId)).toHaveLength(0);
    });

    it('returns sanitized public account profiles without credentialHash', () => {
      accountRepo.create({
        projectId,
        accountType: 'worker',
        credentialHash: authService.hashPasscode('1234'),
        displayName: 'Worker'
      });

      const publicAccounts = accountRepo.listPublicByProjectId(projectId);
      expect(publicAccounts).toHaveLength(1);
      expect(publicAccounts[0]).toHaveProperty('id');
      expect(publicAccounts[0]).toHaveProperty('projectId', projectId);
      expect(publicAccounts[0]).toHaveProperty('accountType', 'worker');
      expect(publicAccounts[0]).toHaveProperty('displayName', 'Worker');
      expect((publicAccounts[0] as any).credentialHash).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. Cryptographic Passcode Hashing & Session Tokens
  // =========================================================================
  describe('2. Passcode Hashing & Session Token Cryptography', () => {
    it('hashes passcodes using PBKDF2 with unique salts', () => {
      const hash1 = authService.hashPasscode('4444');
      const hash2 = authService.hashPasscode('4444');

      expect(hash1.startsWith('pbkdf2$100000$')).toBe(true);
      expect(hash2.startsWith('pbkdf2$100000$')).toBe(true);
      // Different salts produce different hashes
      expect(hash1).not.toBe(hash2);

      expect(authService.verifyPasscode('4444', hash1)).toBe(true);
      expect(authService.verifyPasscode('4444', hash2)).toBe(true);
      expect(authService.verifyPasscode('wrong_pin', hash1)).toBe(false);
    });

    it('rejects empty or whitespace passcodes', () => {
      expect(() => authService.hashPasscode('')).toThrow(ValidationError);
      expect(() => authService.hashPasscode('   ')).toThrow(ValidationError);
    });

    it('issues signed session tokens and verifies them cleanly', () => {
      const token = authService.createSessionToken({
        sessionId: 'sess-123',
        projectId,
        accountType: 'worker',
        displayName: 'Crew Lead'
      });

      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(2);

      const decoded = authService.verifySessionToken(token);
      expect(decoded.sessionId).toBe('sess-123');
      expect(decoded.projectId).toBe(projectId);
      expect(decoded.accountType).toBe('worker');
      expect(decoded.displayName).toBe('Crew Lead');
      expect(decoded.expiresAt).toBeGreaterThan(Date.now());
    });

    it('rejects tampered session token payload', () => {
      const token = authService.createSessionToken({
        sessionId: 'sess-123',
        projectId,
        accountType: 'worker',
        displayName: 'Crew Lead'
      });

      const [payload, sig] = token.split('.');
      // Tamper payload to elevate to admin
      const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
      decodedPayload.accountType = 'admin';
      const tamperedPayload = Buffer.from(JSON.stringify(decodedPayload)).toString('base64url');
      const tamperedToken = `${tamperedPayload}.${sig}`;

      expect(() => authService.verifySessionToken(tamperedToken)).toThrow(AuthenticationError);
    });

    it('rejects tampered signature', () => {
      const token = authService.createSessionToken({
        sessionId: 'sess-123',
        projectId,
        accountType: 'worker',
        displayName: 'Crew Lead'
      });

      const [payload] = token.split('.');
      const fakeSig = Buffer.from('bad_signature_value').toString('base64url');
      const tamperedToken = `${payload}.${fakeSig}`;

      expect(() => authService.verifySessionToken(tamperedToken)).toThrow(AuthenticationError);
    });

    it('rejects expired session token', () => {
      // Issue token that expires immediately (-1000ms duration)
      const token = authService.createSessionToken(
        {
          sessionId: 'sess-exp',
          projectId,
          accountType: 'admin',
          displayName: 'Admin'
        },
        -1000
      );

      expect(() => authService.verifySessionToken(token)).toThrow(/expired/i);
    });
  });

  // =========================================================================
  // 3. Domain Authentication Service
  // =========================================================================
  describe('3. AuthService Authentication & Provisioning Flows', () => {
    beforeEach(() => {
      authService.provisionDefaultAccounts(projectId, {
        workerPin: '4444',
        adminPassword: 'RefineryAdmin2026!'
      });
    });

    it('authenticates worker account with valid PIN via projectId', async () => {
      const result = await authService.authenticate({
        projectId,
        accountType: 'worker',
        passcode: '4444'
      });

      expect(result.token).toBeDefined();
      expect(result.session.projectId).toBe(projectId);
      expect(result.session.accountType).toBe('worker');
      expect(result.project.code).toBe(projectCode);
    });

    it('authenticates admin account with valid password via projectCode', async () => {
      const result = await authService.authenticate({
        projectCode,
        accountType: 'admin',
        passcode: 'RefineryAdmin2026!'
      });

      expect(result.token).toBeDefined();
      expect(result.session.projectId).toBe(projectId);
      expect(result.session.accountType).toBe('admin');
      expect(result.project.name).toBe('Test Refinery Unit');
    });

    it('rejects invalid passcode with AuthenticationError', async () => {
      await expect(
        authService.authenticate({
          projectId,
          accountType: 'worker',
          passcode: '9999'
        })
      ).rejects.toThrow(AuthenticationError);
    });

    it('rejects nonexistent project with AuthenticationError', async () => {
      await expect(
        authService.authenticate({
          projectCode: 'NON-EXISTENT',
          accountType: 'admin',
          passcode: 'RefineryAdmin2026!'
        })
      ).rejects.toThrow(AuthenticationError);
    });

    it('idempotently provisions default accounts', () => {
      const first = authService.provisionDefaultAccounts(projectId);
      expect(first.worker).toBeDefined();
      expect(first.admin).toBeDefined();

      const second = authService.provisionDefaultAccounts(projectId);
      expect(second.worker.id).toBe(first.worker.id);
      expect(second.admin.id).toBe(first.admin.id);
    });
  });

  // =========================================================================
  // 4. API Endpoints
  // =========================================================================
  describe('4. API Endpoints (POST /api/auth/login, GET /api/auth/session, etc.)', () => {
    beforeEach(async () => {
      // Seed default accounts through the app's repositories
      const db = getDatabase();
      const pRepo = new SqliteProjectRepository(() => db);
      const aRepo = new SqliteProjectAccountRepository(() => db);
      const aService = new AuthService({ accountRepository: aRepo, projectRepository: pRepo });

      aService.provisionDefaultAccounts(projectId, {
        workerPin: '4444',
        adminPassword: 'RefineryAdmin2026!'
      });
    });

    it('POST /api/auth/login succeeds for Worker with PIN', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          projectCode,
          accountType: 'worker',
          passcode: '4444'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.session.accountType).toBe('worker');
      expect(res.body.project.code).toBe(projectCode);
    });

    it('POST /api/auth/login succeeds for Admin with password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          projectId,
          accountType: 'admin',
          passcode: 'RefineryAdmin2026!'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.session.accountType).toBe('admin');
      expect(res.body.project.id).toBe(projectId);
    });

    it('POST /api/auth/login returns 401 on incorrect credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          projectCode,
          accountType: 'worker',
          passcode: 'incorrect_passcode'
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid project credentials');
      expect(res.body.code).toBe('AUTHENTICATION_ERROR');
    });

    it('POST /api/auth/login returns 400 on missing parameters', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          accountType: 'worker'
          // Missing passcode and project
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('GET /api/auth/session succeeds with valid Bearer token', async () => {
      // 1. Login to obtain token
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          projectCode,
          accountType: 'admin',
          passcode: 'RefineryAdmin2026!'
        });

      const token = loginRes.body.token;

      // 2. Validate session
      const sessionRes = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${token}`);

      expect(sessionRes.status).toBe(200);
      expect(sessionRes.body.success).toBe(true);
      expect(sessionRes.body.session.accountType).toBe('admin');
      expect(sessionRes.body.session.projectId).toBe(projectId);
      expect(sessionRes.body.project.code).toBe(projectCode);
    });

    it('GET /api/auth/session returns 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/api/auth/session');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTHENTICATION_ERROR');
      expect(res.body.error).toMatch(/Missing Authorization header/i);
    });

    it('GET /api/auth/session returns 401 on malformed or invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/session')
        .set('Authorization', 'Bearer invalid.bogus.token');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTHENTICATION_ERROR');
    });

    it('POST /api/auth/verify verifies token payload', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          projectCode,
          accountType: 'worker',
          passcode: '4444'
        });

      const token = loginRes.body.token;

      const verifyRes = await request(app)
        .post('/api/auth/verify')
        .send({ token });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.valid).toBe(true);
      expect(verifyRes.body.session.accountType).toBe('worker');
    });

    it('GET /api/projects/:projectId/accounts returns public profiles and never leaks hashes', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/accounts`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.accounts).toHaveLength(2);

      for (const acc of res.body.accounts) {
        expect(acc).toHaveProperty('id');
        expect(acc).toHaveProperty('accountType');
        expect(acc).toHaveProperty('displayName');
        expect(acc.credentialHash).toBeUndefined();
      }
    });
  });
});
