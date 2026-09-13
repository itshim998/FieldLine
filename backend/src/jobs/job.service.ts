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

    // 3. Atomically find existing completed/active job or create new queued job
    const summary = `Document ingestion job queued for file: ${evidence.fileName}`;
    const eventPayloadJson = JSON.stringify({
      jobType: 'document_ingestion',
      evidenceId,
      fileName: evidence.fileName,
      fileType: evidence.fileType
    });

    const { job, isNew } = await this.jobRepo.findOrCreateDocumentIngestionJob(
      projectId,
      evidenceId,
      summary,
      eventPayloadJson
    );

    if (isNew) {
      logger.debug(`JobService: Created queued document ingestion job ${job.id} for evidence ${evidenceId}`);
    } else {
      logger.debug(`JobService: Reusing existing job ${job.id} for evidence ${evidenceId} (status: ${job.status})`);
    }

    return job;
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
