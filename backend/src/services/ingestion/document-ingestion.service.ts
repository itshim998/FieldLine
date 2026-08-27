import fs from 'node:fs';
import {
  EvidenceRepository,
  evidenceRepository as defaultEvidenceRepo
} from '../../repositories/evidence.repository.js';
import {
  ProjectRepository,
  projectRepository as defaultProjectRepo
} from '../../repositories/project.repository.js';
import {
  ProgressUpdateRepository,
  progressUpdateRepository as defaultProgressUpdateRepo
} from '../../repositories/progress-update.repository.js';
import {
  EvidenceService,
  evidenceService as defaultEvidenceService
} from '../evidence/evidence.service.js';
import {
  FieldProgressExtractionService,
  fieldProgressExtractionService as defaultExtractionService
} from '../../ai/services/field-progress-extraction.service.js';
import {
  DocumentExtractor,
  DocumentIngestionService,
  NormalizedDocument,
  ProcessEvidenceResult,
  mapSourceTypeToProgressUpdateType
} from './document-ingestion.types.js';
import { csvExtractor } from './extractors/csv.extractor.js';
import { xlsxExtractor } from './extractors/xlsx.extractor.js';
import { pdfExtractor } from './extractors/pdf.extractor.js';
import { ocrExtractor } from './extractors/ocr.extractor.js';
import { textExtractor } from './extractors/text.extractor.js';
import { NotFoundError, ValidationError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';

export class DefaultDocumentIngestionService implements DocumentIngestionService {
  private evidenceRepo: EvidenceRepository;
  private evidenceService: EvidenceService;
  private projectRepo: ProjectRepository;
  private progressUpdateRepo: ProgressUpdateRepository;
  private extractionService: FieldProgressExtractionService;
  private extractors: DocumentExtractor[];

  constructor(dependencies?: {
    evidenceRepo?: EvidenceRepository;
    evidenceService?: EvidenceService;
    projectRepo?: ProjectRepository;
    progressUpdateRepo?: ProgressUpdateRepository;
    extractionService?: FieldProgressExtractionService;
    extractors?: DocumentExtractor[];
  }) {
    this.evidenceRepo = dependencies?.evidenceRepo || defaultEvidenceRepo;
    this.evidenceService = dependencies?.evidenceService || defaultEvidenceService;
    this.projectRepo = dependencies?.projectRepo || defaultProjectRepo;
    this.progressUpdateRepo = dependencies?.progressUpdateRepo || defaultProgressUpdateRepo;
    this.extractionService = dependencies?.extractionService || defaultExtractionService;
    this.extractors = dependencies?.extractors || [
      csvExtractor,
      xlsxExtractor,
      pdfExtractor,
      ocrExtractor,
      textExtractor
    ];
  }

  /**
   * Extracts normalized text content from a stored evidence document without mutating database state.
   */
  async extractDocument(projectId: string, evidenceId: string): Promise<NormalizedDocument> {
    // 1. Verify project exists
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    // 2. Verify evidence exists and belongs to the project
    const evidence = this.evidenceRepo.getByIdAndProjectId(evidenceId, projectId);
    if (!evidence) {
      throw new NotFoundError(`Evidence with ID '${evidenceId}' not found for project '${projectId}'`);
    }

    // 3. Safely load physical file content
    const contentResult = this.evidenceService.getEvidenceContent(projectId, evidenceId);
    let fileBuffer: Buffer;
    try {
      fileBuffer = fs.readFileSync(contentResult.absoluteFilePath);
    } catch (readErr) {
      throw new ValidationError(
        `Failed to read evidence file from storage: ${readErr instanceof Error ? readErr.message : String(readErr)}`
      );
    }

    // 4. Find matching extractor
    const extractor = this.extractors.find((e) =>
      e.supports(evidence.fileType, evidence.fileName, evidence.mimeType)
    );

    if (!extractor) {
      throw new ValidationError(
        `No document extractor available for file '${evidence.fileName}' (type: ${evidence.fileType})`
      );
    }

    logger.debug(
      `DocumentIngestionService: Extracting evidence ${evidenceId} using ${extractor.name}`
    );

    return await extractor.extract({
      evidenceId: evidence.id,
      projectId: evidence.projectId,
      sourceFileName: evidence.fileName,
      fileBuffer,
      filePath: contentResult.absoluteFilePath,
      mimeType: evidence.mimeType
    });
  }

  /**
   * Explicit synchronous document processing workflow:
   * Evidence -> Extractor -> NormalizedDocument -> ProgressReport -> AI Extraction
   */
  async processEvidence(projectId: string, evidenceId: string): Promise<ProcessEvidenceResult> {
    // 1. Verify project exists
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    // 2. Verify evidence exists and belongs to project
    const evidence = this.evidenceRepo.getByIdAndProjectId(evidenceId, projectId);
    if (!evidence) {
      throw new NotFoundError(`Evidence with ID '${evidenceId}' not found for project '${projectId}'`);
    }

    // 3. Extract and normalize document content
    const normalizedDoc = await this.extractDocument(projectId, evidenceId);

    if (!normalizedDoc.text || normalizedDoc.text.trim().length === 0) {
      throw new ValidationError('Extracted document content is empty or contains only whitespace');
    }

    // 4. Persist progress-report record
    const mappedSourceType = mapSourceTypeToProgressUpdateType(normalizedDoc.sourceType);
    const todayStr = new Date().toISOString().slice(0, 10);

    const createdProgressRecord = this.progressUpdateRepo.create({
      projectId,
      reportDate: todayStr,
      reporterName: `Document Ingestion: ${evidence.fileName}`,
      reporterRole: 'Document Ingestion',
      sourceType: mappedSourceType,
      rawText: normalizedDoc.text,
      status: 'received'
    });

    // 5. Link evidence to the created report
    try {
      this.evidenceRepo.attachToProgressUpdate(evidenceId, createdProgressRecord.id, projectId);
    } catch (attachErr) {
      logger.warn('Failed to link evidence progressUpdateId reference', attachErr);
    }

    // 6. Invoke downstream AI fact extraction
    logger.debug('DocumentIngestionService: Invoking downstream FieldProgressExtractionService');
    const extraction = await this.extractionService.extractFromReport(normalizedDoc.text);

    const refreshedEvidence = this.evidenceRepo.getByIdAndProjectId(evidenceId, projectId) || evidence;

    return {
      evidence: refreshedEvidence,
      progressUpdate: createdProgressRecord,
      normalizedDocument: {
        sourceType: normalizedDoc.sourceType,
        textLength: normalizedDoc.text.length,
        metadata: normalizedDoc.metadata
      },
      extraction
    };
  }
}

export const documentIngestionService = new DefaultDocumentIngestionService();
export type { DocumentIngestionService } from './document-ingestion.types.js';
