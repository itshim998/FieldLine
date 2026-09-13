import {
  ProgressUpdateRepository,
  progressUpdateRepository as defaultProgressUpdateRepo
} from '../repositories/progress-update.repository.js';
import {
  ProjectRepository,
  projectRepository as defaultProjectRepo
} from '../repositories/project.repository.js';
import {
  ActivityMatchRepository,
  activityMatchRepository as defaultActivityMatchRepo
} from '../repositories/activity-match.repository.js';
import {
  FieldProgressExtractionService,
  fieldProgressExtractionService as defaultExtractionService
} from '../ai/services/field-progress-extraction.service.js';
import {
  ActivityMatchingService,
  activityMatchingService as defaultMatchingService
} from './matching/activity-matching.service.js';
import {
  ProgressUpdate,
  CreateProgressUpdateInput,
  ProgressUpdateSourceType,
  ActivityMatch
} from '../models/domain.types.js';
import { NotFoundError, ValidationError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';

import type { MaybePromise } from '../database/provider.js';

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
  createManualUpdate(input: CreateManualUpdateInput): MaybePromise<ProgressUpdateEntity>;
  createAndProcessManualUpdate(input: CreateManualUpdateInput): Promise<{
    progressUpdate: ProgressUpdateEntity;
    matches: ActivityMatch[];
  }>;
  listProjectUpdates(projectId: string): MaybePromise<ProgressUpdateEntity[]>;
  getProjectUpdate(projectId: string, updateId: string): MaybePromise<ProgressUpdateEntity>;
}

export class DefaultProgressUpdateService implements ProgressUpdateService {
  private progressUpdateRepo: ProgressUpdateRepository;
  private projectRepo: ProjectRepository;
  private activityMatchRepo: ActivityMatchRepository;
  private extractionService: FieldProgressExtractionService;
  private matchingService: ActivityMatchingService;

  constructor(
    progressUpdateRepo: ProgressUpdateRepository = defaultProgressUpdateRepo,
    projectRepo: ProjectRepository = defaultProjectRepo,
    activityMatchRepo: ActivityMatchRepository = defaultActivityMatchRepo,
    extractionService: FieldProgressExtractionService = defaultExtractionService,
    matchingService: ActivityMatchingService = defaultMatchingService
  ) {
    this.progressUpdateRepo = progressUpdateRepo;
    this.projectRepo = projectRepo;
    this.activityMatchRepo = activityMatchRepo;
    this.extractionService = extractionService;
    this.matchingService = matchingService;
  }

  async createAndProcessManualUpdate(input: CreateManualUpdateInput): Promise<{
    progressUpdate: ProgressUpdateEntity;
    matches: ActivityMatch[];
  }> {
    // 1. Persist progress report record
    const progressRecord = await this.createManualUpdate(input);

    let matches: ActivityMatch[] = [];

    // 2. Extract structured field facts and execute activity matching
    try {
      const extraction = await this.extractionService.extractFromReport(input.rawText);

      if (extraction && Array.isArray(extraction.items) && extraction.items.length > 0) {
        await this.matchingService.matchProgressUpdate(
          input.projectId,
          progressRecord.id,
          extraction,
          {
            persist: true,
            asOfDate: input.reportDate
          }
        );
      }
    } catch (err: unknown) {
      logger.error(
        `Failed to run extraction/matching pipeline for progress report '${progressRecord.id}': ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }

    // 3. Query all persisted matches for this report
    matches = await this.activityMatchRepo.listByProgressUpdateId(progressRecord.id, input.projectId);

    return {
      progressUpdate: progressRecord,
      matches
    };
  }

  createManualUpdate(input: CreateManualUpdateInput): MaybePromise<ProgressUpdateEntity> {
    // 1. Validate raw text is non-empty
    if (!input.rawText || input.rawText.trim().length === 0) {
      throw new ValidationError('Report text cannot be empty or whitespace only');
    }

    if (input.rawText.length > 50000) {
      throw new ValidationError('Report text must not exceed 50,000 characters');
    }

    // 2. Validate report date format
    if (!input.reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.reportDate)) {
      throw new ValidationError('Report date must be a valid date in YYYY-MM-DD format');
    }

    // 3. Validate reporter name if provided
    if (input.reporterName !== undefined && input.reporterName !== null && input.reporterName.length > 0 && input.reporterName.trim().length === 0) {
      throw new ValidationError('Reporter name cannot be whitespace only');
    }

    // 4. Default sourceType to "manual" if unspecified and status = "received", preserve rawText verbatim
    const createInput: CreateProgressUpdateInput = {
      projectId: input.projectId,
      reportDate: input.reportDate,
      rawText: input.rawText, // Preserved exactly without aggressive normalization
      reporterName: input.reporterName && input.reporterName.trim().length > 0 ? input.reporterName.trim() : null,
      reporterRole: input.reporterRole && input.reporterRole.trim().length > 0 ? input.reporterRole.trim() : null,
      sourceType: input.sourceType || 'manual',
      status: 'received'
    };

    // 5. Verify project exists
    const projectRes = this.projectRepo.getById(input.projectId);
    if (projectRes instanceof Promise) {
      return projectRes.then((project) => {
        if (!project) {
          throw new NotFoundError(`Project with ID '${input.projectId}' not found`);
        }
        return this.progressUpdateRepo.create(createInput);
      });
    }

    if (!projectRes) {
      throw new NotFoundError(`Project with ID '${input.projectId}' not found`);
    }

    return this.progressUpdateRepo.create(createInput);
  }

  listProjectUpdates(projectId: string): MaybePromise<ProgressUpdateEntity[]> {
    // 1. Verify project exists
    const projectRes = this.projectRepo.getById(projectId);
    if (projectRes instanceof Promise) {
      return projectRes.then((project) => {
        if (!project) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }
        return this.progressUpdateRepo.listByProjectId(projectId);
      });
    }

    if (!projectRes) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    return this.progressUpdateRepo.listByProjectId(projectId);
  }

  getProjectUpdate(projectId: string, updateId: string): MaybePromise<ProgressUpdateEntity> {
    // 1. Verify project exists
    const projectRes = this.projectRepo.getById(projectId);
    if (projectRes instanceof Promise) {
      return projectRes.then(async (project) => {
        if (!project) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }
        const record = await this.progressUpdateRepo.getByIdAndProjectId(updateId, projectId);
        if (!record) {
          throw new NotFoundError(`Progress report with ID '${updateId}' not found for project '${projectId}'`);
        }
        return record;
      });
    }

    if (!projectRes) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    // 2. Query scoped strictly to the given project
    const recordRes = this.progressUpdateRepo.getByIdAndProjectId(updateId, projectId);
    if (recordRes instanceof Promise) {
      return recordRes.then((record) => {
        if (!record) {
          throw new NotFoundError(`Progress report with ID '${updateId}' not found for project '${projectId}'`);
        }
        return record;
      });
    }

    if (!recordRes) {
      throw new NotFoundError(`Progress report with ID '${updateId}' not found for project '${projectId}'`);
    }

    return recordRes;
  }
}

export const progressUpdateService: ProgressUpdateService = new DefaultProgressUpdateService();
