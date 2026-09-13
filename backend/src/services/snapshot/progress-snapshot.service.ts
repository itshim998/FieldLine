import {
  ProjectRepository,
  projectRepository as defaultProjectRepo
} from '../../repositories/project.repository.js';
import {
  ActivityRepository,
  activityRepository as defaultActivityRepo
} from '../../repositories/activity.repository.js';
import {
  ActivityProgressRepository,
  activityProgressRepository as defaultActivityProgressRepo
} from '../../repositories/activity-progress.repository.js';
import {
  ProjectProgressSnapshot,
  ProgressSnapshotService
} from './progress-snapshot.types.js';
import { calculateProjectSnapshot } from './progress-snapshot.calculator.js';

export type { ProgressSnapshotService };
import { NotFoundError, ValidationError } from '../../errors/AppError.js';
import { getDaysInMonth } from '../normalization/date-normalizer.js';
import { logger } from '../../config/logger.js';
import { ActivityProgress } from '../../models/domain.types.js';
import { MaybePromise } from '../../database/provider.js';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function validateSnapshotDate(dateStr: string): string {
  if (!DATE_REGEX.test(dateStr)) {
    throw new ValidationError(
      `Invalid asOfDate '${dateStr}'. Date must be in YYYY-MM-DD format.`
    );
  }

  const [y, m, d] = dateStr.split('-').map(Number);
  if (m < 1 || m > 12) {
    throw new ValidationError(`Invalid month in asOfDate '${dateStr}'.`);
  }

  const maxDays = getDaysInMonth(y, m);
  if (d < 1 || d > maxDays) {
    throw new ValidationError(
      `Invalid day ${d} in asOfDate '${dateStr}' (month ${m} has max ${maxDays} days).`
    );
  }

  return dateStr;
}

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class DefaultProgressSnapshotService implements ProgressSnapshotService {
  private projectRepo: ProjectRepository;
  private activityRepo: ActivityRepository;
  private activityProgressRepo: ActivityProgressRepository;

  constructor(dependencies?: {
    projectRepo?: ProjectRepository;
    activityRepo?: ActivityRepository;
    activityProgressRepo?: ActivityProgressRepository;
  }) {
    this.projectRepo = dependencies?.projectRepo || defaultProjectRepo;
    this.activityRepo = dependencies?.activityRepo || defaultActivityRepo;
    this.activityProgressRepo = dependencies?.activityProgressRepo || defaultActivityProgressRepo;
  }

  getProgressSnapshot(projectId: string, asOfDate?: string): MaybePromise<ProjectProgressSnapshot> {
    // 2. Resolve single canonical snapshot date
    const canonicalAsOfDate = asOfDate
      ? validateSnapshotDate(asOfDate)
      : getTodayDateString();

    const projectRes = this.projectRepo.getById(projectId);
    if (projectRes instanceof Promise) {
      return projectRes.then(async (project) => {
        if (!project) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }
        const activities = await this.activityRepo.listByProjectId(projectId);
        const observations = new Map<string, ActivityProgress | null>();
        await Promise.all(
          activities.map(async (act) => {
            const obs = await this.activityProgressRepo.getLatestByActivityIdAsOfDate(
              act.id,
              projectId,
              canonicalAsOfDate
            );
            observations.set(act.id, obs);
          })
        );
        const snapshot = calculateProjectSnapshot(
          projectId,
          canonicalAsOfDate,
          activities,
          observations
        );
        logger.info(
          `ProgressSnapshotService: Generated snapshot for project '${projectId}' as-of '${canonicalAsOfDate}' (${activities.length} activities)`
        );
        return snapshot;
      });
    }

    if (!projectRes) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const activitiesRes = this.activityRepo.listByProjectId(projectId);
    if (activitiesRes instanceof Promise) {
      return activitiesRes.then(async (activities) => {
        const observations = new Map<string, ActivityProgress | null>();
        await Promise.all(
          activities.map(async (act) => {
            const obs = await this.activityProgressRepo.getLatestByActivityIdAsOfDate(
              act.id,
              projectId,
              canonicalAsOfDate
            );
            observations.set(act.id, obs);
          })
        );
        const snapshot = calculateProjectSnapshot(
          projectId,
          canonicalAsOfDate,
          activities,
          observations
        );
        logger.info(
          `ProgressSnapshotService: Generated snapshot for project '${projectId}' as-of '${canonicalAsOfDate}' (${activities.length} activities)`
        );
        return snapshot;
      });
    }

    const activities = activitiesRes;
    const observations = new Map<string, ActivityProgress | null>();
    for (const act of activities) {
      const obsRes = this.activityProgressRepo.getLatestByActivityIdAsOfDate(
        act.id,
        projectId,
        canonicalAsOfDate
      );
      if (obsRes instanceof Promise) {
        return Promise.all(
          activities.map(async (a) => {
            const o = await this.activityProgressRepo.getLatestByActivityIdAsOfDate(
              a.id,
              projectId,
              canonicalAsOfDate
            );
            return { id: a.id, obs: o };
          })
        ).then((items) => {
          const obsMap = new Map<string, ActivityProgress | null>();
          for (const item of items) obsMap.set(item.id, item.obs);
          return calculateProjectSnapshot(projectId, canonicalAsOfDate, activities, obsMap);
        });
      }
      observations.set(act.id, obsRes);
    }

    const snapshot = calculateProjectSnapshot(
      projectId,
      canonicalAsOfDate,
      activities,
      observations
    );

    logger.info(
      `ProgressSnapshotService: Generated snapshot for project '${projectId}' as-of '${canonicalAsOfDate}' (${activities.length} activities)`
    );

    return snapshot;
  }
}

export const progressSnapshotService: ProgressSnapshotService =
  new DefaultProgressSnapshotService();
