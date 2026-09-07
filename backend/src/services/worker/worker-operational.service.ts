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
  ProgressService,
  progressService as defaultProgressService
} from '../progress/progress.service.js';
import {
  FieldProgressExtractionService,
  fieldProgressExtractionService as defaultExtractionService
} from '../../ai/services/field-progress-extraction.service.js';
import {
  ActivityMatchingService,
  activityMatchingService as defaultMatchingService
} from '../matching/activity-matching.service.js';
import {
  ProgressSnapshotService,
  progressSnapshotService as defaultSnapshotService,
  validateSnapshotDate,
  getTodayDateString
} from '../snapshot/progress-snapshot.service.js';
import { classifyActivityRisk } from '../risk/risk-classification.calculator.js';
import { diffInCalendarDays } from '../snapshot/progress-snapshot.calculator.js';
import { NotFoundError, ValidationError } from '../../errors/AppError.js';
import { ActivityRiskClassification } from '../../models/domain.types.js';
import {
  OperationalTaskItem,
  OperationalTaskListResponse,
  OperationalTaskSummary,
  WorkerOperationalQueryDto,
  WorkerQuickReportDto,
  WorkerQuickReportResponseDto
} from '../../validation/worker-operational.schema.js';
import { logger } from '../../config/logger.js';

export interface WorkerOperationalService {
  getOperationalTasks(
    projectId: string,
    query?: Partial<WorkerOperationalQueryDto>
  ): OperationalTaskListResponse;
  recordQuickReport(
    projectId: string,
    input: WorkerQuickReportDto
  ): Promise<WorkerQuickReportResponseDto>;
}

function mapStatusToLabel(status: ActivityRiskClassification): string {
  switch (status) {
    case 'ON_TRACK':
      return 'On Track';
    case 'AT_RISK':
      return 'At Risk';
    case 'DELAYED':
      return 'Delayed';
    case 'COMPLETED':
      return 'Completed';
    case 'AHEAD':
      return 'Ahead';
    default:
      return 'On Track';
  }
}

export class DefaultWorkerOperationalService implements WorkerOperationalService {
  private projectRepo: ProjectRepository;
  private activityRepo: ActivityRepository;
  private snapshotService: ProgressSnapshotService;
  private progressUpdateRepo: ProgressUpdateRepository;
  private activityMatchRepo: ActivityMatchRepository;
  private progressService: ProgressService;
  private extractionService: FieldProgressExtractionService;
  private matchingService: ActivityMatchingService;

  constructor(dependencies?: {
    projectRepo?: ProjectRepository;
    activityRepo?: ActivityRepository;
    snapshotService?: ProgressSnapshotService;
    progressUpdateRepo?: ProgressUpdateRepository;
    activityMatchRepo?: ActivityMatchRepository;
    progressService?: ProgressService;
    extractionService?: FieldProgressExtractionService;
    matchingService?: ActivityMatchingService;
  }) {
    this.projectRepo = dependencies?.projectRepo || defaultProjectRepo;
    this.activityRepo = dependencies?.activityRepo || defaultActivityRepo;
    this.snapshotService = dependencies?.snapshotService || defaultSnapshotService;
    this.progressUpdateRepo = dependencies?.progressUpdateRepo || defaultProgressUpdateRepo;
    this.activityMatchRepo = dependencies?.activityMatchRepo || defaultActivityMatchRepo;
    this.progressService = dependencies?.progressService || defaultProgressService;
    this.extractionService = dependencies?.extractionService || defaultExtractionService;
    this.matchingService = dependencies?.matchingService || defaultMatchingService;
  }

  getOperationalTasks(
    projectId: string,
    query: Partial<WorkerOperationalQueryDto> = {}
  ): OperationalTaskListResponse {
    // 1. Verify project exists
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    // 2. Resolve canonical evaluation date
    const asOfDate = query.asOfDate
      ? validateSnapshotDate(query.asOfDate)
      : getTodayDateString();

    const horizonDays = query.horizonDays ?? 3;
    const scope = query.scope || 'horizon';
    const locationFilter = query.locationFilter?.trim().toLowerCase();
    const statusFilter = query.statusFilter && query.statusFilter !== 'ALL' ? query.statusFilter : null;

    // 3. Obtain canonical progress snapshot as of evaluation date
    const snapshot = this.snapshotService.getProgressSnapshot(projectId, asOfDate);

    // 4. Retrieve project activities for physical scope enrichment (target quantity, unit, description)
    const activities = this.activityRepo.listByProjectId(projectId);
    const activityMap = new Map(activities.map((a) => [a.id, a]));

    // 5. Build operational task items
    const allItems: OperationalTaskItem[] = [];

    for (const snapItem of snapshot.activities) {
      const act = activityMap.get(snapItem.activityId);
      if (!act) continue;

      // Pure deterministic risk status classification
      const riskItem = classifyActivityRisk(snapItem, asOfDate);
      const classification = riskItem.classification;

      const actualProgress = Math.round(snapItem.actualProgress * 100) / 100;
      const plannedProgress = Math.round(snapItem.plannedProgress * 100) / 100;

      const isCompleted =
        classification === 'COMPLETED' ||
        snapItem.status === 'completed' ||
        actualProgress >= 100;

      const isOverdue = asOfDate > act.plannedFinish && !isCompleted;

      const isToday =
        (act.plannedStart <= asOfDate && asOfDate <= act.plannedFinish) ||
        (snapItem.status === 'in_progress' && !isCompleted);

      const daysUntilStart = diffInCalendarDays(act.plannedStart, asOfDate);
      const isUpcoming =
        act.plannedStart > asOfDate &&
        daysUntilStart > 0 &&
        daysUntilStart <= horizonDays &&
        !isCompleted;

      allItems.push({
        id: act.id,
        externalId: act.externalId,
        name: act.name,
        description: act.description,
        location: act.location,
        plannedStart: act.plannedStart,
        plannedFinish: act.plannedFinish,
        plannedQuantity: act.plannedQuantity,
        unit: act.unit,
        plannedProgress,
        actualProgress,
        status: classification,
        statusLabel: mapStatusToLabel(classification),
        isToday,
        isUpcoming,
        isOverdue,
        isCompleted
      });
    }

    // 6. Calculate summary metrics across all activities as of this date
    const summary: OperationalTaskSummary = {
      total: 0,
      today: allItems.filter((t) => t.isToday).length,
      upcoming: allItems.filter((t) => t.isUpcoming).length,
      completed: allItems.filter((t) => t.isCompleted).length,
      delayed: allItems.filter((t) => t.status === 'DELAYED').length,
      atRisk: allItems.filter((t) => t.status === 'AT_RISK').length,
      onTrack: allItems.filter((t) => t.status === 'ON_TRACK' || t.status === 'AHEAD').length
    };

    // 7. Filter tasks according to requested operational horizon scope
    let filtered = allItems.filter((task) => {
      switch (scope) {
        case 'today':
          return task.isToday;
        case 'upcoming':
          return task.isUpcoming;
        case 'delayed':
          return task.isOverdue || task.status === 'DELAYED';
        case 'all':
          return true;
        case 'horizon':
        default:
          return task.isToday || task.isUpcoming || (task.isOverdue && !task.isCompleted);
      }
    });

    // 8. Filter by location if specified
    if (locationFilter) {
      filtered = filtered.filter(
        (t) => t.location && t.location.toLowerCase().includes(locationFilter)
      );
    }

    // 9. Filter by status if specified
    if (statusFilter) {
      filtered = filtered.filter((t) => t.status === statusFilter);
    }

    // 10. Prioritize tasks for field execution:
    // Order:
    // 1. Delayed / Overdue incomplete tasks
    // 2. Active Today tasks
    // 3. Upcoming tasks
    // 4. Completed tasks
    filtered.sort((a, b) => {
      const getPriorityRank = (t: OperationalTaskItem): number => {
        if (t.isOverdue && !t.isCompleted) return 1;
        if (t.status === 'DELAYED') return 2;
        if (t.status === 'AT_RISK') return 3;
        if (t.isToday && !t.isCompleted) return 4;
        if (t.isUpcoming) return 5;
        if (t.isCompleted) return 6;
        return 7;
      };

      const rankA = getPriorityRank(a);
      const rankB = getPriorityRank(b);

      if (rankA !== rankB) {
        return rankA - rankB;
      }

      // Within same rank, sort by planned finish ascending, then external ID
      if (a.plannedFinish !== b.plannedFinish) {
        return a.plannedFinish.localeCompare(b.plannedFinish);
      }
      return a.externalId.localeCompare(b.externalId);
    });

    summary.total = filtered.length;

    logger.info(
      `WorkerOperationalService: Retrieved ${filtered.length} operational tasks for project '${projectId}' as-of '${asOfDate}' (scope: ${scope})`
    );

    return {
      projectId,
      asOfDate,
      tasks: filtered,
      summary
    };
  }

  async recordQuickReport(
    projectId: string,
    input: WorkerQuickReportDto
  ): Promise<WorkerQuickReportResponseDto> {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    if (!input.reporterName || input.reporterName.trim().length === 0) {
      throw new ValidationError('Reporter name is required for field attribution');
    }

    const reporterName = input.reporterName.trim();
    const reporterRole = input.reporterRole?.trim() || null;
    const sourceType = input.sourceType || 'manual';
    const reportDate = input.reportDate;

    // Case 1: Specific activity is targeted directly from task card / picker
    if (input.activityId) {
      const activity = this.activityRepo.getById(input.activityId);
      if (!activity || activity.projectId !== projectId) {
        throw new NotFoundError(`Activity '${input.activityId}' not found in project '${projectId}'`);
      }

      // Build descriptive progress note
      let descText = input.notes?.trim() || '';
      if (!descText) {
        if (input.actualQuantity != null) {
          descText = `Completed ${input.actualQuantity} ${input.quantityUnit || activity.unit || 'units'} on ${activity.externalId} — ${activity.name}.`;
        } else if (input.progressPercent != null) {
          descText = `Progress updated to ${input.progressPercent}% on ${activity.externalId} — ${activity.name}.`;
        } else {
          descText = `Field progress logged on ${activity.externalId} — ${activity.name}.`;
        }
      }

      // 1. Create progress record with attribution
      const updateRecord = this.progressUpdateRepo.create({
        projectId,
        reportDate,
        rawText: descText,
        reporterName,
        reporterRole,
        sourceType,
        status: 'received'
      });

      // 2. Create auto-confirmed match record
      const match = this.activityMatchRepo.create({
        projectId,
        progressUpdateId: updateRecord.id,
        activityId: activity.id,
        confidenceScore: 1.0,
        matchMethod: 'exact_id',
        matchedText: activity.name,
        rationale: 'Direct worker selection from operational cockpit',
        status: 'confirmed',
        confidenceTier: 'high',
        reviewState: 'resolved',
        reviewedBy: reporterName,
        reviewedAt: new Date().toISOString()
      });

      // 3. Normalize and record progress deterministically
      const recorded = this.progressService.normalizeAndRecordProgress({
        projectId,
        updateId: updateRecord.id,
        matchId: match.id,
        fact: {
          reference: activity.externalId,
          location: activity.location || null,
          progress_percent: input.progressPercent ?? null,
          status: (input.progressPercent != null && input.progressPercent >= 100) ? 'completed' : 'in_progress'
        },
        actualQuantity: input.actualQuantity ?? null,
        quantityUnit: input.quantityUnit || activity.unit || null,
        asOfDate: reportDate,
        allowSuggested: false
      });

      logger.info(
        `WorkerOperationalService: Quick report recorded for activity '${activity.externalId}' by '${reporterName}'. Actual percent: ${recorded.actualPercent}%.`
      );

      return {
        status: 'confirmed',
        message: `Progress verified: ${activity.name} saved at ${recorded.actualPercent}%.`,
        progressUpdate: updateRecord,
        match,
        activityProgress: recorded,
        derivedPercent: recorded.actualPercent
      };
    }

    // Case 2: Freeform shift observation notes without specific activityId
    const notesText = input.notes?.trim() || '';
    if (!notesText) {
      throw new ValidationError('Either activityId or progress notes must be provided');
    }

    // 1. Create progress record
    const updateRecord = this.progressUpdateRepo.create({
      projectId,
      reportDate,
      rawText: notesText,
      reporterName,
      reporterRole,
      sourceType,
      status: 'received'
    });

    // 2. Run AI extraction & matching pipeline
    try {
      const extraction = await this.extractionService.extractFromReport(notesText);
      if (extraction && extraction.items && extraction.items.length > 0) {
        await this.matchingService.matchProgressUpdate(
          projectId,
          updateRecord.id,
          extraction,
          { persist: true }
        );

        const persistedMatches = this.activityMatchRepo.listByProgressUpdateId(updateRecord.id, projectId);
        let hasConfirmed = false;
        let hasAwaitingReview = false;
        let lastProgress: any = null;

        for (const item of extraction.items) {
          const matchCandidate = persistedMatches.find((m) => m.progressUpdateId === updateRecord.id);
          if (matchCandidate) {
            if (matchCandidate.status === 'confirmed') {
              hasConfirmed = true;
              lastProgress = this.progressService.normalizeAndRecordProgress({
                projectId,
                updateId: updateRecord.id,
                matchId: matchCandidate.id,
                fact: item,
                allowSuggested: false
              });
            } else if (matchCandidate.reviewState === 'awaiting_review' || matchCandidate.status === 'suggested') {
              hasAwaitingReview = true;
            }
          }
        }

        if (hasConfirmed && lastProgress) {
          return {
            status: 'confirmed',
            message: `Progress verified and committed to project truth at ${lastProgress.actualPercent}%.`,
            progressUpdate: updateRecord,
            activityProgress: lastProgress,
            derivedPercent: lastProgress.actualPercent
          };
        } else if (hasAwaitingReview) {
          return {
            status: 'awaiting_review',
            message: 'Report logged. Ambiguous activity match routed to Admin review queue.',
            progressUpdate: updateRecord
          };
        }
      }
    } catch (err: any) {
      logger.warn(`WorkerOperationalService: AI matching error during quick-report: ${err.message}`);
    }

    return {
      status: 'received',
      message: 'Field report logged for project records.',
      progressUpdate: updateRecord
    };
  }
}

export const workerOperationalService: WorkerOperationalService =
  new DefaultWorkerOperationalService();

