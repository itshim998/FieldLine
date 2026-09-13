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
  ProjectEventRepository,
  projectEventRepository as defaultProjectEventRepo
} from '../../repositories/project-event.repository.js';
import {
  ProgressSnapshotService,
  progressSnapshotService as defaultProgressSnapshotService,
  validateSnapshotDate,
  getTodayDateString
} from '../snapshot/progress-snapshot.service.js';
import { diffInCalendarDays } from '../snapshot/progress-snapshot.calculator.js';
import { calculateProjectRiskStatus } from '../risk/risk-classification.calculator.js';
import {
  ProjectIntelligence,
  ProjectIntelligenceQueryOptions,
  ProjectIntelligenceService,
  DelayedActivityFact,
  AtRiskActivityFact,
  CompletedActivityFact,
  BehindScheduleActivityFact,
  ApproachingMilestoneFact,
  StaleActivityFact,
  RecentChangeFact,
  DEFAULT_RECENT_DAYS,
  DEFAULT_APPROACHING_DAYS,
  DEFAULT_RECENT_CHANGES_LIMIT,
  MAX_RECENT_CHANGES_LIMIT
} from './project-intelligence.types.js';

import { NotFoundError, ValidationError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';
import { Activity, ActivityProgress, ProjectProgressSnapshot, ProjectEvent } from '../../models/domain.types.js';
import { MaybePromise } from '../../database/provider.js';

export function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const SENSITIVE_KEY_NAMES = new Set([
  'filepath',
  'tempfilepath',
  'path',
  'absolutepath',
  'stack',
  'errorstack',
  'stacktrace'
]);

function stripSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEY_NAMES.has(key.toLowerCase())) {
      continue;
    }

    if (typeof value === 'string') {
      // Strip potential filesystem paths or raw error stacks
      if (
        /^([a-zA-Z]:[\\/]|^\/[a-zA-Z0-9_-]+)/.test(value) ||
        value.includes('node_modules') ||
        value.startsWith('Error:')
      ) {
        continue;
      }
      clean[key] = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      clean[key] = stripSensitiveFields(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      clean[key] = value.map((item) => {
        if (item && typeof item === 'object') {
          return stripSensitiveFields(item as Record<string, unknown>);
        }
        return item;
      });
    } else {
      clean[key] = value;
    }
  }

  return clean;
}

function sanitizeEventPayload(rawJson: string | null): Record<string, unknown> | null {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return stripSensitiveFields(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

export class DefaultProjectIntelligenceService implements ProjectIntelligenceService {
  private projectRepo: ProjectRepository;
  private activityRepo: ActivityRepository;
  private activityProgressRepo: ActivityProgressRepository;
  private projectEventRepo: ProjectEventRepository;
  private progressSnapshotService: ProgressSnapshotService;

  constructor(dependencies?: {
    projectRepo?: ProjectRepository;
    activityRepo?: ActivityRepository;
    activityProgressRepo?: ActivityProgressRepository;
    projectEventRepo?: ProjectEventRepository;
    progressSnapshotService?: ProgressSnapshotService;
  }) {
    this.projectRepo = dependencies?.projectRepo || defaultProjectRepo;
    this.activityRepo = dependencies?.activityRepo || defaultActivityRepo;
    this.activityProgressRepo =
      dependencies?.activityProgressRepo || defaultActivityProgressRepo;
    this.projectEventRepo = dependencies?.projectEventRepo || defaultProjectEventRepo;
    this.progressSnapshotService =
      dependencies?.progressSnapshotService || defaultProgressSnapshotService;
  }

  getIntelligence(
    projectId: string,
    options?: ProjectIntelligenceQueryOptions
  ): MaybePromise<ProjectIntelligence> {
    const canonicalAsOfDate = options?.asOfDate
      ? validateSnapshotDate(options.asOfDate)
      : getTodayDateString();

    const recentDays = options?.recentDays !== undefined ? options.recentDays : DEFAULT_RECENT_DAYS;
    if (!Number.isInteger(recentDays) || recentDays <= 0) {
      throw new ValidationError(`recentDays must be a positive integer (got ${recentDays})`);
    }

    const approachingDays =
      options?.approachingDays !== undefined
        ? options.approachingDays
        : DEFAULT_APPROACHING_DAYS;
    if (!Number.isInteger(approachingDays) || approachingDays < 0) {
      throw new ValidationError(
        `approachingDays must be a non-negative integer (got ${approachingDays})`
      );
    }

    const rawLimit = options?.limit ?? DEFAULT_RECENT_CHANGES_LIMIT;
    const limit = Math.max(1, Math.min(rawLimit, MAX_RECENT_CHANGES_LIMIT));
    const staleCutoffDate = addDaysToDate(canonicalAsOfDate, -recentDays);

    const projectRes = this.projectRepo.getById(projectId);
    if (projectRes instanceof Promise) {
      return projectRes.then(async (project) => {
        if (!project) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }
        const snapshot = await this.progressSnapshotService.getProgressSnapshot(projectId, canonicalAsOfDate);
        const activities = await this.activityRepo.listByProjectId(projectId);
        const observations = new Map<string, ActivityProgress | null>();
        await Promise.all(
          activities.map(async (act) => {
            const obs = await this.activityProgressRepo.getLatestByActivityIdAsOfDate(act.id, projectId, canonicalAsOfDate);
            observations.set(act.id, obs);
          })
        );
        const rawEvents = await this.projectEventRepo.listRecentByProject(projectId, {
          asOfDate: canonicalAsOfDate,
          sinceDate: staleCutoffDate,
          limit
        });
        return this.computeIntelligence(projectId, canonicalAsOfDate, snapshot, activities, observations, rawEvents, recentDays, approachingDays);
      });
    }

    if (!projectRes) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const snapshotRes = this.progressSnapshotService.getProgressSnapshot(projectId, canonicalAsOfDate);
    const activitiesRes = this.activityRepo.listByProjectId(projectId);
    const rawEventsRes = this.projectEventRepo.listRecentByProject(projectId, {
      asOfDate: canonicalAsOfDate,
      sinceDate: staleCutoffDate,
      limit
    });

    if (snapshotRes instanceof Promise || activitiesRes instanceof Promise || rawEventsRes instanceof Promise) {
      return Promise.all([
        Promise.resolve(snapshotRes),
        Promise.resolve(activitiesRes),
        Promise.resolve(rawEventsRes)
      ]).then(async ([snapshot, activities, rawEvents]) => {
        const observations = new Map<string, ActivityProgress | null>();
        await Promise.all(
          activities.map(async (act) => {
            const obs = await this.activityProgressRepo.getLatestByActivityIdAsOfDate(act.id, projectId, canonicalAsOfDate);
            observations.set(act.id, obs);
          })
        );
        return this.computeIntelligence(projectId, canonicalAsOfDate, snapshot, activities, observations, rawEvents, recentDays, approachingDays);
      });
    }

    const activities = activitiesRes;
    const observations = new Map<string, ActivityProgress | null>();
    for (const act of activities) {
      const obsRes = this.activityProgressRepo.getLatestByActivityIdAsOfDate(act.id, projectId, canonicalAsOfDate);
      if (obsRes instanceof Promise) {
        return Promise.all(
          activities.map(async (a) => {
            const o = await this.activityProgressRepo.getLatestByActivityIdAsOfDate(a.id, projectId, canonicalAsOfDate);
            return { id: a.id, obs: o };
          })
        ).then((items) => {
          const obsMap = new Map<string, ActivityProgress | null>();
          for (const item of items) obsMap.set(item.id, item.obs);
          return this.computeIntelligence(projectId, canonicalAsOfDate, snapshotRes, activities, obsMap, rawEventsRes, recentDays, approachingDays);
        });
      }
      observations.set(act.id, obsRes);
    }

    return this.computeIntelligence(projectId, canonicalAsOfDate, snapshotRes, activities, observations, rawEventsRes, recentDays, approachingDays);
  }

  private computeIntelligence(
    projectId: string,
    canonicalAsOfDate: string,
    snapshot: ProjectProgressSnapshot,
    activities: Activity[],
    observations: Map<string, ActivityProgress | null>,
    rawEvents: ProjectEvent[],
    recentDays: number,
    approachingDays: number
  ): ProjectIntelligence {
    const riskStatus = calculateProjectRiskStatus(snapshot);

    const delayed: DelayedActivityFact[] = riskStatus.activities
      .filter((act) => act.classification === 'DELAYED')
      .map((act) => ({
        activityId: act.activityId,
        externalId: act.externalId,
        name: act.name,
        plannedFinish: act.plannedFinish || '',
        actualProgress: act.actualProgress ?? 0,
        progressVariance: act.progressVariance ?? 0,
        overdue: Boolean(act.overdue),
        classification: 'DELAYED' as const,
        reasons: act.reasons
      }))
      .sort(
        (a, b) =>
          a.plannedFinish.localeCompare(b.plannedFinish) ||
          a.externalId.localeCompare(b.externalId) ||
          a.activityId.localeCompare(b.activityId)
      );

    const atRisk: AtRiskActivityFact[] = riskStatus.activities
      .filter((act) => act.classification === 'AT_RISK')
      .map((act) => ({
        activityId: act.activityId,
        externalId: act.externalId,
        name: act.name,
        classification: 'AT_RISK' as const,
        reasons: act.reasons,
        plannedFinish: act.plannedFinish || '',
        actualProgress: act.actualProgress ?? 0,
        progressVariance: act.progressVariance ?? 0
      }))
      .sort(
        (a, b) =>
          a.plannedFinish.localeCompare(b.plannedFinish) ||
          a.externalId.localeCompare(b.externalId) ||
          a.activityId.localeCompare(b.activityId)
      );

    const completedToday: CompletedActivityFact[] = [];
    for (const act of activities) {
      const obs = observations.get(act.id);
      const isCompleted =
        Boolean(obs) && (obs!.status === 'completed' || obs!.actualPercent >= 100);
      const finishDate = obs?.actualFinish ? obs.actualFinish.slice(0, 10) : null;

      if (obs && isCompleted && finishDate === canonicalAsOfDate) {
        completedToday.push({
          activityId: act.id,
          externalId: act.externalId,
          name: act.name,
          progressUpdateId: obs.progressUpdateId,
          asOfDate: obs.asOfDate,
          actualPercent: obs.actualPercent,
          actualFinish: obs.actualFinish,
          status: obs.status
        });
      }
    }
    completedToday.sort(
      (a, b) =>
        a.externalId.localeCompare(b.externalId) ||
        a.activityId.localeCompare(b.activityId)
    );

    const behindSchedule: BehindScheduleActivityFact[] = snapshot.activities
      .filter((act) => act.varianceState === 'behind')
      .map((act) => ({
        activityId: act.activityId,
        externalId: act.externalId,
        name: act.name,
        plannedProgress: act.plannedProgress,
        actualProgress: act.actualProgress,
        progressVariance: act.progressVariance,
        varianceState: act.varianceState,
        status: act.status,
        plannedFinish: act.plannedFinish,
        overdue: act.overdue
      }))
      .sort(
        (a, b) =>
          a.progressVariance - b.progressVariance ||
          a.externalId.localeCompare(b.externalId) ||
          a.activityId.localeCompare(b.activityId)
      );

    const milestoneEndDate = addDaysToDate(canonicalAsOfDate, approachingDays);
    const snapshotItemMap = new Map(snapshot.activities.map((item) => [item.activityId, item]));

    const approachingMilestones: ApproachingMilestoneFact[] = [];
    for (const act of activities) {
      if (act.plannedStart === act.plannedFinish) {
        if (
          act.plannedStart >= canonicalAsOfDate &&
          act.plannedStart <= milestoneEndDate
        ) {
          const daysUntil = diffInCalendarDays(canonicalAsOfDate, act.plannedStart);
          const snapItem = snapshotItemMap.get(act.id);
          approachingMilestones.push({
            activityId: act.id,
            externalId: act.externalId,
            name: act.name,
            milestoneDate: act.plannedStart,
            daysUntil,
            status: snapItem?.status ?? 'not_started',
            actualProgress: snapItem?.actualProgress ?? 0
          });
        }
      }
    }
    approachingMilestones.sort(
      (a, b) =>
        a.milestoneDate.localeCompare(b.milestoneDate) ||
        a.externalId.localeCompare(b.externalId) ||
        a.activityId.localeCompare(b.activityId)
    );

    const staleCutoffDate = addDaysToDate(canonicalAsOfDate, -recentDays);
    const staleActivities: StaleActivityFact[] = [];

    for (const act of activities) {
      const latestObs = observations.get(act.id);

      if (!latestObs) {
        staleActivities.push({
          activityId: act.id,
          externalId: act.externalId,
          name: act.name,
          latestUpdateDate: null,
          daysSinceUpdate: null,
          hasAnyUpdate: false
        });
      } else {
        const daysSinceObs = diffInCalendarDays(latestObs.asOfDate, canonicalAsOfDate);
        if (latestObs.asOfDate < staleCutoffDate) {
          staleActivities.push({
            activityId: act.id,
            externalId: act.externalId,
            name: act.name,
            latestUpdateDate: latestObs.asOfDate,
            daysSinceUpdate: daysSinceObs,
            hasAnyUpdate: true
          });
        }
      }
    }

    staleActivities.sort((a, b) => {
      const aHasObs = a.hasAnyUpdate;
      const bHasObs = b.hasAnyUpdate;
      if (!aHasObs && bHasObs) return -1;
      if (aHasObs && !bHasObs) return 1;
      if (!aHasObs && !bHasObs) {
        return (
          a.externalId.localeCompare(b.externalId) ||
          a.activityId.localeCompare(b.activityId)
        );
      }
      return (
        (a.latestUpdateDate || '').localeCompare(b.latestUpdateDate || '') ||
        a.externalId.localeCompare(b.externalId) ||
        a.activityId.localeCompare(b.activityId)
      );
    });

    const recentChanges: RecentChangeFact[] = rawEvents.map((evt) => ({
      eventId: evt.id,
      eventType: evt.eventType,
      entityType: evt.entityType,
      entityId: evt.entityId,
      summary: evt.summary,
      createdAt: evt.createdAt,
      payload: sanitizeEventPayload(evt.payloadJson)
    }));

    logger.info(
      `ProjectIntelligenceService: Generated intelligence for project '${projectId}' as-of '${canonicalAsOfDate}' (delayed: ${delayed.length}, atRisk: ${atRisk.length}, completedToday: ${completedToday.length}, behind: ${behindSchedule.length}, milestones: ${approachingMilestones.length}, stale: ${staleActivities.length}, recentEvents: ${recentChanges.length})`
    );

    return {
      projectId,
      asOfDate: canonicalAsOfDate,
      generatedAt: snapshot.generatedAt,
      delayed,
      atRisk,
      completedToday,
      behindSchedule,
      approachingMilestones,
      staleActivities,
      recentChanges
    };
  }
}

export const projectIntelligenceService: ProjectIntelligenceService =
  new DefaultProjectIntelligenceService();

export type { ProjectIntelligenceService };
