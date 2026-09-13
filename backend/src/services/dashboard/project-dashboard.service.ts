import {
  ProjectRepository,
  projectRepository as defaultProjectRepo
} from '../../repositories/project.repository.js';
import {
  ActivityRepository,
  activityRepository as defaultActivityRepo
} from '../../repositories/activity.repository.js';
import {
  ProgressUpdateRepository,
  progressUpdateRepository as defaultProgressUpdateRepo
} from '../../repositories/progress-update.repository.js';
import {
  ActivityMatchRepository,
  activityMatchRepository as defaultActivityMatchRepo
} from '../../repositories/activity-match.repository.js';
import {
  ActivityProgressRepository,
  activityProgressRepository as defaultActivityProgressRepo
} from '../../repositories/activity-progress.repository.js';
import {
  EvidenceRepository,
  evidenceRepository as defaultEvidenceRepo
} from '../../repositories/evidence.repository.js';
import {
  OperationalBlockerRepository,
  operationalBlockerRepository as defaultBlockerRepo
} from '../../repositories/operational-blocker.repository.js';
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
  projectIntelligenceService as defaultProjectIntelligenceService
} from '../intelligence/project-intelligence.service.js';
import type { ProjectIntelligenceService } from '../intelligence/project-intelligence.types.js';
import {
  ProjectDashboard,
  ProjectDashboardQueryOptions,
  ProjectDashboardService,
  ProjectSummary,
  ProjectHealthSummary,
  ActivityStatusSummary,
  DashboardMilestoneItem,
  DashboardMilestoneSection,
  DashboardAttentionSummary,
  DashboardUnresolvedMatchItem,
  DashboardRecentUpdateItem,
  DashboardMatchItem,
  DashboardProgressObservationItem,
  DashboardEvidenceItem,
  DashboardActiveBlockerItem
} from './dashboard.types.js';
import type { MaybePromise } from '../../database/provider.js';
import type {
  Project,
  Activity,
  ActivityMatch,
  ProgressUpdate,
  OperationalBlocker,
  ActivityProgress,
  Evidence
} from '../../models/domain.types.js';
import type { ProjectProgressSnapshot } from '../snapshot/progress-snapshot.types.js';
import type { ProjectRiskStatus } from '../risk/risk-classification.types.js';
import type { ProjectIntelligence } from '../intelligence/project-intelligence.types.js';
import { NotFoundError, ValidationError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';
import { diffInCalendarDays } from '../snapshot/progress-snapshot.calculator.js';

export const DEFAULT_DASHBOARD_RECENT_LIMIT = 10;
export const MAX_DASHBOARD_RECENT_LIMIT = 50;

export class DefaultProjectDashboardService implements ProjectDashboardService {
  private projectRepo: ProjectRepository;
  private activityRepo: ActivityRepository;
  private progressUpdateRepo: ProgressUpdateRepository;
  private activityMatchRepo: ActivityMatchRepository;
  private activityProgressRepo: ActivityProgressRepository;
  private evidenceRepo: EvidenceRepository;
  private progressSnapshotService: ProgressSnapshotService;
  private riskClassificationService: RiskClassificationService;
  private projectIntelligenceService: ProjectIntelligenceService;
  private blockerRepo: OperationalBlockerRepository;

  constructor(dependencies?: {
    projectRepo?: ProjectRepository;
    activityRepo?: ActivityRepository;
    progressUpdateRepo?: ProgressUpdateRepository;
    activityMatchRepo?: ActivityMatchRepository;
    activityProgressRepo?: ActivityProgressRepository;
    evidenceRepo?: EvidenceRepository;
    progressSnapshotService?: ProgressSnapshotService;
    riskClassificationService?: RiskClassificationService;
    projectIntelligenceService?: ProjectIntelligenceService;
    blockerRepo?: OperationalBlockerRepository;
  }) {
    this.projectRepo = dependencies?.projectRepo || defaultProjectRepo;
    this.activityRepo = dependencies?.activityRepo || defaultActivityRepo;
    this.progressUpdateRepo = dependencies?.progressUpdateRepo || defaultProgressUpdateRepo;
    this.activityMatchRepo = dependencies?.activityMatchRepo || defaultActivityMatchRepo;
    this.activityProgressRepo = dependencies?.activityProgressRepo || defaultActivityProgressRepo;
    this.evidenceRepo = dependencies?.evidenceRepo || defaultEvidenceRepo;
    this.progressSnapshotService =
      dependencies?.progressSnapshotService || defaultProgressSnapshotService;
    this.riskClassificationService =
      dependencies?.riskClassificationService || defaultRiskClassificationService;
    this.projectIntelligenceService =
      dependencies?.projectIntelligenceService || defaultProjectIntelligenceService;
    this.blockerRepo = dependencies?.blockerRepo || defaultBlockerRepo;
  }

  getDashboard(
    projectId: string,
    options?: ProjectDashboardQueryOptions
  ): MaybePromise<ProjectDashboard> {
    const canonicalAsOfDate = options?.asOfDate
      ? validateSnapshotDate(options.asOfDate)
      : getTodayDateString();

    const recentLimit = options?.recentLimit !== undefined
      ? Math.max(1, Math.min(options.recentLimit, MAX_DASHBOARD_RECENT_LIMIT))
      : DEFAULT_DASHBOARD_RECENT_LIMIT;

    const recentDays = options?.recentDays;
    const approachingDays = options?.approachingDays;

    const projectRes = this.projectRepo.getById(projectId);
    const snapshotRes = this.progressSnapshotService.getProgressSnapshot(projectId, canonicalAsOfDate);
    const riskStatusRes = this.riskClassificationService.getProjectRiskStatus(projectId, canonicalAsOfDate);
    const intelligenceRes = this.projectIntelligenceService.getIntelligence(projectId, {
      asOfDate: canonicalAsOfDate,
      recentDays,
      approachingDays
    });
    const activitiesRes = this.activityRepo.listByProjectId(projectId);
    const allMatchesRes = this.activityMatchRepo.listByProjectId(projectId);
    const updatesAllRes = this.progressUpdateRepo.listByProjectId(projectId);
    const activeBlockersRes = this.blockerRepo.listActiveByProject(projectId);
    const rootCauseSummaryRes = this.blockerRepo.countByRootCause(projectId);

    const isAsync =
      projectRes instanceof Promise ||
      snapshotRes instanceof Promise ||
      riskStatusRes instanceof Promise ||
      intelligenceRes instanceof Promise ||
      activitiesRes instanceof Promise ||
      allMatchesRes instanceof Promise ||
      updatesAllRes instanceof Promise ||
      activeBlockersRes instanceof Promise ||
      rootCauseSummaryRes instanceof Promise;

    if (isAsync) {
      return Promise.all([
        Promise.resolve(projectRes),
        Promise.resolve(snapshotRes),
        Promise.resolve(riskStatusRes),
        Promise.resolve(intelligenceRes),
        Promise.resolve(activitiesRes),
        Promise.resolve(allMatchesRes),
        Promise.resolve(updatesAllRes),
        Promise.resolve(activeBlockersRes),
        Promise.resolve(rootCauseSummaryRes)
      ]).then(async ([
        project,
        snapshot,
        riskStatus,
        intelligence,
        activities,
        allMatches,
        updatesAll,
        activeBlockers,
        rootCauseSummary
      ]) => {
        if (!project) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }
        const boundedUpdates = updatesAll.slice(0, recentLimit);
        const boundedUpdateIds = boundedUpdates.map((u: ProgressUpdate) => u.id);

        const [batchMatches, batchObs, batchEvidenceRaw] = await Promise.all([
          Promise.resolve(this.activityMatchRepo.listByProgressUpdateIds(boundedUpdateIds, projectId)),
          Promise.resolve(this.activityProgressRepo.listByProgressUpdateIds(boundedUpdateIds, projectId)),
          Promise.resolve(this.evidenceRepo.listByProgressUpdateIds(boundedUpdateIds, projectId))
        ]);

        return this.composeDashboard(
          project,
          snapshot,
          riskStatus,
          intelligence,
          activities,
          allMatches,
          updatesAll,
          activeBlockers,
          rootCauseSummary,
          batchMatches,
          batchObs,
          batchEvidenceRaw,
          canonicalAsOfDate,
          recentLimit
        );
      });
    }

    const project = projectRes;
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const boundedUpdates = updatesAllRes.slice(0, recentLimit);
    const boundedUpdateIds = boundedUpdates.map((u) => u.id);

    const batchMatchesRes = this.activityMatchRepo.listByProgressUpdateIds(boundedUpdateIds, projectId);
    const batchObsRes = this.activityProgressRepo.listByProgressUpdateIds(boundedUpdateIds, projectId);
    const batchEvidenceRawRes = this.evidenceRepo.listByProgressUpdateIds(boundedUpdateIds, projectId);

    if (
      batchMatchesRes instanceof Promise ||
      batchObsRes instanceof Promise ||
      batchEvidenceRawRes instanceof Promise
    ) {
      return Promise.all([
        Promise.resolve(batchMatchesRes),
        Promise.resolve(batchObsRes),
        Promise.resolve(batchEvidenceRawRes)
      ]).then(([batchMatches, batchObs, batchEvidenceRaw]) => {
        return this.composeDashboard(
          project,
          snapshotRes,
          riskStatusRes,
          intelligenceRes,
          activitiesRes,
          allMatchesRes,
          updatesAllRes,
          activeBlockersRes,
          rootCauseSummaryRes,
          batchMatches,
          batchObs,
          batchEvidenceRaw,
          canonicalAsOfDate,
          recentLimit
        );
      });
    }

    return this.composeDashboard(
      project,
      snapshotRes,
      riskStatusRes,
      intelligenceRes,
      activitiesRes,
      allMatchesRes,
      updatesAllRes,
      activeBlockersRes,
      rootCauseSummaryRes,
      batchMatchesRes,
      batchObsRes,
      batchEvidenceRawRes,
      canonicalAsOfDate,
      recentLimit
    );
  }

  private composeDashboard(
    project: Project,
    snapshot: ProjectProgressSnapshot,
    riskStatus: ProjectRiskStatus,
    intelligence: ProjectIntelligence,
    activities: Activity[],
    allMatches: ActivityMatch[],
    updatesAll: ProgressUpdate[],
    activeBlockers: OperationalBlocker[],
    rootCauseSummary: Record<string, number>,
    batchMatches: ActivityMatch[],
    batchObs: ActivityProgress[],
    batchEvidenceRaw: Evidence[],
    canonicalAsOfDate: string,
    recentLimit: number
  ): ProjectDashboard {

    // 5. Build ProjectSummary
    const projectSummary: ProjectSummary = {
      id: project.id,
      name: project.name,
      code: project.code,
      description: project.description,
      status: project.status,
      startDate: project.startDate,
      targetEndDate: project.targetEndDate,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    };

    // 6. ProjectHealthSummary directly consumes canonical snapshot aggregate metrics & risk classifications
    const totalCount = snapshot.activities.length;
    const overallActualProgress = snapshot.summary.overallActualProgress;
    const overallPlannedProgress = snapshot.summary.overallPlannedProgress;
    const progressVariance = snapshot.summary.progressVariance;
    const varianceState = snapshot.summary.varianceState;

    // Determine overall project risk classification based on canonical summary
    let overallRiskClassification: ProjectHealthSummary['overallRiskClassification'] = 'ON_TRACK';
    if (riskStatus.summary.delayed > 0) {
      overallRiskClassification = 'DELAYED';
    } else if (riskStatus.summary.atRisk > 0) {
      overallRiskClassification = 'AT_RISK';
    } else if (totalCount > 0 && riskStatus.summary.completed === totalCount) {
      overallRiskClassification = 'COMPLETED';
    } else if (riskStatus.summary.ahead > 0) {
      overallRiskClassification = 'AHEAD';
    } else {
      overallRiskClassification = 'ON_TRACK';
    }

    const health: ProjectHealthSummary = {
      overallActualProgress,
      overallPlannedProgress,
      progressVariance,
      varianceState,
      overallRiskClassification,
      asOfDate: canonicalAsOfDate,
      generatedAt: snapshot.generatedAt
    };

    // 7. Build ActivityStatusSummary
    const activityStatus: ActivityStatusSummary = {
      totalActivities: riskStatus.summary.totalActivities,
      onTrack: riskStatus.summary.onTrack,
      ahead: riskStatus.summary.ahead,
      atRisk: riskStatus.summary.atRisk,
      delayed: riskStatus.summary.delayed,
      completed: riskStatus.summary.completed,
      overdueCount: riskStatus.summary.overdueCount
    };

    // Index activities for quick lookup
    const activityMap = new Map(activities.map((a) => [a.id, a]));
    const snapshotItemMap = new Map(snapshot.activities.map((item) => [item.activityId, item]));
    const riskItemMap = new Map(riskStatus.activities.map((item) => [item.activityId, item]));

    // 8. Build Milestones Section
    // Milestone Invariant: zero-duration activities (plannedStart === plannedFinish)
    const zeroDurationActivities = activities.filter((a) => a.plannedStart === a.plannedFinish);

    // 8a. Upcoming Milestones (from intelligence or zero-duration >= asOfDate)
    const upcomingMilestones: DashboardMilestoneItem[] = intelligence.approachingMilestones.map((m) => {
      const snap = snapshotItemMap.get(m.activityId);
      const isCompleted = m.status === 'completed' || m.actualProgress >= 100;
      return {
        activityId: m.activityId,
        externalId: m.externalId,
        name: m.name,
        milestoneDate: m.milestoneDate,
        daysUntil: m.daysUntil,
        status: m.status,
        actualProgress: m.actualProgress,
        isCompleted,
        isOverdue: false,
        isLate: false
      };
    });

    // 8b. Completed Milestones
    const completedMilestones: DashboardMilestoneItem[] = [];
    for (const act of zeroDurationActivities) {
      const snap = snapshotItemMap.get(act.id);
      const isCompleted = snap ? (snap.status === 'completed' || snap.actualProgress >= 100) : false;
      if (isCompleted) {
        const daysUntil = diffInCalendarDays(canonicalAsOfDate, act.plannedStart);
        completedMilestones.push({
          activityId: act.id,
          externalId: act.externalId,
          name: act.name,
          milestoneDate: act.plannedStart,
          daysUntil,
          status: snap?.status ?? 'completed',
          actualProgress: snap?.actualProgress ?? 100,
          isCompleted: true,
          isOverdue: false,
          isLate: false
        });
      }
    }
    completedMilestones.sort(
      (a, b) =>
        b.milestoneDate.localeCompare(a.milestoneDate) ||
        a.externalId.localeCompare(b.externalId) ||
        a.activityId.localeCompare(b.activityId)
    );

    // 8c. Late / Overdue Milestones
    const lateMilestones: DashboardMilestoneItem[] = [];
    for (const act of zeroDurationActivities) {
      const snap = snapshotItemMap.get(act.id);
      const riskItem = riskItemMap.get(act.id);
      const isCompleted = snap ? (snap.status === 'completed' || snap.actualProgress >= 100) : false;
      const isDelayedOrOverdue = !isCompleted && (
        riskItem?.classification === 'DELAYED' ||
        Boolean(snap?.overdue) ||
        act.plannedFinish < canonicalAsOfDate
      );

      if (isDelayedOrOverdue) {
        const daysUntil = diffInCalendarDays(canonicalAsOfDate, act.plannedStart);
        lateMilestones.push({
          activityId: act.id,
          externalId: act.externalId,
          name: act.name,
          milestoneDate: act.plannedStart,
          daysUntil,
          status: snap?.status ?? 'delayed',
          actualProgress: snap?.actualProgress ?? 0,
          isCompleted: false,
          isOverdue: true,
          isLate: true
        });
      }
    }
    lateMilestones.sort(
      (a, b) =>
        a.milestoneDate.localeCompare(b.milestoneDate) ||
        a.externalId.localeCompare(b.externalId) ||
        a.activityId.localeCompare(b.activityId)
    );

    const milestones: DashboardMilestoneSection = {
      upcoming: upcomingMilestones,
      completed: completedMilestones,
      late: lateMilestones
    };

    // 9. Build Attention Summary
    // Query project matches for unresolved items
    const updateMap = new Map(updatesAll.map((u) => [u.id, u]));

    const unresolvedMatches: DashboardUnresolvedMatchItem[] = allMatches
      .filter((m) => m.status === 'suggested' && (m.reviewState === 'unresolved' || m.reviewState === 'awaiting_review'))
      .map((m) => {
        const act = activityMap.get(m.activityId);
        const upd = updateMap.get(m.progressUpdateId);
        return {
          matchId: m.id,
          progressUpdateId: m.progressUpdateId,
          activityId: m.activityId,
          activityExternalId: act?.externalId || m.activityId,
          activityName: act?.name || 'Unlinked Activity',
          reportDate: upd?.reportDate || '',
          reporterName: upd?.reporterName || null,
          confidenceScore: m.confidenceScore,
          confidenceTier: m.confidenceTier,
          reviewState: m.reviewState,
          matchMethod: m.matchMethod,
          matchedText: m.matchedText,
          rationale: m.rationale
        };
      })
      .sort((a, b) => a.confidenceScore - b.confidenceScore || b.reportDate.localeCompare(a.reportDate));

    // Active blockers and root-cause aggregation
    const dashboardActiveBlockers: DashboardActiveBlockerItem[] = activeBlockers.map((b) => {
      const act = b.activityId ? activityMap.get(b.activityId) : undefined;
      return {
        id: b.id,
        activityId: b.activityId,
        activityExternalId: act?.externalId || null,
        activityName: act?.name || 'General Site',
        category: b.category,
        description: b.description,
        reporterName: b.reporterName,
        reporterRole: b.reporterRole,
        createdAt: b.createdAt
      };
    });

    const attention: DashboardAttentionSummary = {
      delayedCount: intelligence.delayed.length,
      delayed: intelligence.delayed,
      atRiskCount: intelligence.atRisk.length,
      atRisk: intelligence.atRisk,
      staleCount: intelligence.staleActivities.length,
      stale: intelligence.staleActivities,
      unresolvedMatchesCount: unresolvedMatches.length,
      unresolvedMatches,
      activeBlockersCount: activeBlockers.length,
      activeBlockers: dashboardActiveBlockers,
      blockersByRootCause: rootCauseSummary
    };

    // 10. Build Recent Updates (bounded, deterministic newest first with batch repository queries)
    const boundedUpdates = updatesAll.slice(0, recentLimit);

    // Group batch results in-memory by progress report record id
    const matchesByReportId = new Map<string, DashboardMatchItem[]>();
    for (const m of batchMatches) {
      const act = activityMap.get(m.activityId);
      const dashboardMatch: DashboardMatchItem = {
        id: m.id,
        activityId: m.activityId,
        activityExternalId: act?.externalId || m.activityId,
        activityName: act?.name || 'Unlinked Activity',
        confidenceScore: m.confidenceScore,
        status: m.status,
        confidenceTier: m.confidenceTier,
        reviewState: m.reviewState,
        matchMethod: m.matchMethod,
        rationale: m.rationale,
        evidenceId: m.evidenceId
      };
      const existingList = matchesByReportId.get(m.progressUpdateId) || [];
      existingList.push(dashboardMatch);
      matchesByReportId.set(m.progressUpdateId, existingList);
    }

    const obsByReportId = new Map<string, DashboardProgressObservationItem[]>();
    for (const obs of batchObs) {
      if (!obs.progressUpdateId) continue;
      const act = activityMap.get(obs.activityId);
      const dashboardObs: DashboardProgressObservationItem = {
        id: obs.id,
        activityId: obs.activityId,
        activityExternalId: act?.externalId || obs.activityId,
        activityName: act?.name || 'Activity',
        actualPercent: obs.actualPercent,
        actualStart: obs.actualStart,
        actualFinish: obs.actualFinish,
        status: obs.status,
        asOfDate: obs.asOfDate
      };
      const existingList = obsByReportId.get(obs.progressUpdateId) || [];
      existingList.push(dashboardObs);
      obsByReportId.set(obs.progressUpdateId, existingList);
    }

    const evidenceByReportId = new Map<string, DashboardEvidenceItem[]>();
    for (const e of batchEvidenceRaw) {
      if (!e.progressUpdateId) continue;
      const dashboardEvidence: DashboardEvidenceItem = {
        id: e.id,
        fileName: e.fileName,
        fileType: e.fileType,
        fileSizeBytes: e.fileSizeBytes,
        uploadedAt: e.uploadedAt
      };
      const existingList = evidenceByReportId.get(e.progressUpdateId) || [];
      existingList.push(dashboardEvidence);
      evidenceByReportId.set(e.progressUpdateId, existingList);
    }

    const recentUpdates: DashboardRecentUpdateItem[] = boundedUpdates.map((updItem) => {
      return {
        id: updItem.id,
        reportDate: updItem.reportDate,
        createdAt: updItem.createdAt,
        reporterName: updItem.reporterName,
        reporterRole: updItem.reporterRole,
        sourceType: updItem.sourceType,
        rawText: updItem.rawText,
        status: updItem.status,
        matches: matchesByReportId.get(updItem.id) || [],
        canonicalObservations: obsByReportId.get(updItem.id) || [],
        evidenceList: evidenceByReportId.get(updItem.id) || []
      };
    });

    logger.info(
      `ProjectDashboardService: Composed dashboard for project '${project.id}' as-of '${canonicalAsOfDate}' (health: ${overallRiskClassification} [${overallActualProgress}% / ${overallPlannedProgress}%], attention items: ${attention.delayedCount + attention.atRiskCount + attention.staleCount + attention.unresolvedMatchesCount}, recent items: ${recentUpdates.length})`
    );

    return {
      project: projectSummary,
      health,
      activityStatus,
      recentUpdates,
      milestones,
      attention
    };
  }
}

export const projectDashboardService: ProjectDashboardService =
  new DefaultProjectDashboardService();
