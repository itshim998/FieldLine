import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { projectRepository } from '../src/repositories/project.repository.js';
import { evidenceRepository } from '../src/repositories/evidence.repository.js';
import { DefaultEvidenceService } from '../src/services/evidence/evidence.service.js';

describe('Pass 16 — Evidence Content Hashing and Deduplication', () => {
  let projectId1: string;
  let projectId2: string;
  let service: DefaultEvidenceService;

  const testUploadDir = 'test-hash-dedup-artifacts';
  const uploadRoot = path.resolve(process.cwd(), testUploadDir);

  const fileBytesA = Buffer.from('CONTENT OF REPORT A — 2026-08-27 FIELDLINE UNIQUE BYTES');
  const fileBytesB = Buffer.from('CONTENT OF REPORT B — COMPLETELY DIFFERENT BYTES');

  const expectedSha256A = crypto.createHash('sha256').update(fileBytesA).digest('hex').toLowerCase();
  const expectedSha256B = crypto.createHash('sha256').update(fileBytesB).digest('hex').toLowerCase();

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });
    service = new DefaultEvidenceService(
      evidenceRepository,
      projectRepository,
      undefined,
      undefined,
      testUploadDir
    );

    if (!fs.existsSync(uploadRoot)) {
      fs.mkdirSync(uploadRoot, { recursive: true });
    }

    const p1 = projectRepository.create({ name: 'Navi Mumbai Expressway', code: 'NME-01' });
    projectId1 = p1.id;

    const p2 = projectRepository.create({ name: 'Bengaluru Metro Extension', code: 'BME-02' });
    projectId2 = p2.id;
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(uploadRoot)) {
      try {
        fs.rmSync(uploadRoot, { recursive: true, force: true });
      } catch {
        // Ignore test cleanup
      }
    }
  });

  it('calculates SHA-256 from actual file bytes and stores hash on Evidence row', async () => {
    const tempFile = path.join(uploadRoot, 'temp_upload.txt');
    fs.writeFileSync(tempFile, fileBytesA);

    const result = await service.uploadEvidence(projectId1, {
      originalname: 'report.txt',
      path: tempFile,
      size: fileBytesA.length,
      mimetype: 'text/plain'
    });

    expect(result.contentSha256).toBe(expectedSha256A);
    expect(result.contentSha256).toHaveLength(64);
    expect(result.deduplicated).toBe(false);

    // Verify stored in DB
    const fetched = evidenceRepository.getByIdAndProjectId(result.id, projectId1);
    expect(fetched).not.toBeNull();
    expect(fetched?.contentSha256).toBe(expectedSha256A);
  });

  it('deduplicates uploads with identical bytes in the same project', async () => {
    const temp1 = path.join(uploadRoot, 'first_upload.pdf');
    const temp2 = path.join(uploadRoot, 'second_upload.pdf');
    fs.writeFileSync(temp1, fileBytesA);
    fs.writeFileSync(temp2, fileBytesA);

    const first = await service.uploadEvidence(projectId1, {
      originalname: 'site_memo.pdf',
      path: temp1,
      size: fileBytesA.length,
      mimetype: 'application/pdf'
    });
    expect(first.deduplicated).toBe(false);

    const second = await service.uploadEvidence(projectId1, {
      originalname: 'site_memo_duplicate.pdf',
      path: temp2,
      size: fileBytesA.length,
      mimetype: 'application/pdf'
    });

    expect(second.deduplicated).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.contentSha256).toBe(first.contentSha256);
    expect(second.filePath).toBe(first.filePath);

    // Verify only ONE Evidence row exists in database
    const all = evidenceRepository.listByProjectId(projectId1);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(first.id);
  });

  it('deduplicates files with different filenames but identical bytes', async () => {
    const tempA = path.join(uploadRoot, 'report-a.pdf');
    const tempB = path.join(uploadRoot, 'report-b.pdf');
    fs.writeFileSync(tempA, fileBytesA);
    fs.writeFileSync(tempB, fileBytesA);

    const evA = await service.uploadEvidence(projectId1, {
      originalname: 'report-a.pdf',
      path: tempA,
      size: fileBytesA.length,
      mimetype: 'application/pdf'
    });

    const evB = await service.uploadEvidence(projectId1, {
      originalname: 'report-b.pdf',
      path: tempB,
      size: fileBytesA.length,
      mimetype: 'application/pdf'
    });

    expect(evA.deduplicated).toBe(false);
    expect(evB.deduplicated).toBe(true);
    expect(evB.id).toBe(evA.id);
    expect(evB.fileName).toBe(evA.fileName); // Preserves original persisted evidence row
  });

  it('does not create a second physical permanent file on duplicate upload', async () => {
    const temp1 = path.join(uploadRoot, 'upload_one.xlsx');
    const temp2 = path.join(uploadRoot, 'upload_two.xlsx');
    fs.writeFileSync(temp1, fileBytesA);
    fs.writeFileSync(temp2, fileBytesA);

    const first = await service.uploadEvidence(projectId1, {
      originalname: 'schedule_data.xlsx',
      path: temp1,
      size: fileBytesA.length,
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const projectDir = path.join(uploadRoot, projectId1);
    const filesAfterFirst = fs.readdirSync(projectDir);
    expect(filesAfterFirst).toHaveLength(1);

    await service.uploadEvidence(projectId1, {
      originalname: 'schedule_data_copy.xlsx',
      path: temp2,
      size: fileBytesA.length,
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const filesAfterSecond = fs.readdirSync(projectDir);
    expect(filesAfterSecond).toHaveLength(1);
    expect(filesAfterSecond[0]).toBe(path.basename(first.filePath));
  });

  it('cleans up temporary duplicate file on duplicate detection', async () => {
    const temp1 = path.join(uploadRoot, 'original.txt');
    const temp2 = path.join(uploadRoot, 'duplicate_temp.txt');
    fs.writeFileSync(temp1, fileBytesA);
    fs.writeFileSync(temp2, fileBytesA);

    await service.uploadEvidence(projectId1, {
      originalname: 'original.txt',
      path: temp1,
      size: fileBytesA.length,
      mimetype: 'text/plain'
    });

    expect(fs.existsSync(temp2)).toBe(true);

    await service.uploadEvidence(projectId1, {
      originalname: 'duplicate_temp.txt',
      path: temp2,
      size: fileBytesA.length,
      mimetype: 'text/plain'
    });

    // Temporary duplicate file should be unlinked/cleaned
    expect(fs.existsSync(temp2)).toBe(false);
  });

  it('allows same bytes across different projects (project isolation)', async () => {
    const tempP1 = path.join(uploadRoot, 'p1_file.txt');
    const tempP2 = path.join(uploadRoot, 'p2_file.txt');
    fs.writeFileSync(tempP1, fileBytesA);
    fs.writeFileSync(tempP2, fileBytesA);

    const evP1 = await service.uploadEvidence(projectId1, {
      originalname: 'shared_memo.txt',
      path: tempP1,
      size: fileBytesA.length,
      mimetype: 'text/plain'
    });

    const evP2 = await service.uploadEvidence(projectId2, {
      originalname: 'shared_memo.txt',
      path: tempP2,
      size: fileBytesA.length,
      mimetype: 'text/plain'
    });

    expect(evP1.deduplicated).toBe(false);
    expect(evP2.deduplicated).toBe(false);
    expect(evP1.id).not.toBe(evP2.id);
    expect(evP1.projectId).toBe(projectId1);
    expect(evP2.projectId).toBe(projectId2);
    expect(evP1.contentSha256).toBe(evP2.contentSha256);

    // Verify both projects have their respective records
    expect(evidenceRepository.listByProjectId(projectId1)).toHaveLength(1);
    expect(evidenceRepository.listByProjectId(projectId2)).toHaveLength(1);
  });

  it('allows different bytes within the same project to create separate evidence records', async () => {
    const tempA = path.join(uploadRoot, 'fileA.txt');
    const tempB = path.join(uploadRoot, 'fileB.txt');
    fs.writeFileSync(tempA, fileBytesA);
    fs.writeFileSync(tempB, fileBytesB);

    const evA = await service.uploadEvidence(projectId1, {
      originalname: 'fileA.txt',
      path: tempA,
      size: fileBytesA.length,
      mimetype: 'text/plain'
    });

    const evB = await service.uploadEvidence(projectId1, {
      originalname: 'fileB.txt',
      path: tempB,
      size: fileBytesB.length,
      mimetype: 'text/plain'
    });

    expect(evA.deduplicated).toBe(false);
    expect(evB.deduplicated).toBe(false);
    expect(evA.id).not.toBe(evB.id);
    expect(evA.contentSha256).toBe(expectedSha256A);
    expect(evB.contentSha256).toBe(expectedSha256B);

    const all = evidenceRepository.listByProjectId(projectId1);
    expect(all).toHaveLength(2);
  });

  it('cleans up physical permanent file if DB insertion fails on new upload', async () => {
    const failingRepo = Object.create(evidenceRepository);
    failingRepo.findByProjectIdAndHash = () => null;
    failingRepo.createWithEvent = () => {
      throw new Error('Simulated SQLite DB failure');
    };

    const failingService = new DefaultEvidenceService(
      failingRepo,
      projectRepository,
      undefined,
      undefined,
      testUploadDir
    );

    const tempFail = path.join(uploadRoot, 'temp_fail.txt');
    fs.writeFileSync(tempFail, Buffer.from('FAIL ATTEMPT BYTES'));

    await expect(
      failingService.uploadEvidence(projectId1, {
        originalname: 'fail.txt',
        path: tempFail,
        size: 18,
        mimetype: 'text/plain'
      })
    ).rejects.toThrow('Simulated SQLite DB failure');

    // Verify project directory contains 0 orphaned permanent files
    const projectDir = path.join(uploadRoot, projectId1);
    if (fs.existsSync(projectDir)) {
      const files = fs.readdirSync(projectDir);
      expect(files).toHaveLength(0);
    }
  });
});
