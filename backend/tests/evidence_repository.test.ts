import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteEvidenceRepository } from '../src/repositories/evidence.repository.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { ConflictError, DatabaseError } from '../src/errors/AppError.js';

describe('SqliteEvidenceRepository', () => {
  let evidenceRepo: SqliteEvidenceRepository;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let progressUpdateRepo: SqliteProgressUpdateRepository;
  let matchRepo: SqliteActivityMatchRepository;
  let activityProgressRepo: SqliteActivityProgressRepository;

  let project1Id: string;
  let project2Id: string;
  let update1Id: string;
  let update2Id: string;

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });
    evidenceRepo = new SqliteEvidenceRepository();
    projectRepo = new SqliteProjectRepository();
    scheduleRepo = new SqliteScheduleRepository();
    activityRepo = new SqliteActivityRepository();
    progressUpdateRepo = new SqliteProgressUpdateRepository();
    matchRepo = new SqliteActivityMatchRepository();
    activityProgressRepo = new SqliteActivityProgressRepository();

    const p1 = projectRepo.create({ name: 'Bandra-Worli Sea Link', code: 'BWSL-01' });
    project1Id = p1.id;

    const p2 = projectRepo.create({ name: 'Delhi Metro Phase 4', code: 'DMP4-02' });
    project2Id = p2.id;

    const u1 = progressUpdateRepo.create({
      projectId: project1Id,
      reportDate: '2026-08-20',
      rawText: 'Pier P-12 concrete pour complete.',
      sourceType: 'manual'
    });
    update1Id = u1.id;

    const u2 = progressUpdateRepo.create({
      projectId: project2Id,
      reportDate: '2026-08-21',
      rawText: 'Tunnel boring machine arrived.',
      sourceType: 'manual'
    });
    update2Id = u2.id;
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('create and getById', () => {
    it('should create an evidence record and retrieve it by id', () => {
      const created = evidenceRepo.create({
        projectId: project1Id,
        progressUpdateId: update1Id,
        fileName: 'site_photo_p12.jpg',
        filePath: `${project1Id}/site_photo_p12.jpg`,
        fileType: 'image',
        fileSizeBytes: 2048576,
        mimeType: 'image/jpeg',
        metadataJson: JSON.stringify({ camera: 'Sony A7IV', gps: '19.03,72.82' })
      });

      expect(created.id).toBeDefined();
      expect(created.projectId).toBe(project1Id);
      expect(created.progressUpdateId).toBe(update1Id);
      expect(created.fileName).toBe('site_photo_p12.jpg');
      expect(created.fileType).toBe('image');
      expect(created.fileSizeBytes).toBe(2048576);
      expect(created.mimeType).toBe('image/jpeg');
      expect(created.metadataJson).toContain('Sony A7IV');
      expect(created.uploadedAt).toBeDefined();
      expect(created.createdAt).toBeDefined();

      const retrieved = evidenceRepo.getById(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.fileName).toBe('site_photo_p12.jpg');
    });

    it('should return null for non-existent evidence id', () => {
      const nonExistent = evidenceRepo.getById('non-existent-id-12345');
      expect(nonExistent).toBeNull();
    });

    it('should support unattached evidence without progressUpdateId', () => {
      const created = evidenceRepo.create({
        projectId: project1Id,
        fileName: 'general_specifications.pdf',
        filePath: `${project1Id}/general_specifications.pdf`,
        fileType: 'pdf',
        fileSizeBytes: 102400,
        mimeType: 'application/pdf'
      });

      expect(created.progressUpdateId).toBeNull();
      expect(created.fileType).toBe('pdf');
    });
  });

  describe('getByIdAndProjectId', () => {
    it('should return evidence when both id and projectId match', () => {
      const created = evidenceRepo.create({
        projectId: project1Id,
        fileName: 'soil_test_report.xlsx',
        filePath: `${project1Id}/soil_test.xlsx`,
        fileType: 'xlsx'
      });

      const found = evidenceRepo.getByIdAndProjectId(created.id, project1Id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });

    it('should return null when querying with a mismatched foreign projectId', () => {
      const created = evidenceRepo.create({
        projectId: project1Id,
        fileName: 'soil_test_report.xlsx',
        filePath: `${project1Id}/soil_test.xlsx`,
        fileType: 'xlsx'
      });

      const found = evidenceRepo.getByIdAndProjectId(created.id, project2Id);
      expect(found).toBeNull();
    });
  });

  describe('createWithEvent (atomic transaction)', () => {
    it('should insert evidence and project_events atomically', () => {
      const evidenceId = crypto.randomUUID();
      const eventId = crypto.randomUUID();

      const created = evidenceRepo.createWithEvent(
        {
          id: evidenceId,
          projectId: project1Id,
          progressUpdateId: update1Id,
          fileName: 'daily_site_log.pdf',
          filePath: `${project1Id}/daily_site_log.pdf`,
          fileType: 'pdf',
          fileSizeBytes: 54321,
          mimeType: 'application/pdf'
        },
        {
          id: eventId,
          projectId: project1Id,
          eventType: 'evidence_uploaded',
          entityType: 'evidence',
          entityId: evidenceId,
          summary: 'Evidence uploaded: daily_site_log.pdf',
          payloadJson: JSON.stringify({ fileName: 'daily_site_log.pdf', size: 54321 })
        }
      );

      expect(created.id).toBe(evidenceId);

      // Verify event was recorded in SQLite
      const db = getDatabase();
      const eventRow = db.prepare('SELECT * FROM project_events WHERE id = ?').get(eventId) as {
        event_type: string;
        entity_id: string;
        summary: string;
      };

      expect(eventRow).toBeDefined();
      expect(eventRow.event_type).toBe('evidence_uploaded');
      expect(eventRow.entity_id).toBe(evidenceId);
      expect(eventRow.summary).toBe('Evidence uploaded: daily_site_log.pdf');
    });
  });

  describe('listByProjectId and countByProjectId', () => {
    it('should list evidence strictly scoped to the project', () => {
      evidenceRepo.create({
        projectId: project1Id,
        fileName: 'p1_file1.txt',
        filePath: `${project1Id}/p1_file1.txt`,
        fileType: 'text'
      });

      evidenceRepo.create({
        projectId: project1Id,
        fileName: 'p1_file2.png',
        filePath: `${project1Id}/p1_file2.png`,
        fileType: 'image'
      });

      evidenceRepo.create({
        projectId: project2Id,
        fileName: 'p2_file1.pdf',
        filePath: `${project2Id}/p2_file1.pdf`,
        fileType: 'pdf'
      });

      const p1List = evidenceRepo.listByProjectId(project1Id);
      expect(p1List).toHaveLength(2);
      expect(p1List.map((e) => e.fileName)).toEqual(
        expect.arrayContaining(['p1_file1.txt', 'p1_file2.png'])
      );

      const p2List = evidenceRepo.listByProjectId(project2Id);
      expect(p2List).toHaveLength(1);
      expect(p2List[0].fileName).toBe('p2_file1.pdf');

      expect(evidenceRepo.countByProjectId(project1Id)).toBe(2);
      expect(evidenceRepo.countByProjectId(project2Id)).toBe(1);
    });
  });

  describe('listByProgressUpdateId', () => {
    it('should return multiple evidence records attached to the same progress update', () => {
      const e1 = evidenceRepo.create({
        projectId: project1Id,
        progressUpdateId: update1Id,
        fileName: 'report_part1.pdf',
        filePath: `${project1Id}/report_part1.pdf`,
        fileType: 'pdf'
      });

      const e2 = evidenceRepo.create({
        projectId: project1Id,
        progressUpdateId: update1Id,
        fileName: 'report_part2.jpg',
        filePath: `${project1Id}/report_part2.jpg`,
        fileType: 'image'
      });

      const list = evidenceRepo.listByProgressUpdateId(update1Id, project1Id);
      expect(list).toHaveLength(2);
      expect(list.map((e) => e.id)).toEqual(expect.arrayContaining([e1.id, e2.id]));
    });

    it('should return empty array for an update without evidence', () => {
      const list = evidenceRepo.listByProgressUpdateId('non-existent-update', project1Id);
      expect(list).toHaveLength(0);
    });
  });

  describe('listByActivityId (Traceability Query)', () => {
    it('should trace evidence linked via ActivityMatch and ActivityProgress', () => {
      // 1. Create schedule and activity in Project 1
      const sched = scheduleRepo.create({
        projectId: project1Id,
        name: 'Master Baseline',
        version: '1.0',
        sourceType: 'manual'
      });

      const activity = activityRepo.create({
        projectId: project1Id,
        scheduleId: sched.id,
        externalId: 'ACT-PIER-12',
        name: 'Cast Pier P-12 Foundation',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-30',
        plannedQuantity: 100,
        unit: 'm3'
      });

      // 2. Evidence 1: Linked via ActivityMatch.evidenceId
      const evDirectMatch = evidenceRepo.create({
        projectId: project1Id,
        progressUpdateId: update1Id,
        fileName: 'concrete_test_cert.pdf',
        filePath: `${project1Id}/concrete_test_cert.pdf`,
        fileType: 'pdf'
      });

      matchRepo.create({
        projectId: project1Id,
        progressUpdateId: update1Id,
        evidenceId: evDirectMatch.id,
        activityId: activity.id,
        confidenceScore: 0.95,
        matchMethod: 'exact_id',
        status: 'confirmed'
      });

      // 3. Evidence 2: Linked via ActivityProgress -> progressUpdateId -> Evidence
      const u1b = progressUpdateRepo.create({
        projectId: project1Id,
        reportDate: '2026-08-25',
        rawText: 'Pier P-12 reached 80% completion.'
      });

      const evViaProgress = evidenceRepo.create({
        projectId: project1Id,
        progressUpdateId: u1b.id,
        fileName: 'site_drone_survey.jpg',
        filePath: `${project1Id}/site_drone_survey.jpg`,
        fileType: 'image'
      });

      activityProgressRepo.create({
        projectId: project1Id,
        activityId: activity.id,
        progressUpdateId: u1b.id,
        actualPercent: 80,
        actualQuantity: 80,
        asOfDate: '2026-08-25',
        status: 'in_progress'
      });

      // Query traceability for this activity
      const activityEvidence = evidenceRepo.listByActivityId(activity.id, project1Id);
      expect(activityEvidence).toHaveLength(2);
      expect(activityEvidence.map((e) => e.fileName)).toEqual(
        expect.arrayContaining(['concrete_test_cert.pdf', 'site_drone_survey.jpg'])
      );
    });

    it('should NOT return evidence linked via rejected or suggested activity matches', () => {
      const sched = scheduleRepo.create({
        projectId: project1Id,
        name: 'Master Baseline',
        version: '1.0',
        sourceType: 'manual'
      });

      const activity = activityRepo.create({
        projectId: project1Id,
        scheduleId: sched.id,
        externalId: 'ACT-REJECT-TEST',
        name: 'Excavation Test Block',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-10'
      });

      // Update 1 with Evidence E1 (linked to rejected match)
      const uRejected = progressUpdateRepo.create({
        projectId: project1Id,
        reportDate: '2026-08-02',
        rawText: 'Rejected match progress update'
      });

      const evRejected = evidenceRepo.create({
        projectId: project1Id,
        progressUpdateId: uRejected.id,
        fileName: 'rejected_inspection.pdf',
        filePath: `${project1Id}/rejected_inspection.pdf`,
        fileType: 'pdf'
      });

      matchRepo.create({
        projectId: project1Id,
        progressUpdateId: uRejected.id,
        evidenceId: evRejected.id,
        activityId: activity.id,
        confidenceScore: 0.2,
        matchMethod: 'text_similarity',
        status: 'rejected'
      });

      // Update 2 with Evidence E2 (linked to suggested match)
      const uSuggested = progressUpdateRepo.create({
        projectId: project1Id,
        reportDate: '2026-08-03',
        rawText: 'Suggested match progress update'
      });

      const evSuggested = evidenceRepo.create({
        projectId: project1Id,
        progressUpdateId: uSuggested.id,
        fileName: 'suggested_photo.jpg',
        filePath: `${project1Id}/suggested_photo.jpg`,
        fileType: 'image'
      });

      matchRepo.create({
        projectId: project1Id,
        progressUpdateId: uSuggested.id,
        evidenceId: evSuggested.id,
        activityId: activity.id,
        confidenceScore: 0.6,
        matchMethod: 'text_similarity',
        status: 'suggested'
      });

      // Query activity evidence: rejected and suggested must NOT appear
      const results = evidenceRepo.listByActivityId(activity.id, project1Id);
      expect(results).toHaveLength(0);

      // Now confirm the suggested match and verify it immediately becomes traceable
      const db = getDatabase();
      db.prepare("UPDATE activity_matches SET status = 'confirmed' WHERE progress_update_id = ?").run(uSuggested.id);

      const confirmedResults = evidenceRepo.listByActivityId(activity.id, project1Id);
      expect(confirmedResults).toHaveLength(1);
      expect(confirmedResults[0].id).toBe(evSuggested.id);
      expect(confirmedResults[0].fileName).toBe('suggested_photo.jpg');
    });
  });

  describe('delete', () => {
    it('should delete evidence record by id and projectId', () => {
      const created = evidenceRepo.create({
        projectId: project1Id,
        fileName: 'to_delete.txt',
        filePath: `${project1Id}/to_delete.txt`,
        fileType: 'text'
      });

      const deleted = evidenceRepo.deleteByIdAndProjectId(created.id, project1Id);
      expect(deleted).toBe(true);

      const found = evidenceRepo.getById(created.id);
      expect(found).toBeNull();
    });

    it('should not delete evidence when foreign projectId is provided', () => {
      const created = evidenceRepo.create({
        projectId: project1Id,
        fileName: 'keep_me.txt',
        filePath: `${project1Id}/keep_me.txt`,
        fileType: 'text'
      });

      const deleted = evidenceRepo.deleteByIdAndProjectId(created.id, project2Id);
      expect(deleted).toBe(false);

      const found = evidenceRepo.getById(created.id);
      expect(found).not.toBeNull();
    });
  });

  describe('database constraints and cross-project trigger integrity', () => {
    it('should reject associating Project 1 evidence with Project 2 progress update', () => {
      expect(() => {
        evidenceRepo.create({
          projectId: project1Id,
          progressUpdateId: update2Id, // update2 belongs to Project 2!
          fileName: 'cross_project_violation.pdf',
          filePath: `${project1Id}/cross_project_violation.pdf`,
          fileType: 'pdf'
        });
      }).toThrow();
    });

    it('should reject duplicate explicit evidence IDs', () => {
      const fixedId = crypto.randomUUID();
      evidenceRepo.create({
        id: fixedId,
        projectId: project1Id,
        fileName: 'file_a.txt',
        filePath: `${project1Id}/file_a.txt`,
        fileType: 'text'
      });

      expect(() => {
        evidenceRepo.create({
          id: fixedId,
          projectId: project1Id,
          fileName: 'file_b.txt',
          filePath: `${project1Id}/file_b.txt`,
          fileType: 'text'
        });
      }).toThrow(ConflictError);
    });
  });
});
