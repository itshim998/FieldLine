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
  ProjectIntelligenceService,
  projectIntelligenceService as defaultProjectIntelligenceService
} from '../intelligence/project-intelligence.service.js';
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
  DashboardEvidenceItem
} from './dashboard.types.js';
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
  }

  getDashboard(
    projectId: string,
    options?: ProjectDashboardQueryOptions
  ): ProjectDashboard {
    // 1. Verify project exists and belongs to the workspace
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    // 2. Resolve canonical asOfDate
    const canonicalAsOfDate = options?.asOfDate
      ? validateSnapshotDate(options.asOfDate)
      : getTodayDateString();

    const recentLimit = options?.recentLimit !== undefined
      ? Math.max(1, Math.min(options.recentLimit, MAX_DASHBOARD_RECENT_LIMIT))
      : DEFAULT_DASHBOARD_RECENT_LIMIT;

    const recentDays = options?.recentDays;
    const approachingDays = options?.approachingDays;

    // 3. Obtain canonical Progress Snapshot & Risk Status (Pure deterministic delegation)
    const snapshot = this.progressSnapshotService.getProgressSnapshot(projectId, canonicalAsOfDate);
    const riskStatus = this.riskClassificationService.getProjectRiskStatus(projectId, canonicalAsOfDate);

    // 4. Obtain canonical Project Intelligence
    const intelligence = this.projectIntelligenceService.getIntelligence(projectId, {
      asOfDate: canonicalAsOfDate,
      recentDays,
      approachingDays
    });

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

    // 6. Calculate ProjectHealthSummary using canonical snapshot & risk classifications
    const totalCount = snapshot.activities.length;
    const overallActualProgress = totalCount === 0
      ? 0
      : Math.round((snapshot.activities.reduce((sum, a) => sum + a.actualProgress, 0) / totalCount) * 100) / 100;

    const overallPlannedProgress = totalCount === 0
      ? 0
      : Math.round((snapshot.activities.reduce((sum, a) => sum + a.plannedProgress, 0) / totalCount) * 100) / 100;

    let progressVariance = Math.round((overallActualProgress - overallPlannedProgress) * 100) / 100;
    if (Object.is(progressVariance, -0)) {
      progressVariance = 0;
    }

    let varianceState: ProjectHealthSummary['varianceState'] = 'on_plan';
    if (progressVariance > 0.01) {
      varianceState = 'ahead';
    } else if (progressVariance < -0.01) {
      varianceState = 'behind';
    }

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
    const activities = this.activityRepo.listByProjectId(projectId);
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
    const allMatches = this.activityMatchRepo.listByProjectId(projectId);
    const updatesAll = this.progressUpdateRepo.listByProjectId(projectId);
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

    const attention: DashboardAttentionSummary = {
      delayedCount: intelligence.delayed.length,
      delayed: intelligence.delayed,
      atRiskCount: intelligence.atRisk.length,
      atRisk: intelligence.atRisk,
      staleCount: intelligence.staleActivities.length,
      stale: intelligence.staleActivities,
      unresolvedMatchesCount: unresolvedMatches.length,
      unresolvedMatches
    };

    // 10. Build Recent Updates (bounded, deterministic newest first)
    const boundedUpdates = updatesAll.slice(0, recentLimit);
    const recentUpdates: DashboardRecentUpdateItem[] = boundedUpdates.map((updItem) => {
      // Fetch matches for this report record
      const updMatches = this.activityMatchRepo.listByProgressUpdateId(updItem.id, projectId);
      const dashboardMatches: DashboardMatchItem[] = updMatches.map((m) => {
        const act = activityMap.get(m.activityId);
        return {
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
      });

      // Fetch canonical observations for this report record
      const updObs = this.activityProgressRepo.listByProgressUpdateId(updItem.id, projectId);
      const dashboardObs: DashboardProgressObservationItem[] = updObs.map((obs) => {
        const act = activityMap.get(obs.activityId);
        return {
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
      });

      // Fetch evidence items for this report record (strip raw filesystem paths)
      const evidenceListRaw = this.evidenceRepo.listByProgressUpdateId(updItem.id, projectId);
      const evidenceList: DashboardEvidenceItem[] = evidenceListRaw.map((e) => ({
        id: e.id,
        fileName: e.fileName,
        fileType: e.fileType,
        fileSizeBytes: e.fileSizeBytes,
        uploadedAt: e.uploadedAt
      }));

      return {
        id: updItem.id,
        reportDate: updItem.reportDate,
        createdAt: updItem.createdAt,
        reporterName: updItem.reporterName,
        reporterRole: updItem.reporterRole,
        sourceType: updItem.sourceType,
        rawText: updItem.rawText,
        status: updItem.status,
        matches: dashboardMatches,
        canonicalObservations: dashboardObs,
        evidenceList
      };
    });

    logger.info(
      `ProjectDashboardService: Composed dashboard for project '${projectId}' as-of '${canonicalAsOfDate}' (health: ${overallRiskClassification} [${overallActualProgress}% / ${overallPlannedProgress}%], attention items: ${attention.delayedCount + attention.atRiskCount + attention.staleCount + attention.unresolvedMatchesCount}, recent items: ${recentUpdates.length})`
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
