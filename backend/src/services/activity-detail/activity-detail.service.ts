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
import { ProgressUpdateSourceType } from '../../models/domain.types.js';

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
  ): ActivityDetail {
    // 1. Verify project exists
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    // 2. Verify activity exists and strictly belongs to the requested project
    const activity = this.activityRepo.getByIdAndProjectId(activityId, projectId);
    if (!activity) {
      throw new NotFoundError(
        `Activity with ID '${activityId}' not found for project '${projectId}'`
      );
    }

    // 3. Resolve canonical snapshot date (validated via existing canonical validator)
    const canonicalAsOfDate = options?.asOfDate
      ? validateSnapshotDate(options.asOfDate)
      : getTodayDateString();

    // 4. Obtain canonical Current State from Snapshot & Risk services (reusing deterministic domain logic)
    const snapshot = this.progressSnapshotService.getProgressSnapshot(projectId, canonicalAsOfDate);
    const riskStatus = this.riskClassificationService.getProjectRiskStatus(projectId, canonicalAsOfDate);

    const snapItem = snapshot.activities.find((a) => a.activityId === activityId);
    const riskItem = riskStatus.activities.find((a) => a.activityId === activityId);

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
      asOfDate: canonicalAsOfDate
    };

    // 5. Query ActivityProgress history (strictly project-scoped)
    const allObservations = this.activityProgressRepo.listByActivityId(activityId, projectId);

    // Filter by historical semantic boundary (observation.asOfDate <= canonicalAsOfDate)
    // and sort deterministically: asOfDate ASC, createdAt ASC, id ASC
    const filteredObservations = allObservations
      .filter((obs) => obs.asOfDate <= canonicalAsOfDate)
      .sort(
        (a, b) =>
          a.asOfDate.localeCompare(b.asOfDate) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id)
      );

    // 6. Query ActivityMatches (strictly project-scoped)
    const rawMatches = this.activityMatchRepo.listByActivityId(activityId, projectId);

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
      canonicalProgressEligible: m.status === 'confirmed'
    }));

    // 7. Batch lookup for relevant field progress reports (avoiding N+1 queries)
    const updateIdSet = new Set<string>();
    for (const obs of filteredObservations) {
      if (obs.progressUpdateId) {
        updateIdSet.add(obs.progressUpdateId);
      }
    }
    for (const m of matches) {
      if (m.progressUpdateId) {
        updateIdSet.add(m.progressUpdateId);
      }
    }

    const uniqueUpdateIds = Array.from(updateIdSet);
    const progressUpdateRecords = this.progressUpdateRepo.listByIds(uniqueUpdateIds, projectId);
    const updateMap = new Map(progressUpdateRecords.map((u) => [u.id, u]));

    // Map originating field report DTOs
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

    // Map Timeline items resolving source from originating field report
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

    // 8. Query Evidence through traceable provenance (strictly project/activity-scoped & deduplicated)
    const rawEvidence = this.evidenceRepo.listByActivityId(activityId, projectId);
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

    // 9. Activity Identity section
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
