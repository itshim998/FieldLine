import {
  DocumentIngestionService,
  documentIngestionService as defaultIngestionService
} from '../services/ingestion/document-ingestion.service.js';
import {
  EvidenceRepository,
  evidenceRepository as defaultEvidenceRepo
} from '../repositories/evidence.repository.js';
import {
  JobRepository,
  jobRepository as defaultJobRepo
} from './job.repository.js';
import {
  ProcessingJob,
  DocumentIngestionJobPayload,
  DocumentIngestionJobResult
} from '../models/domain.types.js';
import { logger } from '../config/logger.js';

/**
 * Sanitizes internal error messages before storing in the database or exposing via API.
 * Strips stack traces, local filesystem paths, and internal memory references.
 */
export function sanitizeErrorMessage(rawMessage: string): string {
  if (!rawMessage || typeof rawMessage !== 'string') {
    return 'Document processing failed';
  }

  // 1. Take only the first relevant error message line if stack trace was included
  const firstLine = rawMessage.split('\n')[0].trim();

  // 2. Strip Windows and Unix absolute filesystem paths
  const strippedPath = firstLine
    .replace(/[A-Za-z]:\\[^:\n\r\t]+/g, '<storage-path>')
    .replace(/\/(?:[a-zA-Z0-9._-]+\/)+[a-zA-Z0-9._-]+/g, '<storage-path>');

  // 3. Strip memory addresses or internal runtime prefixes
  const sanitized = strippedPath
    .replace(/at\s+.*\(.*\)/g, '')
    .trim();

  // 4. Bound length
  return sanitized.length > 500 ? `${sanitized.slice(0, 497)}...` : sanitized || 'Document processing failed';
}

export class DocumentIngestionWorker {
  private ingestionService: DocumentIngestionService;
  private evidenceRepo: EvidenceRepository;
  private jobRepo: JobRepository;

  constructor(
    ingestionServiceOrDeps?: DocumentIngestionService | {
      ingestionService?: DocumentIngestionService;
      evidenceRepo?: EvidenceRepository;
      jobRepo?: JobRepository;
    },
    evidenceRepo?: EvidenceRepository,
    jobRepo?: JobRepository
  ) {
    if (ingestionServiceOrDeps && typeof (ingestionServiceOrDeps as DocumentIngestionService).processEvidence === 'function') {
      this.ingestionService = ingestionServiceOrDeps as DocumentIngestionService;
      this.evidenceRepo = evidenceRepo || defaultEvidenceRepo;
      this.jobRepo = jobRepo || defaultJobRepo;
    } else {
      const deps = ingestionServiceOrDeps as {
        ingestionService?: DocumentIngestionService;
        evidenceRepo?: EvidenceRepository;
        jobRepo?: JobRepository;
      } | undefined;
      this.ingestionService = deps?.ingestionService || defaultIngestionService;
      this.evidenceRepo = deps?.evidenceRepo || defaultEvidenceRepo;
      this.jobRepo = deps?.jobRepo || defaultJobRepo;
    }
  }

  /**
   * Processes a single claimed document ingestion job.
   */
  async process(job: ProcessingJob): Promise<void> {
    const jobId = job.id;
    logger.debug(`DocumentIngestionWorker: Executing job ${jobId} for project ${job.projectId}`);

    try {
      // 1. Validate payload
      const payload = job.payload as DocumentIngestionJobPayload;
      if (!payload || typeof payload.evidenceId !== 'string' || !payload.evidenceId.trim()) {
        const errorMsg = 'Malformed job payload: missing or invalid evidenceId';
        logger.warn(`DocumentIngestionWorker: ${errorMsg} on job ${jobId}`);
        this.jobRepo.markFailed(jobId, errorMsg);
        return;
      }

      const evidenceId = payload.evidenceId.trim();

      // 2. Verify evidence still exists and belongs to job.projectId
      const evidence = this.evidenceRepo.getByIdAndProjectId(evidenceId, job.projectId);
      if (!evidence) {
        const errorMsg = `Evidence '${evidenceId}' not found for project '${job.projectId}'`;
        logger.warn(`DocumentIngestionWorker: ${errorMsg} on job ${jobId}`);
        this.jobRepo.markFailed(jobId, errorMsg);
        return;
      }

      // 3. Invoke downstream business processing pipeline
      const processResult = await this.ingestionService.processEvidence(job.projectId, evidenceId);

      // 4. Create bounded result payload (no raw text / OCR blobs)
      const boundedResult: DocumentIngestionJobResult = {
        evidenceId: processResult.evidence.id,
        progressUpdateId: processResult.progressUpdate.id,
        matchCount: processResult.matches?.length ?? 0,
        sourceType: processResult.normalizedDocument.sourceType
      };

      // 5. Mark job completed
      this.jobRepo.markCompleted(jobId, boundedResult);
      logger.info(`DocumentIngestionWorker: Job ${jobId} successfully completed for evidence ${evidenceId}`);
    } catch (err: unknown) {
      const payload = job.payload as DocumentIngestionJobPayload | undefined;
      const evidenceId = payload?.evidenceId?.trim();

      // Check if project state was already committed to prevent corrupting valid state
      if (evidenceId) {
        try {
          const evidence = this.evidenceRepo.getByIdAndProjectId(evidenceId, job.projectId);
          if (evidence?.progressUpdateId) {
            logger.warn(
              `DocumentIngestionWorker: Project state was already committed for evidence ${evidenceId} (progressUpdateId: ${evidence.progressUpdateId}). Preserving durable project truth.`
            );
            // Attempt to repair job status to completed
            try {
              this.jobRepo.markCompleted(jobId, {
                evidenceId,
                progressUpdateId: evidence.progressUpdateId,
                matchCount: 0,
                sourceType: evidence.fileType
              });
            } catch {
              // Ignore job status repair error; project truth is preserved
            }
            return;
          }
        } catch {
          // If check fails, proceed to standard failure handling
        }
      }

      const rawError = err instanceof Error ? err.message : String(err);
      const sanitized = sanitizeErrorMessage(rawError);
      logger.error(`DocumentIngestionWorker: Job ${jobId} processing failed: ${sanitized}`);
      this.jobRepo.markFailed(jobId, sanitized);
    }
  }
}

export const documentIngestionWorker = new DocumentIngestionWorker();
