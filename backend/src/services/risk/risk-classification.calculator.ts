import {
  ActivityProgressSnapshotItem,
  ProjectProgressSnapshot,
  ActivityRiskClassification,
  RiskReason,
  ActivityRiskStatusItem,
  ProjectRiskSummary,
  ProjectRiskStatus,
  DependencyRiskSignal
} from './risk-classification.types.js';
import { diffInCalendarDays } from '../snapshot/progress-snapshot.calculator.js';

export const STRONG_NEGATIVE_VARIANCE_THRESHOLD = -10.0;
export const NEAR_FINISH_WINDOW_DAYS = 3;

/**
 * Pure, deterministic classifier for a single activity snapshot item.
 *
 * Precedence Hierarchy:
 * 1. COMPLETED: status === 'completed' OR actualProgress >= 100
 * 2. DELAYED: asOfDate > plannedFinish AND actualProgress < 100 (item.overdue === true)
 * 3. AT_RISK:
 *    - strong negative variance (progressVariance <= -10.0)
 *    OR
 *    - near finish (0 <= daysUntilPlannedFinish <= 3) AND behind plan (varianceState === 'behind')
 *    OR
 *    - status === 'delayed'
 * 4. AHEAD: progressVariance > 0.01 (varianceState === 'ahead')
 * 5. ON_TRACK: default (within plan)
 *
 * @param item - Canonical Pass 11 ActivityProgressSnapshotItem
 * @param asOfDate - Snapshot calculation date (YYYY-MM-DD)
 * @param _dependencies - Optional seam for future dependency-based risk signals
 */
export function classifyActivityRisk(
  item: ActivityProgressSnapshotItem,
  asOfDate: string,
  _dependencies?: DependencyRiskSignal[]
): ActivityRiskStatusItem {
  // 1. COMPLETED (Precedence #1)
  const isCompleted = item.status === 'completed' || item.actualProgress >= 100;
  if (isCompleted) {
    const reasons: RiskReason[] = [
      {
        code: 'completed',
        message:
          item.status === 'completed'
            ? 'Activity execution status is completed.'
            : 'Actual progress has reached 100%.'
      }
    ];

    return {
      activityId: item.activityId,
      externalId: item.externalId,
      name: item.name,
      wbsCode: item.wbsCode,
      location: item.location,
      plannedStart: item.plannedStart,
      plannedFinish: item.plannedFinish,
      plannedProgress: item.plannedProgress,
      actualProgress: item.actualProgress,
      progressVariance: item.progressVariance,
      varianceState: item.varianceState,
      status: item.status,
      overdue: item.overdue,
      classification: 'COMPLETED',
      reasons
    };
  }

  // 2. DELAYED (Precedence #2: Objective Overdue Invariant)
  // An incomplete activity whose planned finish date has passed is DELAYED.
  const isDelayed = item.overdue || (asOfDate > item.plannedFinish && item.actualProgress < 100);
  if (isDelayed) {
    const reasons: RiskReason[] = [
      {
        code: 'overdue',
        message: 'Planned finish date has passed while actual progress remains below 100%.'
      }
    ];

    return {
      activityId: item.activityId,
      externalId: item.externalId,
      name: item.name,
      wbsCode: item.wbsCode,
      location: item.location,
      plannedStart: item.plannedStart,
      plannedFinish: item.plannedFinish,
      plannedProgress: item.plannedProgress,
      actualProgress: item.actualProgress,
      progressVariance: item.progressVariance,
      varianceState: item.varianceState,
      status: item.status,
      overdue: item.overdue,
      classification: 'DELAYED',
      reasons
    };
  }

  // 3. AT_RISK (Precedence #3: Deterministic Risk Signals)
  const daysUntilPlannedFinish = diffInCalendarDays(asOfDate, item.plannedFinish);
  const nearFinish =
    daysUntilPlannedFinish >= 0 && daysUntilPlannedFinish <= NEAR_FINISH_WINDOW_DAYS;
  const behindPlan = item.varianceState === 'behind';

  const strongNegativeVariance = item.progressVariance <= STRONG_NEGATIVE_VARIANCE_THRESHOLD;
  const nearFinishAndBehind = nearFinish && behindPlan;
  const delayedExecutionStatus = item.status === 'delayed';

  const isAtRisk = strongNegativeVariance || nearFinishAndBehind || delayedExecutionStatus;

  if (isAtRisk) {
    const reasons: RiskReason[] = [];

    if (strongNegativeVariance) {
      reasons.push({
        code: 'strong_negative_variance',
        message: `Actual progress is ${Math.abs(item.progressVariance)} percentage points behind planned progress.`
      });
    }

    if (nearFinishAndBehind) {
      reasons.push({
        code: 'near_finish_and_behind',
        message: 'Activity is within 3 days of planned finish and remains behind planned progress.'
      });
    }

    if (delayedExecutionStatus) {
      reasons.push({
        code: 'delayed_status',
        message: 'Activity execution status is marked as delayed.'
      });
    }

    return {
      activityId: item.activityId,
      externalId: item.externalId,
      name: item.name,
      wbsCode: item.wbsCode,
      location: item.location,
      plannedStart: item.plannedStart,
      plannedFinish: item.plannedFinish,
      plannedProgress: item.plannedProgress,
      actualProgress: item.actualProgress,
      progressVariance: item.progressVariance,
      varianceState: item.varianceState,
      status: item.status,
      overdue: item.overdue,
      classification: 'AT_RISK',
      reasons
    };
  }

  // 4. AHEAD (Precedence #4: Positive Variance)
  const isAhead = item.varianceState === 'ahead' || item.progressVariance > 0.01;
  if (isAhead) {
    const reasons: RiskReason[] = [
      {
        code: 'positive_variance',
        message: `Actual progress is ${item.progressVariance} percentage points ahead of planned progress.`
      }
    ];

    return {
      activityId: item.activityId,
      externalId: item.externalId,
      name: item.name,
      wbsCode: item.wbsCode,
      location: item.location,
      plannedStart: item.plannedStart,
      plannedFinish: item.plannedFinish,
      plannedProgress: item.plannedProgress,
      actualProgress: item.actualProgress,
      progressVariance: item.progressVariance,
      varianceState: item.varianceState,
      status: item.status,
      overdue: item.overdue,
      classification: 'AHEAD',
      reasons
    };
  }

  // 5. ON_TRACK (Precedence #5: Default Exhaustive State)
  const reasons: RiskReason[] = [
    {
      code: 'within_plan',
      message: 'Activity progress is on track with planned schedule.'
    }
  ];

  return {
    activityId: item.activityId,
    externalId: item.externalId,
    name: item.name,
    wbsCode: item.wbsCode,
    location: item.location,
    plannedStart: item.plannedStart,
    plannedFinish: item.plannedFinish,
    plannedProgress: item.plannedProgress,
    actualProgress: item.actualProgress,
    progressVariance: item.progressVariance,
    varianceState: item.varianceState,
    status: item.status,
    overdue: item.overdue,
    classification: 'ON_TRACK',
    reasons
  };
}

/**
 * Aggregates simple counts across classified activity items.
 */
export function calculateProjectRiskSummary(
  activities: ActivityRiskStatusItem[]
): ProjectRiskSummary {
  const summary: ProjectRiskSummary = {
    totalActivities: activities.length,
    completed: 0,
    delayed: 0,
    atRisk: 0,
    ahead: 0,
    onTrack: 0,
    overdueCount: 0
  };

  for (const act of activities) {
    switch (act.classification) {
      case 'COMPLETED':
        summary.completed += 1;
        break;
      case 'DELAYED':
        summary.delayed += 1;
        break;
      case 'AT_RISK':
        summary.atRisk += 1;
        break;
      case 'AHEAD':
        summary.ahead += 1;
        break;
      case 'ON_TRACK':
        summary.onTrack += 1;
        break;
    }

    if (act.overdue) {
      summary.overdueCount += 1;
    }
  }

  return summary;
}

/**
 * Pure transformation from Pass 11 ProjectProgressSnapshot to Pass 12 ProjectRiskStatus.
 */
export function calculateProjectRiskStatus(
  snapshot: ProjectProgressSnapshot,
  dependencies?: DependencyRiskSignal[]
): ProjectRiskStatus {
  const activities = snapshot.activities.map(act =>
    classifyActivityRisk(act, snapshot.asOfDate, dependencies)
  );

  const summary = calculateProjectRiskSummary(activities);

  return {
    projectId: snapshot.projectId,
    asOfDate: snapshot.asOfDate,
    generatedAt: snapshot.generatedAt,
    activities,
    summary
  };
}
