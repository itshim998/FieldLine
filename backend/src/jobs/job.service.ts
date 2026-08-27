import crypto from 'node:crypto';
import {
  JobRepository,
  jobRepository as defaultJobRepo
} from './job.repository.js';
import {
  ProjectRepository,
  projectRepository as defaultProjectRepo
} from '../repositories/project.repository.js';
import {
  EvidenceRepository,
  evidenceRepository as defaultEvidenceRepo
} from '../repositories/evidence.repository.js';
import {
  ProcessingJob,
  ProcessingJobType
} from '../models/domain.types.js';
import { NotFoundError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';

export interface JobService {
  enqueueDocumentIngestion(projectId: string, evidenceId: string): Promise<ProcessingJob>;
  getJob(projectId: string, jobId: string): ProcessingJob;
  listJobs(projectId: string, jobType?: ProcessingJobType): ProcessingJob[];
}

export class DefaultJobService implements JobService {
  private jobRepo: JobRepository;
  private projectRepo: ProjectRepository;
  private evidenceRepo: EvidenceRepository;

  constructor(dependencies?: {
    jobRepo?: JobRepository;
    projectRepo?: ProjectRepository;
    evidenceRepo?: EvidenceRepository;
  }) {
    this.jobRepo = dependencies?.jobRepo || defaultJobRepo;
    this.projectRepo = dependencies?.projectRepo || defaultProjectRepo;
    this.evidenceRepo = dependencies?.evidenceRepo || defaultEvidenceRepo;
  }

  /**
   * Enqueues an asynchronous document ingestion job for a given evidence item.
   * If an active (queued or processing) job already exists for the evidence, returns the existing job.
   */
  async enqueueDocumentIngestion(projectId: string, evidenceId: string): Promise<ProcessingJob> {
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

    // 3. Check for existing active job (queued or processing)
    const existingActive = this.jobRepo.findExistingActiveDocumentIngestionJob(projectId, evidenceId);
    if (existingActive) {
      logger.debug(
        `JobService: Reusing existing active job ${existingActive.id} for evidence ${evidenceId} (status: ${existingActive.status})`
      );
      return existingActive;
    }

    // 4. Create new queued job with queued event
    const jobId = crypto.randomUUID();
    const eventId = crypto.randomUUID();

    const createdJob = this.jobRepo.createWithEvent(
      {
        id: jobId,
        projectId,
        jobType: 'document_ingestion',
        payload: { evidenceId }
      },
      {
        id: eventId,
        projectId,
        eventType: 'processing_job_queued',
        entityType: 'processing_job',
        entityId: jobId,
        summary: `Document ingestion job queued for file: ${evidence.fileName}`,
        payloadJson: JSON.stringify({
          jobId,
          jobType: 'document_ingestion',
          evidenceId,
          fileName: evidence.fileName,
          fileType: evidence.fileType
        })
      }
    );

    logger.debug(`JobService: Created queued document ingestion job ${createdJob.id} for evidence ${evidenceId}`);
    return createdJob;
  }

  /**
   * Retrieves a single job by ID ensuring project isolation.
   */
  getJob(projectId: string, jobId: string): ProcessingJob {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const job = this.jobRepo.getByIdAndProjectId(jobId, projectId);
    if (!job) {
      throw new NotFoundError(`Processing job '${jobId}' not found for project '${projectId}'`);
    }

    return job;
  }

  /**
   * Lists all jobs for a project, optionally filtered by job type.
   */
  listJobs(projectId: string, jobType?: ProcessingJobType): ProcessingJob[] {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    return this.jobRepo.listByProjectId(projectId, jobType);
  }
}

export const jobService: JobService = new DefaultJobService();
