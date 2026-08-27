import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { DefaultEvidenceService, detectEvidenceFileType } from '../src/services/evidence/evidence.service.js';
import { SqliteEvidenceRepository } from '../src/repositories/evidence.repository.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { NotFoundError, ValidationError, ConflictError } from '../src/errors/AppError.js';

describe('EvidenceService', () => {
  let service: DefaultEvidenceService;
  let evidenceRepo: SqliteEvidenceRepository;
  let projectRepo: SqliteProjectRepository;
  let progressUpdateRepo: SqliteProgressUpdateRepository;
  let activityRepo: SqliteActivityRepository;
  let scheduleRepo: SqliteScheduleRepository;

  const testUploadRoot = path.resolve(process.cwd(), 'test-evidence-uploads');
  const tempDir = path.resolve(testUploadRoot, 'temp-source');

  let project1Id: string;
  let project2Id: string;
  let update1Id: string;
  let update2Id: string;

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    evidenceRepo = new SqliteEvidenceRepository();
    projectRepo = new SqliteProjectRepository();
    progressUpdateRepo = new SqliteProgressUpdateRepository();
    activityRepo = new SqliteActivityRepository();
    scheduleRepo = new SqliteScheduleRepository();

    service = new DefaultEvidenceService(
      evidenceRepo,
      projectRepo,
      progressUpdateRepo,
      activityRepo,
      testUploadRoot
    );

    const p1 = projectRepo.create({ name: 'Bengaluru Metro Line 6', code: 'BMRCL-06' });
    project1Id = p1.id;

    const p2 = projectRepo.create({ name: 'Chennai Port Expressway', code: 'CPE-01' });
    project2Id = p2.id;

    const u1 = progressUpdateRepo.create({
      projectId: project1Id,
      reportDate: '2026-08-22',
      rawText: 'Girder launch at station 4 started.'
    });
    update1Id = u1.id;

    const u2 = progressUpdateRepo.create({
      projectId: project2Id,
      reportDate: '2026-08-23',
      rawText: 'Paving completed for section 2.'
    });
    update2Id = u2.id;
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(testUploadRoot)) {
      try {
        fs.rmSync(testUploadRoot, { recursive: true, force: true });
      } catch {
        // Ignore test cleanup error
      }
    }
  });

  describe('detectEvidenceFileType helper', () => {
    it('should classify various file types correctly', () => {
      expect(detectEvidenceFileType('report.pdf', 'application/pdf')).toBe('pdf');
      expect(detectEvidenceFileType('data.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx');
      expect(detectEvidenceFileType('data.xls')).toBe('xlsx');
      expect(detectEvidenceFileType('photo.png', 'image/png')).toBe('image');
      expect(detectEvidenceFileType('photo.jpg', 'image/jpeg')).toBe('image');
      expect(detectEvidenceFileType('interview.vtt', 'text/vtt')).toBe('transcript');
      expect(detectEvidenceFileType('notes.txt', 'text/plain')).toBe('text');
      expect(detectEvidenceFileType('summary.csv', 'text/csv')).toBe('text');
      expect(detectEvidenceFileType('archive.zip', 'application/zip')).toBe('other');
    });
  });

  describe('uploadEvidence', () => {
    it('should successfully store physical file and persist evidence record', async () => {
      const sourceFilePath = path.join(tempDir, 'sample_report.pdf');
      fs.writeFileSync(sourceFilePath, 'PDF-DUMMY-CONTENT-12345');

      const evidence = await service.uploadEvidence(
        project1Id,
        {
          path: sourceFilePath,
          originalname: 'sample_report.pdf',
          mimetype: 'application/pdf',
          size: 23
        },
        {
          progressUpdateId: update1Id,
          metadataJson: JSON.stringify({ author: 'Site QA' })
        }
      );

      expect(evidence.id).toBeDefined();
      expect(evidence.projectId).toBe(project1Id);
      expect(evidence.progressUpdateId).toBe(update1Id);
      expect(evidence.fileName).toBe('sample_report.pdf');
      expect(evidence.fileType).toBe('pdf');
      expect(evidence.fileSizeBytes).toBe(23);
      expect(evidence.mimeType).toBe('application/pdf');

      // Verify physical file was created in project directory
      const contentResult = service.getEvidenceContent(project1Id, evidence.id);
      expect(fs.existsSync(contentResult.absoluteFilePath)).toBe(true);
      expect(fs.readFileSync(contentResult.absoluteFilePath, 'utf-8')).toBe('PDF-DUMMY-CONTENT-12345');
    });

    it('should reject upload when project is not found', async () => {
      const sourceFilePath = path.join(tempDir, 'dummy.txt');
      fs.writeFileSync(sourceFilePath, 'hello');

      await expect(
        service.uploadEvidence('non-existent-project', {
          path: sourceFilePath,
          originalname: 'dummy.txt',
          size: 5
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('should reject upload when progress report does not exist', async () => {
      const sourceFilePath = path.join(tempDir, 'dummy.txt');
      fs.writeFileSync(sourceFilePath, 'hello');

      await expect(
        service.uploadEvidence(
          project1Id,
          {
            path: sourceFilePath,
            originalname: 'dummy.txt',
            size: 5
          },
          { progressUpdateId: 'non-existent-update-id' }
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('should reject upload when progress report belongs to another project', async () => {
      const sourceFilePath = path.join(tempDir, 'dummy.txt');
      fs.writeFileSync(sourceFilePath, 'hello');

      await expect(
        service.uploadEvidence(
          project1Id,
          {
            path: sourceFilePath,
            originalname: 'dummy.txt',
            size: 5
          },
          { progressUpdateId: update2Id } // update2 belongs to project 2!
        )
      ).rejects.toThrow(ValidationError);
    });

    it('should clean up physical file when database insertion fails', async () => {
      const sourceFilePath = path.join(tempDir, 'fail_test.pdf');
      fs.writeFileSync(sourceFilePath, 'FAIL-TEST-CONTENT');

      // Mock repository that throws DB error during createWithEvent
      const mockRepo: SqliteEvidenceRepository = Object.assign(
        Object.create(evidenceRepo),
        {
          createWithEvent: () => {
            throw new Error('SQLite database lock timeout failure');
          }
        }
      );

      const failingService = new DefaultEvidenceService(
        mockRepo,
        projectRepo,
        progressUpdateRepo,
        activityRepo,
        testUploadRoot
      );

      await expect(
        failingService.uploadEvidence(project1Id, {
          path: sourceFilePath,
          originalname: 'fail_test.pdf',
          size: 17
        })
      ).rejects.toThrow('SQLite database lock timeout failure');

      // Verify that no orphaned file remains in project directory
      const projectDir = path.resolve(testUploadRoot, project1Id);
      if (fs.existsSync(projectDir)) {
        const files = fs.readdirSync(projectDir);
        expect(files).toHaveLength(0);
      }
    });
  });

  describe('listProjectEvidence and getEvidence', () => {
    it('should retrieve project evidence and single record', async () => {
      const source1 = path.join(tempDir, 'file1.txt');
      fs.writeFileSync(source1, 'content 1');

      const source2 = path.join(tempDir, 'file2.txt');
      fs.writeFileSync(source2, 'content 2');

      const ev1 = await service.uploadEvidence(project1Id, {
        path: source1,
        originalname: 'file1.txt',
        size: 9
      });

      const ev2 = await service.uploadEvidence(project1Id, {
        path: source2,
        originalname: 'file2.txt',
        size: 9
      });

      const list = service.listProjectEvidence(project1Id);
      expect(list).toHaveLength(2);

      const single = service.getEvidence(project1Id, ev1.id);
      expect(single.id).toBe(ev1.id);
      expect(single.fileName).toBe('file1.txt');
    });

    it('should throw NotFoundError when fetching evidence of another project', async () => {
      const source = path.join(tempDir, 'p1_only.txt');
      fs.writeFileSync(source, 'secret');

      const ev = await service.uploadEvidence(project1Id, {
        path: source,
        originalname: 'p1_only.txt',
        size: 6
      });

      expect(() => {
        service.getEvidence(project2Id, ev.id);
      }).toThrow(NotFoundError);
    });
  });

  describe('getEvidenceContent', () => {
    it('should throw NotFoundError if physical file is missing from disk', async () => {
      const source = path.join(tempDir, 'ghost.pdf');
      fs.writeFileSync(source, 'ghost');

      const ev = await service.uploadEvidence(project1Id, {
        path: source,
        originalname: 'ghost.pdf',
        size: 5
      });

      // Manually remove file from disk
      const physicalPath = path.resolve(testUploadRoot, ev.filePath);
      if (fs.existsSync(physicalPath)) {
        fs.unlinkSync(physicalPath);
      }

      expect(() => {
        service.getEvidenceContent(project1Id, ev.id);
      }).toThrow(NotFoundError);
    });
  });

  describe('listProgressUpdateEvidence and listActivityEvidence', () => {
    it('should list evidence for progress update and trace evidence for activity', async () => {
      const source = path.join(tempDir, 'progress_evidence.jpg');
      fs.writeFileSync(source, 'IMAGE-DATA');

      const ev = await service.uploadEvidence(
        project1Id,
        {
          path: source,
          originalname: 'progress_evidence.jpg',
          size: 10
        },
        { progressUpdateId: update1Id }
      );

      const updateEvidence = service.listProgressUpdateEvidence(project1Id, update1Id);
      expect(updateEvidence).toHaveLength(1);
      expect(updateEvidence[0].id).toBe(ev.id);

      // Create schedule and activity
      const sched = scheduleRepo.create({
        projectId: project1Id,
        name: 'Metro Sched',
        version: '1',
        sourceType: 'manual'
      });

      const act = activityRepo.create({
        projectId: project1Id,
        scheduleId: sched.id,
        externalId: 'ACT-GIRDER-4',
        name: 'Girder Launch Station 4',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-30'
      });

      // Link via activity progress
      const actProgressRepo = new (await import('../src/repositories/activity-progress.repository.js')).SqliteActivityProgressRepository();
      actProgressRepo.create({
        projectId: project1Id,
        activityId: act.id,
        progressUpdateId: update1Id,
        actualPercent: 50,
        asOfDate: '2026-08-22',
        status: 'in_progress'
      });

      const actEvidence = service.listActivityEvidence(project1Id, act.id);
      expect(actEvidence).toHaveLength(1);
      expect(actEvidence[0].id).toBe(ev.id);
    });
  });

  describe('deleteEvidence', () => {
    it('should delete evidence record and unlink physical file from disk', async () => {
      const source = path.join(tempDir, 'delete_target.txt');
      fs.writeFileSync(source, 'delete me');

      const ev = await service.uploadEvidence(project1Id, {
        path: source,
        originalname: 'delete_target.txt',
        size: 9
      });

      const physicalPath = path.resolve(testUploadRoot, ev.filePath);
      expect(fs.existsSync(physicalPath)).toBe(true);

      const deleted = service.deleteEvidence(project1Id, ev.id);
      expect(deleted).toBe(true);
      expect(fs.existsSync(physicalPath)).toBe(false);

      expect(() => {
        service.getEvidence(project1Id, ev.id);
      }).toThrow(NotFoundError);
    });

    it('should safely roll back and preserve physical file when DB deletion fails', async () => {
      const source = path.join(tempDir, 'preserve_me.pdf');
      fs.writeFileSync(source, 'IMPORTANT-EVIDENCE-PAYLOAD');

      const ev = await service.uploadEvidence(project1Id, {
        path: source,
        originalname: 'preserve_me.pdf',
        size: 26
      });

      const physicalPath = path.resolve(testUploadRoot, ev.filePath);
      expect(fs.existsSync(physicalPath)).toBe(true);

      // Create a service instance with a failing evidence repository delete
      const failingRepo: SqliteEvidenceRepository = Object.assign(
        Object.create(evidenceRepo),
        {
          deleteByIdAndProjectId: () => {
            throw new Error('Simulated SQLite disk I/O failure during delete');
          }
        }
      );

      const failingService = new DefaultEvidenceService(
        failingRepo,
        projectRepo,
        progressUpdateRepo,
        activityRepo,
        testUploadRoot
      );

      // Attempt deletion: should throw and NOT silently report success
      expect(() => {
        failingService.deleteEvidence(project1Id, ev.id);
      }).toThrow('Simulated SQLite disk I/O failure during delete');

      // Crucial assertion: Physical file must still exist and contain original content (not missing)
      expect(fs.existsSync(physicalPath)).toBe(true);
      expect(fs.readFileSync(physicalPath, 'utf-8')).toBe('IMPORTANT-EVIDENCE-PAYLOAD');

      // No stray .trash files left in the directory
      const projectDir = path.resolve(testUploadRoot, project1Id);
      const directoryFiles = fs.readdirSync(projectDir);
      const trashFiles = directoryFiles.filter((f) => f.endsWith('.trash'));
      expect(trashFiles).toHaveLength(0);
    });
  });
});
