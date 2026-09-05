import {
  ProgressUpdateRepository,
  progressUpdateRepository as defaultProgressUpdateRepo
} from '../repositories/progress-update.repository.js';
import {
  ProjectRepository,
  projectRepository as defaultProjectRepo
} from '../repositories/project.repository.js';
import { ProgressUpdate, CreateProgressUpdateInput, ProgressUpdateSourceType } from '../models/domain.types.js';
import { NotFoundError, ValidationError } from '../errors/AppError.js';

export type ProgressUpdateEntity = ProgressUpdate;

export interface CreateManualUpdateInput {
  projectId: string;
  reportDate: string;
  rawText: string;
  reporterName?: string | null;
  reporterRole?: string | null;
  sourceType?: ProgressUpdateSourceType;
}

export interface ProgressUpdateService {
  createManualUpdate(input: CreateManualUpdateInput): ProgressUpdateEntity;
  listProjectUpdates(projectId: string): ProgressUpdateEntity[];
  getProjectUpdate(projectId: string, updateId: string): ProgressUpdateEntity;
}

export class DefaultProgressUpdateService implements ProgressUpdateService {
  private progressUpdateRepo: ProgressUpdateRepository;
  private projectRepo: ProjectRepository;

  constructor(
    progressUpdateRepo: ProgressUpdateRepository = defaultProgressUpdateRepo,
    projectRepo: ProjectRepository = defaultProjectRepo
  ) {
    this.progressUpdateRepo = progressUpdateRepo;
    this.projectRepo = projectRepo;
  }

  createManualUpdate(input: CreateManualUpdateInput): ProgressUpdateEntity {
    // 1. Verify project exists
    const project = this.projectRepo.getById(input.projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${input.projectId}' not found`);
    }

    // 2. Validate raw text is non-empty
    if (!input.rawText || input.rawText.trim().length === 0) {
      throw new ValidationError('Report text cannot be empty or whitespace only');
    }

    if (input.rawText.length > 50000) {
      throw new ValidationError('Report text must not exceed 50,000 characters');
    }

    // 3. Validate report date format
    if (!input.reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.reportDate)) {
      throw new ValidationError('Report date must be a valid date in YYYY-MM-DD format');
    }

    // 4. Validate reporter name if provided
    if (input.reporterName !== undefined && input.reporterName !== null && input.reporterName.length > 0 && input.reporterName.trim().length === 0) {
      throw new ValidationError('Reporter name cannot be whitespace only');
    }

    // 5. Default sourceType to "manual" if unspecified and status = "received", preserve rawText verbatim
    const createInput: CreateProgressUpdateInput = {
      projectId: input.projectId,
      reportDate: input.reportDate,
      rawText: input.rawText, // Preserved exactly without aggressive normalization
      reporterName: input.reporterName && input.reporterName.trim().length > 0 ? input.reporterName.trim() : null,
      reporterRole: input.reporterRole && input.reporterRole.trim().length > 0 ? input.reporterRole.trim() : null,
      sourceType: input.sourceType || 'manual',
      status: 'received'
    };

    return this.progressUpdateRepo.create(createInput);
  }

  listProjectUpdates(projectId: string): ProgressUpdateEntity[] {
    // 1. Verify project exists
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    return this.progressUpdateRepo.listByProjectId(projectId);
  }

  getProjectUpdate(projectId: string, updateId: string): ProgressUpdateEntity {
    // 1. Verify project exists
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    // 2. Query scoped strictly to the given project
    const record = this.progressUpdateRepo.getByIdAndProjectId(updateId, projectId);
    if (!record) {
      throw new NotFoundError(`Progress report with ID '${updateId}' not found for project '${projectId}'`);
    }

    return record;
  }
}

export const progressUpdateService: ProgressUpdateService = new DefaultProgressUpdateService();
