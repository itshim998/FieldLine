import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { projectRepository } from '../src/repositories/project.repository.js';
import { evidenceRepository } from '../src/repositories/evidence.repository.js';
import { DefaultEvidenceService } from '../src/services/evidence/evidence.service.js';
import { reconcileLegacyEvidenceHashes } from '../src/services/evidence/legacy-hash-reconciler.js';

describe('Pass 16 — Legacy Evidence Hash Reconciliation & Deduplication', () => {
  let projectId1: string;
  let projectId2: string;
  let evidenceService: DefaultEvidenceService;

  const testUploadDir = 'test-legacy-reconcile-artifacts';
  const uploadRoot = path.resolve(process.cwd(), testUploadDir);

  const fileBytesA = Buffer.from('LEGACY SITE MEMO 2026-08-28 — PRE PASS 16 RAW BYTES');
  const fileBytesB = Buffer.from('DIFFERENT REPORT BYTES — COMPLETELY UNRELATED CONTENT');

  const expectedSha256A = crypto.createHash('sha256').update(fileBytesA).digest('hex').toLowerCase();
  const expectedSha256B = crypto.createHash('sha256').update(fileBytesB).digest('hex').toLowerCase();

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });

    evidenceService = new DefaultEvidenceService(
      evidenceRepository,
      projectRepository,
      undefined,
      undefined,
      testUploadDir
    );

    if (!fs.existsSync(uploadRoot)) {
      fs.mkdirSync(uploadRoot, { recursive: true });
    }

    const p1 = projectRepository.create({ name: 'Bengaluru Metro Line 3', code: 'BML3-16' });
    projectId1 = p1.id;

    const p2 = projectRepository.create({ name: 'Mumbai Metro Line 2', code: 'MML2-16' });
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

  it('pre-Pass-16 Evidence file gets real SHA-256 computed from actual file bytes', () => {
    // 1. Simulate legacy pre-Pass-16 evidence on disk with no content_sha256 in DB
    const project1Dir = path.join(uploadRoot, projectId1);
    fs.mkdirSync(project1Dir, { recursive: true });

    const legacyFileRel = `${projectId1}/legacy_report.txt`;
    const legacyFileAbs = path.join(uploadRoot, legacyFileRel);
    fs.writeFileSync(legacyFileAbs, fileBytesA);

    const legacyEvidence = evidenceRepository.create({
      projectId: projectId1,
      fileName: 'legacy_report.txt',
      filePath: legacyFileRel,
      fileType: 'text',
      contentSha256: null // Legacy row without hash
    });

    expect(legacyEvidence.contentSha256).toBeNull();

    // 2. Run reconciliation routine
    const summary = reconcileLegacyEvidenceHashes(evidenceRepository, testUploadDir);

    expect(summary.totalLegacyFound).toBe(1);
    expect(summary.reconciledCount).toBe(1);
    expect(summary.unresolvedCount).toBe(0);

    // 3. Verify real SHA-256 is now persisted on the evidence row
    const updated = evidenceRepository.getByIdAndProjectId(legacyEvidence.id, projectId1);
    expect(updated).not.toBeNull();
    expect(updated?.contentSha256).toBe(expectedSha256A);
    expect(updated?.contentSha256).not.toBe(legacyEvidence.id.toLowerCase());
  });

  it('same-byte upload after reconciliation deduplicates against legacy Evidence', async () => {
    // 1. Create legacy unhashed evidence and write physical bytes
    const project1Dir = path.join(uploadRoot, projectId1);
    fs.mkdirSync(project1Dir, { recursive: true });

    const legacyFileRel = `${projectId1}/old_memo.pdf`;
    const legacyFileAbs = path.join(uploadRoot, legacyFileRel);
    fs.writeFileSync(legacyFileAbs, fileBytesA);

    const legacyEvidence = evidenceRepository.create({
      projectId: projectId1,
      fileName: 'old_memo.pdf',
      filePath: legacyFileRel,
      fileType: 'pdf',
      contentSha256: null
    });

    // 2. Reconcile legacy evidence
    reconcileLegacyEvidenceHashes(evidenceRepository, testUploadDir);

    // 3. Upload new file with identical bytes
    const tempUpload = path.join(uploadRoot, 'new_upload_copy.pdf');
    fs.writeFileSync(tempUpload, fileBytesA);

    const uploadResult = await evidenceService.uploadEvidence(projectId1, {
      originalname: 'new_upload_copy.pdf',
      path: tempUpload,
      size: fileBytesA.length,
      mimetype: 'application/pdf'
    });

    expect(uploadResult.deduplicated).toBe(true);
    expect(uploadResult.id).toBe(legacyEvidence.id);
    expect(uploadResult.contentSha256).toBe(expectedSha256A);

    // Verify only 1 record exists in database
    const all = evidenceRepository.listByProjectId(projectId1);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(legacyEvidence.id);

    // Verify temporary upload was cleaned
    expect(fs.existsSync(tempUpload)).toBe(false);
  });

  it('different-byte upload does not deduplicate against legacy Evidence', async () => {
    const project1Dir = path.join(uploadRoot, projectId1);
    fs.mkdirSync(project1Dir, { recursive: true });

    const legacyFileRel = `${projectId1}/baseline.csv`;
    const legacyFileAbs = path.join(uploadRoot, legacyFileRel);
    fs.writeFileSync(legacyFileAbs, fileBytesA);

    evidenceRepository.create({
      projectId: projectId1,
      fileName: 'baseline.csv',
      filePath: legacyFileRel,
      fileType: 'text',
      contentSha256: null
    });

    reconcileLegacyEvidenceHashes(evidenceRepository, testUploadDir);

    const tempUpload = path.join(uploadRoot, 'different_file.csv');
    fs.writeFileSync(tempUpload, fileBytesB);

    const uploadResult = await evidenceService.uploadEvidence(projectId1, {
      originalname: 'different_file.csv',
      path: tempUpload,
      size: fileBytesB.length,
      mimetype: 'text/csv'
    });

    expect(uploadResult.deduplicated).toBe(false);
    expect(uploadResult.contentSha256).toBe(expectedSha256B);

    const all = evidenceRepository.listByProjectId(projectId1);
    expect(all).toHaveLength(2);
  });

  it('same bytes across different projects remain independent', async () => {
    // Project 1 has legacy reconciled file with fileBytesA
    const project1Dir = path.join(uploadRoot, projectId1);
    fs.mkdirSync(project1Dir, { recursive: true });

    const legacyFileRel = `${projectId1}/p1_doc.txt`;
    fs.writeFileSync(path.join(uploadRoot, legacyFileRel), fileBytesA);

    const p1Legacy = evidenceRepository.create({
      projectId: projectId1,
      fileName: 'p1_doc.txt',
      filePath: legacyFileRel,
      fileType: 'text',
      contentSha256: null
    });

    reconcileLegacyEvidenceHashes(evidenceRepository, testUploadDir);

    // Upload same bytes to Project 2
    const tempP2 = path.join(uploadRoot, 'p2_temp.txt');
    fs.writeFileSync(tempP2, fileBytesA);

    const p2Upload = await evidenceService.uploadEvidence(projectId2, {
      originalname: 'p2_doc.txt',
      path: tempP2,
      size: fileBytesA.length,
      mimetype: 'text/plain'
    });

    expect(p2Upload.deduplicated).toBe(false);
    expect(p2Upload.id).not.toBe(p1Legacy.id);
    expect(p2Upload.projectId).toBe(projectId2);
    expect(p2Upload.contentSha256).toBe(expectedSha256A);

    expect(evidenceRepository.listByProjectId(projectId1)).toHaveLength(1);
    expect(evidenceRepository.listByProjectId(projectId2)).toHaveLength(1);
  });

  it('missing legacy file does not receive a fake content hash', () => {
    // Legacy evidence row referencing non-existent physical file
    const missingEvidence = evidenceRepository.create({
      projectId: projectId1,
      fileName: 'missing_physical_file.pdf',
      filePath: `${projectId1}/non_existent_file.pdf`,
      fileType: 'pdf',
      contentSha256: null
    });

    expect(missingEvidence.contentSha256).toBeNull();

    const summary = reconcileLegacyEvidenceHashes(evidenceRepository, testUploadDir);

    expect(summary.totalLegacyFound).toBe(1);
    expect(summary.reconciledCount).toBe(0);
    expect(summary.unresolvedCount).toBe(1);

    // Verify hash was NOT fabricated (remains null)
    const afterReconciliation = evidenceRepository.getByIdAndProjectId(missingEvidence.id, projectId1);
    expect(afterReconciliation?.contentSha256).toBeNull();
  });
});
