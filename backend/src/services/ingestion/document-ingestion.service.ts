import fs from 'node:fs';
import { CreateActivityMatchInput } from '../../models/domain.types.js';
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
  progressUpdateRepository as defaultProgressUpdateRepo,
  DocumentProcessingTxInput
} from '../../repositories/progress-update.repository.js';
import {
  ActivityMatchRepository,
  activityMatchRepository as defaultActivityMatchRepo
} from '../../repositories/activity-match.repository.js';
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
  CandidateMatch,
  FieldFactMatchResult
} from '../matching/activity-matching.types.js';
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
import { NotFoundError, ValidationError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';

export class DefaultDocumentIngestionService implements DocumentIngestionService {
  private evidenceRepo: EvidenceRepository;
  private evidenceService: EvidenceService;
  private projectRepo: ProjectRepository;
  private progressUpdateRepo: ProgressUpdateRepository;
  private activityMatchRepo: ActivityMatchRepository;
  private extractionService: FieldProgressExtractionService;
  private matchingService: ActivityMatchingService;
  private extractors: DocumentExtractor[];

  constructor(dependencies?: {
    evidenceRepo?: EvidenceRepository;
    evidenceService?: EvidenceService;
    projectRepo?: ProjectRepository;
    progressUpdateRepo?: ProgressUpdateRepository;
    activityMatchRepo?: ActivityMatchRepository;
    extractionService?: FieldProgressExtractionService;
    matchingService?: ActivityMatchingService;
    extractors?: DocumentExtractor[];
  }) {
    this.evidenceRepo = dependencies?.evidenceRepo || defaultEvidenceRepo;
    this.evidenceService = dependencies?.evidenceService || defaultEvidenceService;
    this.projectRepo = dependencies?.projectRepo || defaultProjectRepo;
    this.progressUpdateRepo = dependencies?.progressUpdateRepo || defaultProgressUpdateRepo;
    this.activityMatchRepo = dependencies?.activityMatchRepo || defaultActivityMatchRepo;
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

  private resolveReportDate(normalizedDoc: NormalizedDocument, evidence: any): string {
    return (
      (normalizedDoc.metadata?.reportDate as string) ||
      extractReportDate(normalizedDoc.text) ||
      new Date().toISOString().slice(0, 10)
    );
  }

  /**
   * Extracts normalized text content from a stored evidence document without mutating database state.
   */
  async extractDocument(projectId: string, evidenceId: string): Promise<NormalizedDocument> {
    // 1. Verify project exists
    const project = await this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    // 2. Verify evidence exists and belongs to the project
    const evidence = await this.evidenceRepo.getByIdAndProjectId(evidenceId, projectId);
    if (!evidence) {
      throw new NotFoundError(`Evidence with ID '${evidenceId}' not found for project '${projectId}'`);
    }

    // 3. Safely load physical file content
    const contentResult = await this.evidenceService.getEvidenceContent(projectId, evidenceId);
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
   * Explicit document processing workflow:
   * 1. Validate project and evidence existence
   * 2. Extract and validate normalized document text
   * 3. Determine report date from document content
   * 4. Invoke AI fact extraction before database mutation
   * 5. Compute candidate matches before database mutation
   * 6. Commit atomic transaction creating progress record, linking evidence, and persisting matches
   * 7. Return comprehensive processing result
   */
  async processEvidence(projectId: string, evidenceId: string): Promise<ProcessEvidenceResult> {
    // 1. Verify project exists
    const project = await this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    // 2. Verify evidence exists and belongs to project
    const evidence = await this.evidenceRepo.getByIdAndProjectId(evidenceId, projectId);
    if (!evidence) {
      throw new NotFoundError(`Evidence with ID '${evidenceId}' not found for project '${projectId}'`);
    }

    // 3. Durable Idempotency: check if evidence is ALREADY linked to an existing progress report
    if (evidence.progressUpdateId) {
      const priorProgress = await this.progressUpdateRepo.getByIdAndProjectId(evidence.progressUpdateId, projectId);
      if (priorProgress) {
        logger.debug(
          `DocumentIngestionService: Evidence ${evidenceId} already has durable report ${evidence.progressUpdateId}. Reusing existing project state.`
        );
        const existingMatches = await this.activityMatchRepo.listByProgressUpdateId(priorProgress.id, projectId);
        return {
          evidence,
          progressUpdate: priorProgress,
          normalizedDocument: {
            sourceType: evidence.fileType as any,
            textLength: priorProgress.rawText?.length ?? 0,
            metadata: {}
          },
          extraction: { items: [] },
          matches: existingMatches.map((m): FieldFactMatchResult => ({
            fact: {
              reference: m.matchedText || m.activityId,
              location: null,
              progress_percent: null,
              status: 'in_progress'
            },
            bestMatch: {
              activityId: m.activityId,
              activityExternalId: m.matchedText || m.activityId,
              activityName: m.matchedText || m.activityId,
              confidenceScore: m.confidenceScore,
              matchMethod: m.matchMethod,
              rationale: m.rationale || 'Durable matched fact',
              matchedText: m.matchedText
            },
            alternatives: [],
            confidenceTier: m.confidenceTier || undefined,
            reviewDecision: {
              tier: m.confidenceTier || 'medium',
              reviewState: m.reviewState || 'awaiting_review',
              autoConfirm: m.status === 'confirmed',
              reason: 'Reused from existing processed evidence record'
            }
          }))
        };
      }
    }

    // 4. Extract normalized text content
    const normalizedDoc = await this.extractDocument(projectId, evidenceId);
    if (!normalizedDoc.text || normalizedDoc.text.trim().length === 0) {
      throw new ValidationError(
        `Document '${evidence.fileName}' contains no readable or extracted text`
      );
    }

    // 5. Extract structured facts from text using AI
    const extraction = await this.extractionService.extractFromReport(normalizedDoc.text);

    // 6. Determine canonical report date
    const reportDateStr = this.resolveReportDate(normalizedDoc, evidence);

    // 7. Compute candidate matches without mutating database
    const matchResults = await this.matchingService.computeMatches(projectId, extraction, {
      asOfDate: reportDateStr
    });

    // 8. Commit atomic transaction creating progress record, linking evidence, and persisting matches
    const mappedSourceType = mapSourceTypeToProgressUpdateType(normalizedDoc.sourceType);
    const nowIso = new Date().toISOString();

    const toPersist: DocumentProcessingTxInput['suggestedMatches'] = matchResults
      .filter((r) => r.bestMatch !== null)
      .map((r) => {
        const isAutoConfirm = r.reviewDecision ? r.reviewDecision.autoConfirm : false;
        const anomalyScore = r.bestMatch!.anomalyScore ?? r.bestMatch!.anomaly?.anomalyScore ?? null;
        const anomalySeverity = r.bestMatch!.anomalySeverity ?? r.bestMatch!.anomaly?.severity ?? null;
        const anomalyReasons = r.bestMatch!.anomalyReasons ?? r.bestMatch!.anomaly?.reasons ?? null;

        return {
          id: crypto.randomUUID(),
          projectId,
          activityId: r.bestMatch!.activityId,
          confidenceScore: r.bestMatch!.finalScore ?? r.bestMatch!.confidenceScore,
          matchMethod: r.bestMatch!.matchMethod,
          matchedText: r.fact.reference,
          rationale: r.bestMatch!.rationale,
          status: isAutoConfirm ? ('confirmed' as const) : ('suggested' as const),
          confidenceTier: r.confidenceTier || (isAutoConfirm ? 'high' : 'medium'),
          reviewState: r.reviewDecision?.reviewState || (isAutoConfirm ? 'resolved' : 'awaiting_review'),
          reviewedBy: isAutoConfirm ? 'system' : null,
          reviewedAt: isAutoConfirm ? nowIso : null,
          mlConfidence: r.bestMatch!.mlConfidence ?? null,
          anomalyScore,
          anomalySeverity,
          anomalyReasonsJson:
            anomalyReasons && anomalyReasons.length > 0 ? JSON.stringify(anomalyReasons) : null
        };
      });

    const txResult = await this.progressUpdateRepo.commitDocumentIngestionTransaction({
      progressUpdate: {
        projectId,
        reportDate: reportDateStr,
        reporterName: `Document Ingestion: ${evidence.fileName}`,
        reporterRole: 'Document Ingestion',
        sourceType: mappedSourceType,
        rawText: normalizedDoc.text,
        status: 'received'
      },
      evidenceId,
      suggestedMatches: toPersist
    });

    const refreshedEvidence = (await this.evidenceRepo.getByIdAndProjectId(evidenceId, projectId)) || evidence;

    return {
      evidence: refreshedEvidence,
      progressUpdate: txResult.progressUpdate,
      normalizedDocument: {
        sourceType: normalizedDoc.sourceType,
        textLength: normalizedDoc.text.length,
        metadata: normalizedDoc.metadata
      },
      extraction,
      matches: matchResults
    };
  }
}

export const documentIngestionService = new DefaultDocumentIngestionService();
export type { DocumentIngestionService } from './document-ingestion.types.js';
