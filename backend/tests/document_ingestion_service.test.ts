import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { projectRepository } from '../src/repositories/project.repository.js';
import { scheduleRepository } from '../src/repositories/schedule.repository.js';
import { activityRepository } from '../src/repositories/activity.repository.js';
import { evidenceRepository } from '../src/repositories/evidence.repository.js';
import { progressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { activityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { DefaultEvidenceService } from '../src/services/evidence/evidence.service.js';
import { DefaultDocumentIngestionService } from '../src/services/ingestion/document-ingestion.service.js';
import { ActivityMatchingService } from '../src/services/matching/activity-matching.service.js';
import { FieldProgressExtractionService } from '../src/ai/services/field-progress-extraction.service.js';
import { AIService } from '../src/ai/services/ai.service.js';
import { MockAIProvider } from '../src/ai/providers/mock-ai.provider.js';
import { NotFoundError, ValidationError, DatabaseError } from '../src/errors/AppError.js';
import { OcrExtractor, OcrEngine } from '../src/services/ingestion/extractors/ocr.extractor.js';
import { PdfExtractor } from '../src/services/ingestion/extractors/pdf.extractor.js';
import { CsvExtractor } from '../src/services/ingestion/extractors/csv.extractor.js';
import { XlsxExtractor } from '../src/services/ingestion/extractors/xlsx.extractor.js';
import { TextExtractor } from '../src/services/ingestion/extractors/text.extractor.js';

class MockOcrEngine implements OcrEngine {
  async recognize(_imageBuffer: Buffer) {
    return { text: 'Concrete pour batch 4519 100 m3 Pier P1 Zone A in progress', confidence: 0.95 };
  }
}

describe('DocumentIngestionService', () => {
  let projectId: string;
  let activityId: string;
  let evidenceService: DefaultEvidenceService;
  let ingestionService: DefaultDocumentIngestionService;
  let mockAiProvider: MockAIProvider;
  let matchingService: ActivityMatchingService;

  const testUploadDir = 'test-ingestion-uploads';
  const projectUploadPath = path.resolve(process.cwd(), testUploadDir);

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });

    if (!fs.existsSync(projectUploadPath)) {
      fs.mkdirSync(projectUploadPath, { recursive: true });
    }

    const project = projectRepository.create({
      name: 'Bandra-Worli Sea Link Extension',
      code: 'BWSL-EXT'
    });
    projectId = project.id;

    // Create a schedule and activity for matching tests
    const sched = scheduleRepository.create({
      projectId,
      name: 'Baseline Schedule',
      sourceFileName: 'baseline.csv',
      sourceType: 'csv',
      status: 'active'
    });

    const act = activityRepository.create({
      projectId,
      scheduleId: sched.id,
      externalId: 'ACT-P1-POUR',
      name: 'Pier P1 substructure concrete pour',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-30',
      plannedQuantity: 1000,
      unit: 'm3'
    });
    activityId = act.id;

    evidenceService = new DefaultEvidenceService(
      evidenceRepository,
      projectRepository,
      progressUpdateRepository,
      undefined,
      testUploadDir
    );

    mockAiProvider = new MockAIProvider({
      mockStructuredResponse: {
        items: [
          {
            reference: 'Pier P1 substructure concrete pour',
            location: 'Zone A',
            progress_percent: 60,
            status: 'in_progress'
          }
        ]
      }
    });

    const mockAiService: AIService = {
      generateText: async (prompt, opts) => mockAiProvider.generateText(prompt, opts),
      extractStructured: async (prompt, schema, opts) =>
        mockAiProvider.generateStructured(prompt, schema, opts) as any
    };

    const extractionService = new FieldProgressExtractionService(mockAiService);

    matchingService = new ActivityMatchingService({
      projectRepo: projectRepository,
      progressUpdateRepo: progressUpdateRepository,
      activityRepo: activityRepository,
      activityMatchRepo: activityMatchRepository
    });

    const customOcr = new OcrExtractor(new MockOcrEngine());
    const customPdf = new PdfExtractor(customOcr);

    ingestionService = new DefaultDocumentIngestionService({
      evidenceRepo: evidenceRepository,
      evidenceService,
      projectRepo: projectRepository,
      progressUpdateRepo: progressUpdateRepository,
      extractionService,
      matchingService,
      extractors: [
        new CsvExtractor(),
        new XlsxExtractor(),
        customPdf,
        customOcr,
        new TextExtractor()
      ]
    });
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(projectUploadPath)) {
      try {
        fs.rmSync(projectUploadPath, { recursive: true, force: true });
      } catch {
        // Ignore test cleanup
      }
    }
  });

  it('should process CSV evidence, create ProgressUpdate, link evidence, extract facts, and generate suggested matches', async () => {
    const tempCsvPath = path.join(projectUploadPath, 'temp_report.csv');
    fs.writeFileSync(
      tempCsvPath,
      'Report Date: 2026-08-25\nDate,Work Item,Location,Progress,Status\n2026-08-25,Pier P1 Pour,Zone A,60%,in_progress'
    );

    const evidence = await evidenceService.uploadEvidence(projectId, {
      originalname: 'field_report.csv',
      path: tempCsvPath,
      size: fs.statSync(tempCsvPath).size,
      mimetype: 'text/csv'
    });

    const result = await ingestionService.processEvidence(projectId, evidence.id);

    expect(result.evidence.id).toBe(evidence.id);
    expect(result.evidence.progressUpdateId).toBe(result.progressUpdate.id);
    expect(result.normalizedDocument.sourceType).toBe('csv');
    expect(result.progressUpdate.projectId).toBe(projectId);
    expect(result.progressUpdate.reportDate).toBe('2026-08-25');
    expect(result.progressUpdate.sourceType).toBe('text');
    expect(result.progressUpdate.rawText).toContain('Pier P1 Pour');

    expect(result.extraction.items).toHaveLength(1);
    expect(result.extraction.items[0].reference).toBe('Pier P1 substructure concrete pour');

    // Verify suggested match was returned and persisted
    expect(result.matches).toBeDefined();
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].bestMatch).not.toBeNull();
    expect(result.matches[0].bestMatch?.activityName).toBe('Pier P1 substructure concrete pour');

    const persistedMatches = activityMatchRepository.listByProgressUpdateId(result.progressUpdate.id);
    expect(persistedMatches.length).toBeGreaterThan(0);
    expect(persistedMatches[0].status).toBe('suggested');

    // Verify DB state
    const savedUpdate = progressUpdateRepository.getByIdAndProjectId(result.progressUpdate.id, projectId);
    expect(savedUpdate).not.toBeNull();
    expect(savedUpdate?.reportDate).toBe('2026-08-25');

    const savedEvidence = evidenceRepository.getByIdAndProjectId(evidence.id, projectId);
    expect(savedEvidence?.progressUpdateId).toBe(result.progressUpdate.id);
  });

  it('should preserve explicit report date from document rather than current date', async () => {
    const tempTxtPath = path.join(projectUploadPath, 'memo.txt');
    fs.writeFileSync(
      tempTxtPath,
      'DAILY SITE REPORT\nReport Date: 2026-08-15\nLocation: Zone A\nPier P1 Concrete: 60%'
    );

    const evidence = await evidenceService.uploadEvidence(projectId, {
      originalname: 'memo.txt',
      path: tempTxtPath,
      size: fs.statSync(tempTxtPath).size,
      mimetype: 'text/plain'
    });

    const result = await ingestionService.processEvidence(projectId, evidence.id);
    expect(result.progressUpdate.reportDate).toBe('2026-08-15');
  });

  it('should not persist any ProgressUpdate if AI extraction fails', async () => {
    // Failing AI extraction service
    const failingAiService: AIService = {
      generateText: async () => { throw new Error('AI Provider Offline'); },
      extractStructured: async () => { throw new Error('AI Provider Extraction Error'); }
    };
    const failingExtractionService = new FieldProgressExtractionService(failingAiService);

    const failingIngestionService = new DefaultDocumentIngestionService({
      evidenceRepo: evidenceRepository,
      evidenceService,
      projectRepo: projectRepository,
      progressUpdateRepo: progressUpdateRepository,
      extractionService: failingExtractionService,
      matchingService
    });

    const tempTxtPath = path.join(projectUploadPath, 'memo2.txt');
    fs.writeFileSync(tempTxtPath, 'Site memo content for failure test');

    const evidence = await evidenceService.uploadEvidence(projectId, {
      originalname: 'memo2.txt',
      path: tempTxtPath,
      size: fs.statSync(tempTxtPath).size,
      mimetype: 'text/plain'
    });

    // Expect processEvidence to throw
    await expect(
      failingIngestionService.processEvidence(projectId, evidence.id)
    ).rejects.toThrow('AI Provider Extraction Error');

    // Verify ProgressUpdate table has 0 records created for this project
    const updates = progressUpdateRepository.listByProjectId(projectId);
    expect(updates).toHaveLength(0);

    // Verify Evidence remains intact without a progressUpdateId
    const unchangedEvidence = evidenceRepository.getByIdAndProjectId(evidence.id, projectId);
    expect(unchangedEvidence?.progressUpdateId).toBeNull();
  });

  it('should rollback and delete created ProgressUpdate if evidence attachment fails', async () => {
    // Mock evidence repository whose attachToProgressUpdate always fails
    const failingEvidenceRepo = Object.create(evidenceRepository);
    failingEvidenceRepo.attachToProgressUpdate = () => false; // simulated attachment failure

    const failingAttachIngestionService = new DefaultDocumentIngestionService({
      evidenceRepo: failingEvidenceRepo,
      evidenceService,
      projectRepo: projectRepository,
      progressUpdateRepo: progressUpdateRepository,
      extractionService: new FieldProgressExtractionService({
        generateText: async () => 'OK',
        extractStructured: async () => ({ items: [] }) as any
      }),
      matchingService
    });

    const tempTxtPath = path.join(projectUploadPath, 'memo3.txt');
    fs.writeFileSync(tempTxtPath, 'Site memo for attach failure rollback test');

    const evidence = await evidenceService.uploadEvidence(projectId, {
      originalname: 'memo3.txt',
      path: tempTxtPath,
      size: fs.statSync(tempTxtPath).size,
      mimetype: 'text/plain'
    });

    await expect(
      failingAttachIngestionService.processEvidence(projectId, evidence.id)
    ).rejects.toThrow(DatabaseError);

    // Verify created ProgressUpdate was deleted / rolled back
    const updates = progressUpdateRepository.listByProjectId(projectId);
    expect(updates).toHaveLength(0);

    // Verify Evidence remains intact without link
    const unchangedEvidence = evidenceRepository.getByIdAndProjectId(evidence.id, projectId);
    expect(unchangedEvidence?.progressUpdateId).toBeNull();
  });

  it('should throw NotFoundError for non-existent evidence', async () => {
    await expect(
      ingestionService.processEvidence(projectId, 'non-existent-evidence-id')
    ).rejects.toThrow(NotFoundError);
  });
});
