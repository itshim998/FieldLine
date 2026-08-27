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
  ActivityMatchingService,
  activityMatchingService as defaultMatchingService
} from '../matching/activity-matching.service.js';
import {
  DocumentExtractor,
  DocumentIngestionService,
  NormalizedDocument,
  ProcessEvidenceResult,
  mapSourceTypeToProgressUpdateType,
  extractReportDate
} from './document-ingestion.types.js';
import { csvExtractor } from './extractors/csv.extractor.js';
import { xlsxExtractor } from './extractors/xlsx.extractor.js';
import { pdfExtractor } from './extractors/pdf.extractor.js';
import { ocrExtractor } from './extractors/ocr.extractor.js';
import { textExtractor } from './extractors/text.extractor.js';
import { DatabaseError, NotFoundError, ValidationError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';

export class DefaultDocumentIngestionService implements DocumentIngestionService {
  private evidenceRepo: EvidenceRepository;
  private evidenceService: EvidenceService;
  private projectRepo: ProjectRepository;
  private progressUpdateRepo: ProgressUpdateRepository;
  private extractionService: FieldProgressExtractionService;
  private matchingService: ActivityMatchingService;
  private extractors: DocumentExtractor[];

  constructor(dependencies?: {
    evidenceRepo?: EvidenceRepository;
    evidenceService?: EvidenceService;
    projectRepo?: ProjectRepository;
    progressUpdateRepo?: ProgressUpdateRepository;
    extractionService?: FieldProgressExtractionService;
    matchingService?: ActivityMatchingService;
    extractors?: DocumentExtractor[];
  }) {
    this.evidenceRepo = dependencies?.evidenceRepo || defaultEvidenceRepo;
    this.evidenceService = dependencies?.evidenceService || defaultEvidenceService;
    this.projectRepo = dependencies?.projectRepo || defaultProjectRepo;
    this.progressUpdateRepo = dependencies?.progressUpdateRepo || defaultProgressUpdateRepo;
    this.extractionService = dependencies?.extractionService || defaultExtractionService;
    this.matchingService = dependencies?.matchingService || defaultMatchingService;
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
   * 1. Validate project and evidence existence
   * 2. Extract and validate normalized document text
   * 3. Determine report date from document content
   * 4. Invoke AI fact extraction (before persisting database records)
   * 5. Persist progress report record
   * 6. Attach evidence with strict rollback on failure
   * 7. Invoke ActivityMatchingService to generate and persist suggested matches
   * 8. Return comprehensive processing result
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

    // 4. Determine report date (explicit date in document preferred over today's fallback)
    const reportDateStr =
      extractReportDate(normalizedDoc.text) || new Date().toISOString().slice(0, 10);

    // 5. Invoke downstream AI fact extraction BEFORE creating database records
    logger.debug('DocumentIngestionService: Invoking downstream FieldProgressExtractionService');
    const extraction = await this.extractionService.extractFromReport(normalizedDoc.text);

    // 6. Persist progress-report record
    const mappedSourceType = mapSourceTypeToProgressUpdateType(normalizedDoc.sourceType);
    let createdProgressRecord;
    try {
      createdProgressRecord = this.progressUpdateRepo.create({
        projectId,
        reportDate: reportDateStr,
        reporterName: `Document Ingestion: ${evidence.fileName}`,
        reporterRole: 'Document Ingestion',
        sourceType: mappedSourceType,
        rawText: normalizedDoc.text,
        status: 'received'
      });
    } catch (createErr) {
      throw new DatabaseError(
        `Failed to create progress report record: ${createErr instanceof Error ? createErr.message : String(createErr)}`
      );
    }

    // 7. Link evidence to created report with atomic rollback on failure
    try {
      const attached = this.evidenceRepo.attachToProgressUpdate(
        evidenceId,
        createdProgressRecord.id,
        projectId
      );
      if (!attached) {
        throw new DatabaseError(
          `Evidence '${evidenceId}' could not be linked to report '${createdProgressRecord.id}'`
        );
      }
    } catch (attachErr) {
      // Rollback created progress report to prevent orphaned records
      try {
        this.progressUpdateRepo.deleteByIdAndProjectId(createdProgressRecord.id, projectId);
      } catch (rollbackErr) {
        logger.error('Failed to rollback progress report after attachment failure', rollbackErr);
      }
      throw attachErr;
    }

    // 8. Invoke ActivityMatchingService to generate and persist suggested matches
    logger.debug('DocumentIngestionService: Invoking downstream ActivityMatchingService');
    const matchResult = await this.matchingService.matchProgressUpdate(
      projectId,
      createdProgressRecord.id,
      extraction,
      { persist: true }
    );

    const refreshedEvidence = this.evidenceRepo.getByIdAndProjectId(evidenceId, projectId) || evidence;

    return {
      evidence: refreshedEvidence,
      progressUpdate: createdProgressRecord,
      normalizedDocument: {
        sourceType: normalizedDoc.sourceType,
        textLength: normalizedDoc.text.length,
        metadata: normalizedDoc.metadata
      },
      extraction,
      matches: matchResult.matches
    };
  }
}

export const documentIngestionService = new DefaultDocumentIngestionService();
export type { DocumentIngestionService } from './document-ingestion.types.js';
