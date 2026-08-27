import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { projectRepository } from '../src/repositories/project.repository.js';
import { evidenceRepository } from '../src/repositories/evidence.repository.js';
import { progressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { DefaultEvidenceService } from '../src/services/evidence/evidence.service.js';
import { DefaultDocumentIngestionService } from '../src/services/ingestion/document-ingestion.service.js';
import { FieldProgressExtractionService } from '../src/ai/services/field-progress-extraction.service.js';
import { AIService } from '../src/ai/services/ai.service.js';
import { MockAIProvider } from '../src/ai/providers/mock-ai.provider.js';
import { NotFoundError, ValidationError } from '../src/errors/AppError.js';
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
  let evidenceService: DefaultEvidenceService;
  let ingestionService: DefaultDocumentIngestionService;
  let mockAiProvider: MockAIProvider;

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

    const customOcr = new OcrExtractor(new MockOcrEngine());
    const customPdf = new PdfExtractor(customOcr);

    ingestionService = new DefaultDocumentIngestionService({
      evidenceRepo: evidenceRepository,
      evidenceService,
      projectRepo: projectRepository,
      progressUpdateRepo: progressUpdateRepository,
      extractionService,
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

  it('should process CSV evidence, create ProgressUpdate, link evidence, and extract facts', async () => {
    // 1. Upload CSV evidence
    const tempCsvPath = path.join(projectUploadPath, 'temp_report.csv');
    fs.writeFileSync(
      tempCsvPath,
      'Date,Work Item,Location,Progress,Status\n2026-08-25,Pier P1 Pour,Zone A,60%,in_progress'
    );

    const evidence = await evidenceService.uploadEvidence(projectId, {
      originalname: 'field_report.csv',
      path: tempCsvPath,
      size: fs.statSync(tempCsvPath).size,
      mimetype: 'text/csv'
    });

    // 2. Process Evidence
    const result = await ingestionService.processEvidence(projectId, evidence.id);

    expect(result.evidence.id).toBe(evidence.id);
    expect(result.evidence.progressUpdateId).toBe(result.progressUpdate.id);
    expect(result.normalizedDocument.sourceType).toBe('csv');
    expect(result.progressUpdate.projectId).toBe(projectId);
    expect(result.progressUpdate.sourceType).toBe('text');
    expect(result.progressUpdate.rawText).toContain('Date | Work Item | Location | Progress | Status');
    expect(result.progressUpdate.rawText).toContain('2026-08-25 | Pier P1 Pour | Zone A | 60% | in_progress');
    expect(result.extraction.items).toHaveLength(1);
    expect(result.extraction.items[0].reference).toBe('Pier P1 substructure concrete pour');

    // 3. Verify DB state
    const savedUpdate = progressUpdateRepository.getByIdAndProjectId(result.progressUpdate.id, projectId);
    expect(savedUpdate).not.toBeNull();
    expect(savedUpdate?.rawText).toBe(result.progressUpdate.rawText);

    const savedEvidence = evidenceRepository.getByIdAndProjectId(evidence.id, projectId);
    expect(savedEvidence?.progressUpdateId).toBe(result.progressUpdate.id);
  });

  it('should process Image evidence using OCR', async () => {
    const tempImgPath = path.join(projectUploadPath, 'ticket.png');
    fs.writeFileSync(tempImgPath, 'MOCK_PNG_IMAGE_BYTES');

    const evidence = await evidenceService.uploadEvidence(projectId, {
      originalname: 'ticket.png',
      path: tempImgPath,
      size: 100,
      mimetype: 'image/png'
    });

    const result = await ingestionService.processEvidence(projectId, evidence.id);

    expect(result.normalizedDocument.sourceType).toBe('image');
    expect(result.progressUpdate.sourceType).toBe('image');
    expect(result.progressUpdate.rawText).toContain('Concrete pour batch 4519 100 m3 Pier P1 Zone A in progress');
    expect(result.extraction.items[0].reference).toBe('Pier P1 substructure concrete pour');
  });

  it('should enforce strict project scoping and isolation', async () => {
    // Project 2
    const otherProject = projectRepository.create({
      name: 'Delhi Metro Phase 4',
      code: 'DMRC-P4'
    });

    const tempPath = path.join(projectUploadPath, 'p2_doc.txt');
    fs.writeFileSync(tempPath, 'Metro pier excavation underway');

    const evidence = await evidenceService.uploadEvidence(otherProject.id, {
      originalname: 'p2_doc.txt',
      path: tempPath,
      size: 30,
      mimetype: 'text/plain'
    });

    // Attempt to process Project 2 evidence from Project 1
    await expect(
      ingestionService.processEvidence(projectId, evidence.id)
    ).rejects.toThrow(NotFoundError);

    // Non-existent project
    await expect(
      ingestionService.processEvidence('non-existent-project-id', evidence.id)
    ).rejects.toThrow(NotFoundError);
  });

  it('should reject unprocessable empty document without creating fake ProgressUpdate', async () => {
    const tempEmptyPath = path.join(projectUploadPath, 'empty.txt');
    fs.writeFileSync(tempEmptyPath, '   \n\t  \n');

    const evidence = await evidenceService.uploadEvidence(projectId, {
      originalname: 'empty.txt',
      path: tempEmptyPath,
      size: 10,
      mimetype: 'text/plain'
    });

    const initialUpdateCount = progressUpdateRepository.listByProjectId(projectId).length;

    await expect(
      ingestionService.processEvidence(projectId, evidence.id)
    ).rejects.toThrow(ValidationError);

    // Verify no fake ProgressUpdate was persisted
    const afterUpdateCount = progressUpdateRepository.listByProjectId(projectId).length;
    expect(afterUpdateCount).toBe(initialUpdateCount);
  });
});
