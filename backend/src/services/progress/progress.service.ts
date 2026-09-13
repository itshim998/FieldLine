import {
  ProjectRepository,
  projectRepository as defaultProjectRepo
} from '../../repositories/project.repository.js';
import {
  ProgressUpdateRepository,
  progressUpdateRepository as defaultProgressUpdateRepo
} from '../../repositories/progress-update.repository.js';
import {
  ActivityRepository,
  activityRepository as defaultActivityRepo
} from '../../repositories/activity.repository.js';
import {
  ActivityMatchRepository,
  activityMatchRepository as defaultActivityMatchRepo
} from '../../repositories/activity-match.repository.js';
import {
  ActivityProgressRepository,
  activityProgressRepository as defaultActivityProgressRepo
} from '../../repositories/activity-progress.repository.js';
import type { MaybePromise } from '../../database/provider.js';
import {
  Project,
  Activity,
  ActivityMatch,
  ProgressUpdate,
  ActivityProgress,
  CreateActivityProgressInput,
  CreateProjectEventInput
} from '../../models/domain.types.js';
import { FieldProgressItem } from '../../ai/contracts/field-progress-extraction.contract.js';
import { normalizeProgress } from './progress-normalization.js';
import { NotFoundError, ValidationError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';

export interface NormalizeAndRecordProgressInput {
  projectId: string;
  updateId: string;
  matchId: string;
  fact: FieldProgressItem;
  actualQuantity?: number | null;
  quantityUnit?: string | null;
  asOfDate?: string | null;
  allowSuggested?: boolean;
}

export interface ProgressService {
  normalizeAndRecordProgress(input: NormalizeAndRecordProgressInput): MaybePromise<ActivityProgress>;
  listActivityProgress(projectId: string, activityId: string): MaybePromise<ActivityProgress[]>;
  getLatestActivityProgress(projectId: string, activityId: string): MaybePromise<ActivityProgress | null>;
  listProgressByUpdate(projectId: string, updateId: string): MaybePromise<ActivityProgress[]>;
}

export class DefaultProgressService implements ProgressService {
  private projectRepo: ProjectRepository;
  private progressUpdateRepo: ProgressUpdateRepository;
  private activityRepo: ActivityRepository;
  private activityMatchRepo: ActivityMatchRepository;
  private activityProgressRepo: ActivityProgressRepository;

  constructor(dependencies?: {
    projectRepo?: ProjectRepository;
    progressUpdateRepo?: ProgressUpdateRepository;
    activityRepo?: ActivityRepository;
    activityMatchRepo?: ActivityMatchRepository;
    activityProgressRepo?: ActivityProgressRepository;
  }) {
    this.projectRepo = dependencies?.projectRepo || defaultProjectRepo;
    this.progressUpdateRepo = dependencies?.progressUpdateRepo || defaultProgressUpdateRepo;
    this.activityRepo = dependencies?.activityRepo || defaultActivityRepo;
    this.activityMatchRepo = dependencies?.activityMatchRepo || defaultActivityMatchRepo;
    this.activityProgressRepo = dependencies?.activityProgressRepo || defaultActivityProgressRepo;
  }

  normalizeAndRecordProgress(input: NormalizeAndRecordProgressInput): MaybePromise<ActivityProgress> {
    const {
      projectId,
      updateId,
      matchId,
      fact,
      actualQuantity = null,
      quantityUnit = null,
      asOfDate,
      allowSuggested = false
    } = input;

    const projectRes = this.projectRepo.getById(projectId);
    if (projectRes instanceof Promise) {
      return (async () => {
        const project = await projectRes;
        if (!project) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }

        const updateRecord = await this.progressUpdateRepo.getByIdAndProjectId(updateId, projectId);
        if (!updateRecord) {
          throw new NotFoundError(
            `Progress report with ID '${updateId}' not found for project '${projectId}'`
          );
        }

        const match = await this.activityMatchRepo.getByIdAndProjectId(matchId, projectId);
        if (!match) {
          throw new NotFoundError(
            `Activity match with ID '${matchId}' not found for project '${projectId}'`
          );
        }

        if (match.progressUpdateId !== updateId) {
          throw new ValidationError(
            `Activity match '${matchId}' belongs to progress report '${match.progressUpdateId}', not '${updateId}'`
          );
        }

        if (match.status === 'rejected') {
          throw new ValidationError(
            `Cannot normalize progress for rejected activity match '${matchId}'`
          );
        }

        if (match.status === 'suggested' && !allowSuggested) {
          throw new ValidationError(
            `Cannot normalize progress for unconfirmed activity match '${matchId}'. Match status is 'suggested' and allowSuggested is false.`
          );
        }

        const activity = await this.activityRepo.getById(match.activityId);
        if (!activity || activity.projectId !== projectId) {
          throw new NotFoundError(
            `Matched activity with ID '${match.activityId}' not found for project '${projectId}'`
          );
        }

        const effectiveAsOfDate = asOfDate || updateRecord.reportDate;

        const normalized = normalizeProgress({
          fact,
          activity,
          actualQuantity,
          quantityUnit,
          asOfDate: effectiveAsOfDate
        });

        if (normalized.actualPercent === null) {
          throw new ValidationError(
            'Cannot persist ActivityProgress because no deterministic actual percentage is available.'
          );
        }

        const history = await this.activityProgressRepo.listByActivityId(activity.id, projectId);

        let finalActualStart = normalized.actualStart;
        const historicalStartDates = history
          .map(r => r.actualStart)
          .filter((d): d is string => d !== null && d !== undefined && d.length > 0)
          .sort();

        if (historicalStartDates.length > 0) {
          const earliestHistoricalStart = historicalStartDates[0];
          if (finalActualStart) {
            finalActualStart =
              earliestHistoricalStart < finalActualStart ? earliestHistoricalStart : finalActualStart;
          } else if (normalized.status !== 'not_started') {
            finalActualStart = earliestHistoricalStart;
          }
        }

        let finalActualFinish = normalized.actualFinish;
        const historicalFinishDates = history
          .map(r => r.actualFinish)
          .filter((d): d is string => d !== null && d !== undefined && d.length > 0)
          .sort();

        if (historicalFinishDates.length > 0) {
          const earliestHistoricalFinish = historicalFinishDates[0];
          if (finalActualFinish) {
            finalActualFinish =
              earliestHistoricalFinish < finalActualFinish
                ? earliestHistoricalFinish
                : finalActualFinish;
          } else {
            finalActualFinish = earliestHistoricalFinish;
          }
        }

        const existing = await this.activityProgressRepo.findExistingObservation(
          projectId,
          activity.id,
          updateId,
          effectiveAsOfDate,
          normalized.actualPercent,
          normalized.actualQuantity,
          normalized.status
        );

        if (existing) {
          logger.info(
            `ProgressService: Returning existing observation '${existing.id}' for activity '${activity.id}' as-of '${effectiveAsOfDate}'`
          );
          return existing;
        }

        const progressInput: CreateActivityProgressInput = {
          projectId,
          activityId: activity.id,
          progressUpdateId: updateId,
          actualPercent: normalized.actualPercent,
          actualQuantity: normalized.actualQuantity,
          actualStart: finalActualStart,
          actualFinish: finalActualFinish,
          status: normalized.status,
          asOfDate: effectiveAsOfDate,
          notes: normalized.notes
        };

        const eventInput: CreateProjectEventInput = {
          projectId,
          eventType: 'progress_updated',
          entityType: 'activity_progress',
          summary: `Activity progress recorded at ${normalized.actualPercent}% (${normalized.status}) for '${activity.name}'`,
          payloadJson: JSON.stringify({
            activityId: activity.id,
            progressUpdateId: updateId,
            matchId,
            actualPercent: normalized.actualPercent,
            actualQuantity: normalized.actualQuantity,
            status: normalized.status,
            asOfDate: effectiveAsOfDate
          })
        };

        const savedProgress = await this.activityProgressRepo.createWithEvent(progressInput, eventInput);
        logger.info(
          `ProgressService: Created activity progress '${savedProgress.id}' for activity '${activity.name}' (${savedProgress.actualPercent}%)`
        );

        return savedProgress;
      })();
    }

    // Synchronous execution for SQLite
    const project = projectRes as Project | null;
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const updateRecord = this.progressUpdateRepo.getByIdAndProjectId(updateId, projectId) as (ProgressUpdate|null);
    if (!updateRecord) {
      throw new NotFoundError(
        `Progress report with ID '${updateId}' not found for project '${projectId}'`
      );
    }

    const match = this.activityMatchRepo.getByIdAndProjectId(matchId, projectId) as ActivityMatch | null;
    if (!match) {
      throw new NotFoundError(
        `Activity match with ID '${matchId}' not found for project '${projectId}'`
      );
    }

    if (match.progressUpdateId !== updateId) {
      throw new ValidationError(
        `Activity match '${matchId}' belongs to progress report '${match.progressUpdateId}', not '${updateId}'`
      );
    }

    if (match.status === 'rejected') {
      throw new ValidationError(
        `Cannot normalize progress for rejected activity match '${matchId}'`
      );
    }

    if (match.status === 'suggested' && !allowSuggested) {
      throw new ValidationError(
        `Cannot normalize progress for unconfirmed activity match '${matchId}'. Match status is 'suggested' and allowSuggested is false.`
      );
    }

    const activity = this.activityRepo.getById(match.activityId) as Activity | null;
    if (!activity || activity.projectId !== projectId) {
      throw new NotFoundError(
        `Matched activity with ID '${match.activityId}' not found for project '${projectId}'`
      );
    }

    const effectiveAsOfDate = asOfDate || updateRecord.reportDate;

    const normalized = normalizeProgress({
      fact,
      activity,
      actualQuantity,
      quantityUnit,
      asOfDate: effectiveAsOfDate
    });

    if (normalized.actualPercent === null) {
      throw new ValidationError(
        'Cannot persist ActivityProgress because no deterministic actual percentage is available.'
      );
    }

    const history = this.activityProgressRepo.listByActivityId(activity.id, projectId) as ActivityProgress[];

    let finalActualStart = normalized.actualStart;
    const historicalStartDates = history
      .map(r => r.actualStart)
      .filter((d): d is string => d !== null && d !== undefined && d.length > 0)
      .sort();

    if (historicalStartDates.length > 0) {
      const earliestHistoricalStart = historicalStartDates[0];
      if (finalActualStart) {
        finalActualStart =
          earliestHistoricalStart < finalActualStart ? earliestHistoricalStart : finalActualStart;
      } else if (normalized.status !== 'not_started') {
        finalActualStart = earliestHistoricalStart;
      }
    }

    let finalActualFinish = normalized.actualFinish;
    const historicalFinishDates = history
      .map(r => r.actualFinish)
      .filter((d): d is string => d !== null && d !== undefined && d.length > 0)
      .sort();

    if (historicalFinishDates.length > 0) {
      const earliestHistoricalFinish = historicalFinishDates[0];
      if (finalActualFinish) {
        finalActualFinish =
          earliestHistoricalFinish < finalActualFinish
            ? earliestHistoricalFinish
            : finalActualFinish;
      } else {
        finalActualFinish = earliestHistoricalFinish;
      }
    }

    const existing = this.activityProgressRepo.findExistingObservation(
      projectId,
      activity.id,
      updateId,
      effectiveAsOfDate,
      normalized.actualPercent,
      normalized.actualQuantity,
      normalized.status
    ) as ActivityProgress | null;

    if (existing) {
      logger.info(
        `ProgressService: Returning existing observation '${existing.id}' for activity '${activity.id}' as-of '${effectiveAsOfDate}'`
      );
      return existing;
    }

    const progressInput: CreateActivityProgressInput = {
      projectId,
      activityId: activity.id,
      progressUpdateId: updateId,
      actualPercent: normalized.actualPercent,
      actualQuantity: normalized.actualQuantity,
      actualStart: finalActualStart,
      actualFinish: finalActualFinish,
      status: normalized.status,
      asOfDate: effectiveAsOfDate,
      notes: normalized.notes
    };

    const eventInput: CreateProjectEventInput = {
      projectId,
      eventType: 'progress_updated',
      entityType: 'activity_progress',
      summary: `Activity progress recorded at ${normalized.actualPercent}% (${normalized.status}) for '${activity.name}'`,
      payloadJson: JSON.stringify({
        activityId: activity.id,
        progressUpdateId: updateId,
        matchId,
        actualPercent: normalized.actualPercent,
        actualQuantity: normalized.actualQuantity,
        status: normalized.status,
        asOfDate: effectiveAsOfDate
      })
    };

    const savedProgress = this.activityProgressRepo.createWithEvent(progressInput, eventInput) as ActivityProgress;
    logger.info(
      `ProgressService: Created activity progress '${savedProgress.id}' for activity '${activity.name}' (${savedProgress.actualPercent}%)`
    );

    return savedProgress;
  }

  listActivityProgress(projectId: string, activityId: string): MaybePromise<ActivityProgress[]> {
    const projectRes = this.projectRepo.getById(projectId);
    if (projectRes instanceof Promise) {
      return (async () => {
        const project = await projectRes;
        if (!project) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }

        const activity = await this.activityRepo.getById(activityId);
        if (!activity || activity.projectId !== projectId) {
          throw new NotFoundError(`Activity with ID '${activityId}' not found for project '${projectId}'`);
        }

        return await this.activityProgressRepo.listByActivityId(activityId, projectId);
      })();
    }

    const project = projectRes as Project | null;
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const activity = this.activityRepo.getById(activityId) as Activity | null;
    if (!activity || activity.projectId !== projectId) {
      throw new NotFoundError(`Activity with ID '${activityId}' not found for project '${projectId}'`);
    }

    return this.activityProgressRepo.listByActivityId(activityId, projectId) as ActivityProgress[];
  }

  getLatestActivityProgress(projectId: string, activityId: string): MaybePromise<ActivityProgress | null> {
    const projectRes = this.projectRepo.getById(projectId);
    if (projectRes instanceof Promise) {
      return (async () => {
        const project = await projectRes;
        if (!project) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }

        const activity = await this.activityRepo.getById(activityId);
        if (!activity || activity.projectId !== projectId) {
          throw new NotFoundError(`Activity with ID '${activityId}' not found for project '${projectId}'`);
        }

        return await this.activityProgressRepo.getLatestByActivityId(activityId, projectId);
      })();
    }

    const project = projectRes as Project | null;
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const activity = this.activityRepo.getById(activityId) as Activity | null;
    if (!activity || activity.projectId !== projectId) {
      throw new NotFoundError(`Activity with ID '${activityId}' not found for project '${projectId}'`);
    }

    return this.activityProgressRepo.getLatestByActivityId(activityId, projectId) as ActivityProgress | null;
  }

  listProgressByUpdate(projectId: string, updateId: string): MaybePromise<ActivityProgress[]> {
    const projectRes = this.projectRepo.getById(projectId);
    if (projectRes instanceof Promise) {
      return (async () => {
        const project = await projectRes;
        if (!project) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }

        const updateRecord = await this.progressUpdateRepo.getByIdAndProjectId(updateId, projectId);
        if (!updateRecord) {
          throw new NotFoundError(
            `Progress report with ID '${updateId}' not found for project '${projectId}'`
          );
        }

        return await this.activityProgressRepo.listByProgressUpdateId(updateId, projectId);
      })();
    }

    const project = projectRes as Project | null;
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const recordOrPromise = this.progressUpdateRepo.getByIdAndProjectId(updateId, projectId);
    if (recordOrPromise instanceof Promise) {
      return (async () => {
        const found = await recordOrPromise;
        if (!found) {
          throw new NotFoundError(
            `Progress report with ID '${updateId}' not found for project '${projectId}'`
          );
        }
        return await this.activityProgressRepo.listByProgressUpdateId(updateId, projectId);
      })();
    }

    if (!recordOrPromise) {
      throw new NotFoundError(
        `Progress report with ID '${updateId}' not found for project '${projectId}'`
      );
    }

    return this.activityProgressRepo.listByProgressUpdateId(updateId, projectId);
  }
}

export const progressService: ProgressService = new DefaultProgressService();
