import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { DefaultProgressUpdateService } from '../src/services/progress-update.service.js';
import { NotFoundError, ValidationError } from '../src/errors/AppError.js';

describe('DefaultProgressUpdateService', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let updateRepo: SqliteProgressUpdateRepository;
  let service: DefaultProgressUpdateService;
  let testProjectId: string;
  let testProject2Id: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    projectRepo = new SqliteProjectRepository(() => db);
    updateRepo = new SqliteProgressUpdateRepository(() => db);
    service = new DefaultProgressUpdateService(updateRepo, projectRepo);

    const p1 = projectRepo.create({
      name: 'Delhi Metro Phase 4',
      code: 'DMRC-P4',
      status: 'active'
    });
    testProjectId = p1.id;

    const p2 = projectRepo.create({
      name: 'Bengaluru Metro Line 6',
      code: 'BMRCL-L6',
      status: 'active'
    });
    testProject2Id = p2.id;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('createManualUpdate', () => {
    it('should successfully create a manual update forcing sourceType=manual and status=received', () => {
      const rawText = '  Foundation work at Block B is 60% complete.\nConcrete pouring started today.  ';
      const update = service.createManualUpdate({
        projectId: testProjectId,
        reportDate: '2026-08-26',
        reporterName: '  Karan Patel  ',
        reporterRole: '  Chief Inspector  ',
        rawText
      });

      expect(update).toBeDefined();
      expect(update.id).toBeDefined();
      expect(update.projectId).toBe(testProjectId);
      expect(update.reportDate).toBe('2026-08-26');
      expect(update.sourceType).toBe('manual');
      expect(update.status).toBe('received');
      // Verify raw text is preserved exactly without rewriting or extracting 60%
      expect(update.rawText).toBe(rawText);
      // Verify reporter fields are trimmed
      expect(update.reporterName).toBe('Karan Patel');
      expect(update.reporterRole).toBe('Chief Inspector');
    });

    it('should throw NotFoundError if the project does not exist', () => {
      expect(() => {
        service.createManualUpdate({
          projectId: 'non-existent-proj-uuid',
          reportDate: '2026-08-26',
          rawText: 'Valid text'
        });
      }).toThrow(NotFoundError);
    });

    it('should throw ValidationError if rawText is empty or whitespace-only', () => {
      expect(() => {
        service.createManualUpdate({
          projectId: testProjectId,
          reportDate: '2026-08-26',
          rawText: ''
        });
      }).toThrow(ValidationError);

      expect(() => {
        service.createManualUpdate({
          projectId: testProjectId,
          reportDate: '2026-08-26',
          rawText: '    \n\t   '
        });
      }).toThrow(ValidationError);
    });

    it('should throw ValidationError if rawText exceeds maximum limit', () => {
      const massiveText = 'A'.repeat(50001);
      expect(() => {
        service.createManualUpdate({
          projectId: testProjectId,
          reportDate: '2026-08-26',
          rawText: massiveText
        });
      }).toThrow(ValidationError);
    });

    it('should throw ValidationError if reportDate format is invalid', () => {
      expect(() => {
        service.createManualUpdate({
          projectId: testProjectId,
          reportDate: 'invalid-date',
          rawText: 'Valid text'
        });
      }).toThrow(ValidationError);

      expect(() => {
        service.createManualUpdate({
          projectId: testProjectId,
          reportDate: '26-08-2026',
          rawText: 'Valid text'
        });
      }).toThrow(ValidationError);
    });

    it('should throw ValidationError if reporterName is provided as whitespace only', () => {
      expect(() => {
        service.createManualUpdate({
          projectId: testProjectId,
          reportDate: '2026-08-26',
          reporterName: '   ',
          rawText: 'Valid text'
        });
      }).toThrow(ValidationError);
    });

    it('should accept null/undefined reporter name and role', () => {
      const update = service.createManualUpdate({
        projectId: testProjectId,
        reportDate: '2026-08-26',
        rawText: 'Anonymous report'
      });

      expect(update.reporterName).toBeNull();
      expect(update.reporterRole).toBeNull();
    });
  });

  describe('listProjectUpdates', () => {
    it('should list updates for a valid project', () => {
      service.createManualUpdate({
        projectId: testProjectId,
        reportDate: '2026-08-20',
        rawText: 'Report 1'
      });
      service.createManualUpdate({
        projectId: testProjectId,
        reportDate: '2026-08-25',
        rawText: 'Report 2'
      });

      const updates = service.listProjectUpdates(testProjectId);
      expect(updates).toHaveLength(2);
      expect(updates[0].rawText).toBe('Report 2');
      expect(updates[1].rawText).toBe('Report 1');
    });

    it('should throw NotFoundError if project does not exist', () => {
      expect(() => {
        service.listProjectUpdates('unknown-proj');
      }).toThrow(NotFoundError);
    });
  });

  describe('getProjectUpdate', () => {
    it('should retrieve a project update when project and ID match', () => {
      const created = service.createManualUpdate({
        projectId: testProjectId,
        reportDate: '2026-08-26',
        rawText: 'Test report'
      });

      const retrieved = service.getProjectUpdate(testProjectId, created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.projectId).toBe(testProjectId);
    });

    it('should throw NotFoundError when project does not exist', () => {
      expect(() => {
        service.getProjectUpdate('unknown-proj', 'some-id');
      }).toThrow(NotFoundError);
    });

    it('should throw NotFoundError when update ID belongs to another project (strict isolation)', () => {
      const created = service.createManualUpdate({
        projectId: testProjectId,
        reportDate: '2026-08-26',
        rawText: 'Project 1 private update'
      });

      // Querying with project 2 ID must throw NotFoundError and never expose project 1's update
      expect(() => {
        service.getProjectUpdate(testProject2Id, created.id);
      }).toThrow(NotFoundError);
    });
  });
});
