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
import {
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
  normalizeAndRecordProgress(input: NormalizeAndRecordProgressInput): ActivityProgress;
  listActivityProgress(projectId: string, activityId: string): ActivityProgress[];
  getLatestActivityProgress(projectId: string, activityId: string): ActivityProgress | null;
  listProgressByUpdate(projectId: string, updateId: string): ActivityProgress[];
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

  normalizeAndRecordProgress(input: NormalizeAndRecordProgressInput): ActivityProgress {
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

    // 1. Verify project exists
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    // 2. Verify progress report exists and belongs to the specified project
    const updateRecord = this.progressUpdateRepo.getByIdAndProjectId(updateId, projectId);
    if (!updateRecord) {
      throw new NotFoundError(
        `Progress report with ID '${updateId}' not found for project '${projectId}'`
      );
    }

    // 3. Verify activity match exists and belongs to the specified project
    const match = this.activityMatchRepo.getByIdAndProjectId(matchId, projectId);
    if (!match) {
      throw new NotFoundError(
        `Activity match with ID '${matchId}' not found for project '${projectId}'`
      );
    }

    // 4. Verify activity match belongs to the specific progress report
    if (match.progressUpdateId !== updateId) {
      throw new ValidationError(
        `Activity match '${matchId}' belongs to progress report '${match.progressUpdateId}', not '${updateId}'`
      );
    }



    // 5. Enforce Match Status Policy
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

    // 6. Verify matched activity belongs to the project
    const activity = this.activityRepo.getById(match.activityId);
    if (!activity || activity.projectId !== projectId) {
      throw new NotFoundError(
        `Matched activity with ID '${match.activityId}' not found for project '${projectId}'`
      );
    }

    // 7. Determine effective as-of date (defaults to progress update's reportDate)
    const effectiveAsOfDate = asOfDate || updateRecord.reportDate;

    // 8. Run pure deterministic progress normalization
    const normalized = normalizeProgress({
      fact,
      activity,
      actualQuantity,
      quantityUnit,
      asOfDate: effectiveAsOfDate
    });

    // 9. Enforce numeric percentage requirement (actual_percent is NOT NULL)
    if (normalized.actualPercent === null) {
      throw new ValidationError(
        'Cannot persist ActivityProgress because no deterministic actual percentage is available.'
      );
    }

    // 10. Reconcile dates against historical activity progress records
    const history = this.activityProgressRepo.listByActivityId(activity.id, projectId);

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

    const finalActualFinish = normalized.actualFinish;

    // 11. Idempotency Check: Avoid uncontrolled duplicate observations
    const existing = this.activityProgressRepo.findExistingObservation(
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

    // 12. Atomic Persistence of ActivityProgress + progress_updated ProjectEvent
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
      summary: `Activity progress recorded: ${activity.name} (${normalized.actualPercent}%)`,
      payloadJson: JSON.stringify({
        activityId: activity.id,
        activityName: activity.name,
        progressUpdateId: updateId,
        actualPercent: normalized.actualPercent,
        actualQuantity: normalized.actualQuantity,
        status: normalized.status,
        percentSource: normalized.percentSource,
        asOfDate: effectiveAsOfDate
      })
    };

    const savedProgress = this.activityProgressRepo.createWithEvent(progressInput, eventInput);
    logger.info(
      `ProgressService: Created activity progress '${savedProgress.id}' for activity '${activity.name}' (${savedProgress.actualPercent}%)`
    );

    return savedProgress;
  }

  listActivityProgress(projectId: string, activityId: string): ActivityProgress[] {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const activity = this.activityRepo.getById(activityId);
    if (!activity || activity.projectId !== projectId) {
      throw new NotFoundError(`Activity with ID '${activityId}' not found for project '${projectId}'`);
    }

    return this.activityProgressRepo.listByActivityId(activityId, projectId);
  }

  getLatestActivityProgress(projectId: string, activityId: string): ActivityProgress | null {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const activity = this.activityRepo.getById(activityId);
    if (!activity || activity.projectId !== projectId) {
      throw new NotFoundError(`Activity with ID '${activityId}' not found for project '${projectId}'`);
    }

    return this.activityProgressRepo.getLatestByActivityId(activityId, projectId);
  }

  listProgressByUpdate(projectId: string, updateId: string): ActivityProgress[] {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const updateRecord = this.progressUpdateRepo.getByIdAndProjectId(updateId, projectId);
    if (!updateRecord) {
      throw new NotFoundError(
        `Progress report with ID '${updateId}' not found for project '${projectId}'`
      );
    }

    return this.activityProgressRepo.listByProgressUpdateId(updateId, projectId);
  }
}

export const progressService: ProgressService = new DefaultProgressService();
