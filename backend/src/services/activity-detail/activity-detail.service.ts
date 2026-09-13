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
  ProgressUpdateRepository,
  progressUpdateRepository as defaultProgressUpdateRepo
} from '../../repositories/progress-update.repository.js';
import {
  ActivityMatchRepository,
  activityMatchRepository as defaultActivityMatchRepo
} from '../../repositories/activity-match.repository.js';
import {
  EvidenceRepository,
  evidenceRepository as defaultEvidenceRepo
} from '../../repositories/evidence.repository.js';
import {
  ProgressSnapshotService,
  progressSnapshotService as defaultProgressSnapshotService,
  validateSnapshotDate,
  getTodayDateString
} from '../snapshot/progress-snapshot.service.js';
import {
  RiskClassificationService,
  riskClassificationService as defaultRiskClassificationService
} from '../risk/risk-classification.service.js';
import {
  ActivityDetail,
  ActivityDetailActivity,
  ActivityDetailCurrentState,
  ActivityDetailEvidence,
  ActivityDetailMatch,
  ActivityDetailProgressUpdateItem,
  ActivityDetailQueryOptions,
  ActivityDetailService,
  ActivityDetailTimelineItem
} from './activity-detail.types.js';
import { NotFoundError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';
import {
  ProgressUpdateSourceType,
  Activity,
  ActivityProgress,
  ActivityMatch,
  ProgressUpdate,
  ProjectProgressSnapshot,
  ProjectRiskStatus
} from '../../models/domain.types.js';
import { MaybePromise } from '../../database/provider.js';

export class DefaultActivityDetailService implements ActivityDetailService {
  private projectRepo: ProjectRepository;
  private activityRepo: ActivityRepository;
  private activityProgressRepo: ActivityProgressRepository;
  private progressUpdateRepo: ProgressUpdateRepository;
  private activityMatchRepo: ActivityMatchRepository;
  private evidenceRepo: EvidenceRepository;
  private progressSnapshotService: ProgressSnapshotService;
  private riskClassificationService: RiskClassificationService;

  constructor(dependencies?: {
    projectRepo?: ProjectRepository;
    activityRepo?: ActivityRepository;
    activityProgressRepo?: ActivityProgressRepository;
    progressUpdateRepo?: ProgressUpdateRepository;
    activityMatchRepo?: ActivityMatchRepository;
    evidenceRepo?: EvidenceRepository;
    progressSnapshotService?: ProgressSnapshotService;
    riskClassificationService?: RiskClassificationService;
  }) {
    this.projectRepo = dependencies?.projectRepo || defaultProjectRepo;
    this.activityRepo = dependencies?.activityRepo || defaultActivityRepo;
    this.activityProgressRepo = dependencies?.activityProgressRepo || defaultActivityProgressRepo;
    this.progressUpdateRepo = dependencies?.progressUpdateRepo || defaultProgressUpdateRepo;
    this.activityMatchRepo = dependencies?.activityMatchRepo || defaultActivityMatchRepo;
    this.evidenceRepo = dependencies?.evidenceRepo || defaultEvidenceRepo;
    this.progressSnapshotService =
      dependencies?.progressSnapshotService || defaultProgressSnapshotService;
    this.riskClassificationService =
      dependencies?.riskClassificationService || defaultRiskClassificationService;
  }

  getActivityDetail(
    projectId: string,
    activityId: string,
    options?: ActivityDetailQueryOptions
  ): MaybePromise<ActivityDetail> {
    const canonicalAsOfDate = options?.asOfDate
      ? validateSnapshotDate(options.asOfDate)
      : getTodayDateString();

    const projectRes = this.projectRepo.getById(projectId);
    if (projectRes instanceof Promise) {
      return projectRes.then(async (project) => {
        if (!project) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }
        const activity = await this.activityRepo.getByIdAndProjectId(activityId, projectId);
        if (!activity) {
          throw new NotFoundError(
            `Activity with ID '${activityId}' not found for project '${projectId}'`
          );
        }
        const snapshot = await this.progressSnapshotService.getProgressSnapshot(
          projectId,
          canonicalAsOfDate
        );
        const riskStatus = await this.riskClassificationService.getProjectRiskStatus(
          projectId,
          canonicalAsOfDate
        );
        const allObservations = await this.activityProgressRepo.listByActivityId(
          activityId,
          projectId
        );
        const rawMatches = await this.activityMatchRepo.listByActivityId(activityId, projectId);

        const filteredObservations = allObservations
          .filter((obs) => obs.asOfDate <= canonicalAsOfDate)
          .sort(
            (a, b) =>
              a.asOfDate.localeCompare(b.asOfDate) ||
              a.createdAt.localeCompare(b.createdAt) ||
              a.id.localeCompare(b.id)
          );

        const updateIdSet = new Set<string>();
        for (const obs of filteredObservations) {
          if (obs.progressUpdateId) updateIdSet.add(obs.progressUpdateId);
        }
        for (const m of rawMatches) {
          if (m.progressUpdateId) updateIdSet.add(m.progressUpdateId);
        }
        const uniqueUpdateIds = Array.from(updateIdSet);
        const progressUpdateRecords = await this.progressUpdateRepo.listByIds(
          uniqueUpdateIds,
          projectId
        );
        const rawEvidence = await this.evidenceRepo.listByActivityId(activityId, projectId);

        return this.composeDetail(
          projectId,
          activity,
          canonicalAsOfDate,
          snapshot,
          riskStatus,
          filteredObservations,
          rawMatches,
          progressUpdateRecords,
          rawEvidence
        );
      });
    }

    if (!projectRes) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const activityRes = this.activityRepo.getByIdAndProjectId(activityId, projectId);
    if (activityRes instanceof Promise) {
      return Promise.resolve(activityRes).then((act) => {
        if (!act) {
          throw new NotFoundError(
            `Activity with ID '${activityId}' not found for project '${projectId}'`
          );
        }
        return this.getActivityDetail(projectId, activityId, options);
      });
    }

    if (!activityRes) {
      throw new NotFoundError(
        `Activity with ID '${activityId}' not found for project '${projectId}'`
      );
    }

    const snapshotRes = this.progressSnapshotService.getProgressSnapshot(projectId, canonicalAsOfDate);
    const riskStatusRes = this.riskClassificationService.getProjectRiskStatus(projectId, canonicalAsOfDate);
    const allObservationsRes = this.activityProgressRepo.listByActivityId(activityId, projectId);
    const rawMatchesRes = this.activityMatchRepo.listByActivityId(activityId, projectId);
    const rawEvidenceRes = this.evidenceRepo.listByActivityId(activityId, projectId);

    if (
      snapshotRes instanceof Promise ||
      riskStatusRes instanceof Promise ||
      allObservationsRes instanceof Promise ||
      rawMatchesRes instanceof Promise ||
      rawEvidenceRes instanceof Promise
    ) {
      return Promise.all([
        Promise.resolve(snapshotRes),
        Promise.resolve(riskStatusRes),
        Promise.resolve(allObservationsRes),
        Promise.resolve(rawMatchesRes),
        Promise.resolve(rawEvidenceRes)
      ]).then(async ([snapshot, riskStatus, allObservations, rawMatches, rawEvidence]) => {
        const filteredObservations = allObservations
          .filter((obs) => obs.asOfDate <= canonicalAsOfDate)
          .sort(
            (a, b) =>
              a.asOfDate.localeCompare(b.asOfDate) ||
              a.createdAt.localeCompare(b.createdAt) ||
              a.id.localeCompare(b.id)
          );
        const updateIdSet = new Set<string>();
        for (const obs of filteredObservations) {
          if (obs.progressUpdateId) updateIdSet.add(obs.progressUpdateId);
        }
        for (const m of rawMatches) {
          if (m.progressUpdateId) updateIdSet.add(m.progressUpdateId);
        }
        const uniqueUpdateIds = Array.from(updateIdSet);
        const progressUpdateRecords = await this.progressUpdateRepo.listByIds(
          uniqueUpdateIds,
          projectId
        );
        return this.composeDetail(
          projectId,
          activityRes,
          canonicalAsOfDate,
          snapshot,
          riskStatus,
          filteredObservations,
          rawMatches,
          progressUpdateRecords,
          rawEvidence
        );
      });
    }

    const filteredObservations = allObservationsRes
      .filter((obs) => obs.asOfDate <= canonicalAsOfDate)
      .sort(
        (a, b) =>
          a.asOfDate.localeCompare(b.asOfDate) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id)
      );

    const updateIdSet = new Set<string>();
    for (const obs of filteredObservations) {
      if (obs.progressUpdateId) updateIdSet.add(obs.progressUpdateId);
    }
    for (const m of rawMatchesRes) {
      if (m.progressUpdateId) updateIdSet.add(m.progressUpdateId);
    }
    const uniqueUpdateIds = Array.from(updateIdSet);
    const progressUpdateRecordsRes = this.progressUpdateRepo.listByIds(uniqueUpdateIds, projectId);
    if (progressUpdateRecordsRes instanceof Promise) {
      return progressUpdateRecordsRes.then((progressUpdateRecords) =>
        this.composeDetail(
          projectId,
          activityRes,
          canonicalAsOfDate,
          snapshotRes,
          riskStatusRes,
          filteredObservations,
          rawMatchesRes,
          progressUpdateRecords,
          rawEvidenceRes
        )
      );
    }

    return this.composeDetail(
      projectId,
      activityRes,
      canonicalAsOfDate,
      snapshotRes,
      riskStatusRes,
      filteredObservations,
      rawMatchesRes,
      progressUpdateRecordsRes,
      rawEvidenceRes
    );
  }

  private composeDetail(
    projectId: string,
    activity: Activity,
    canonicalAsOfDate: string,
    snapshot: ProjectProgressSnapshot,
    riskStatus: ProjectRiskStatus,
    filteredObservations: ActivityProgress[],
    rawMatches: ActivityMatch[],
    progressUpdateRecords: ProgressUpdate[],
    rawEvidence: any[]
  ): ActivityDetail {
    const snapItem = snapshot.activities.find((a) => a.activityId === activity.id);
    const riskItem = riskStatus.activities.find((a) => a.activityId === activity.id);

    const hasAnomalyFlag = rawMatches.some(
      (m) =>
        m.anomalySeverity === 'review' ||
        m.anomalySeverity === 'high' ||
        (m.anomalyScore !== null && m.anomalyScore !== undefined && m.anomalyScore >= 0.5)
    );

    const current: ActivityDetailCurrentState = {
      plannedProgress: snapItem ? snapItem.plannedProgress : 0,
      actualProgress: snapItem ? snapItem.actualProgress : 0,
      progressVariance: snapItem ? snapItem.progressVariance : 0,
      varianceState: snapItem ? snapItem.varianceState : 'on_plan',
      status: snapItem ? snapItem.status : 'not_started',
      overdue: snapItem ? snapItem.overdue : false,
      riskClassification: riskItem ? riskItem.classification : 'ON_TRACK',
      riskReasons: riskItem ? riskItem.reasons : [],
      actualStart: snapItem ? snapItem.actualStart : null,
      actualFinish: snapItem ? snapItem.actualFinish : null,
      asOfDate: canonicalAsOfDate,
      ...(hasAnomalyFlag ? { flaggedForVerification: true } : {})
    };

    const matches: ActivityDetailMatch[] = rawMatches.map((m) => ({
      matchId: m.id,
      progressUpdateId: m.progressUpdateId,
      confidenceScore: m.confidenceScore,
      confidenceTier: m.confidenceTier,
      reviewState: m.reviewState,
      status: m.status,
      matchMethod: m.matchMethod,
      matchedText: m.matchedText,
      rationale: m.rationale,
      reviewedBy: m.reviewedBy,
      reviewedAt: m.reviewedAt,
      canonicalProgressEligible: m.status === 'confirmed',
      mlConfidence: m.mlConfidence ?? null,
      anomalyScore: m.anomalyScore ?? null,
      anomalySeverity: m.anomalySeverity ?? null,
      anomalyReasons: m.anomalyReasons ?? null
    }));

    const updateMap = new Map(progressUpdateRecords.map((u) => [u.id, u]));

    const progressUpdates: ActivityDetailProgressUpdateItem[] = progressUpdateRecords.map((u) => ({
      progressUpdateId: u.id,
      reportDate: u.reportDate,
      reporterName: u.reporterName,
      reporterRole: u.reporterRole,
      sourceType: u.sourceType,
      status: u.status,
      rawText: u.rawText,
      createdAt: u.createdAt
    }));

    const timeline: ActivityDetailTimelineItem[] = filteredObservations.map((obs) => {
      let source: ProgressUpdateSourceType = 'manual';
      if (obs.progressUpdateId) {
        const updateRec = updateMap.get(obs.progressUpdateId);
        if (updateRec) {
          source = updateRec.sourceType;
        }
      }

      return {
        progressId: obs.id,
        progressUpdateId: obs.progressUpdateId,
        date: obs.asOfDate,
        actualPercent: obs.actualPercent,
        actualQuantity: obs.actualQuantity,
        actualStart: obs.actualStart,
        actualFinish: obs.actualFinish,
        status: obs.status,
        notes: obs.notes,
        createdAt: obs.createdAt,
        source
      };
    });

    const seenEvidenceIds = new Set<string>();
    const evidence: ActivityDetailEvidence[] = [];

    for (const e of rawEvidence) {
      if (!seenEvidenceIds.has(e.id)) {
        seenEvidenceIds.add(e.id);
        evidence.push({
          evidenceId: e.id,
          fileName: e.fileName,
          fileType: e.fileType,
          fileSizeBytes: e.fileSizeBytes,
          uploadedAt: e.uploadedAt,
          progressUpdateId: e.progressUpdateId
        });
      }
    }

    const activityDto: ActivityDetailActivity = {
      activityId: activity.id,
      externalId: activity.externalId,
      name: activity.name,
      description: activity.description,
      wbsCode: activity.wbsCode,
      location: activity.location,
      scheduleId: activity.scheduleId,
      plannedStart: activity.plannedStart,
      plannedFinish: activity.plannedFinish,
      plannedQuantity: activity.plannedQuantity,
      unit: activity.unit,
      baselineProgress: activity.baselineProgress
    };

    logger.info(
      `ActivityDetailService: Composed detail for activity '${activity.externalId}' (${activity.name}) in project '${projectId}' as-of '${canonicalAsOfDate}' (timeline: ${timeline.length} items, matches: ${matches.length}, evidence: ${evidence.length})`
    );

    return {
      activity: activityDto,
      current,
      timeline,
      progressUpdates,
      matches,
      evidence
    };
  }
}

export const activityDetailService: ActivityDetailService = new DefaultActivityDetailService();
