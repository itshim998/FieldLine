import {
  Activity,
  ActivityProgress,
  ActivityProgressSnapshotItem,
  ProgressSnapshotSummary,
  ProjectProgressSnapshot,
  VarianceState
} from '../../models/domain.types.js';
import {
  PlannedProgressCalculation,
  VarianceCalculation
} from './progress-snapshot.types.js';
import { ValidationError } from '../../errors/AppError.js';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Deterministically computes calendar day difference (date2 - date1) in whole days using UTC semantics.
 */
export function diffInCalendarDays(startDate: string, finishDate: string): number {
  if (!DATE_REGEX.test(startDate) || !DATE_REGEX.test(finishDate)) {
    throw new ValidationError(
      `Invalid calendar date format for calculation: '${startDate}', '${finishDate}'. Expected YYYY-MM-DD.`
    );
  }

  const [y1, m1, d1] = startDate.split('-').map(Number);
  const [y2, m2, d2] = finishDate.split('-').map(Number);

  const ms1 = Date.UTC(y1, m1 - 1, d1);
  const ms2 = Date.UTC(y2, m2 - 1, d2);

  return Math.round((ms2 - ms1) / 86400000);
}

/**
 * Calculates planned progress percentage as-of a given snapshot date.
 *
 * Baseline Rules:
 * 1. asOfDate < plannedStart => 0%
 * 2. asOfDate >= plannedFinish => 100%
 * 3. Zero-duration milestone (plannedStart === plannedFinish): 0% before date, 100% on/after date
 * 4. Standard window (plannedStart <= asOfDate < plannedFinish):
 *    linear elapsed progress: (elapsedDays / plannedDurationDays) * 100
 *    clamped [0, 100], rounded to 2 decimal places.
 */
export function calculatePlannedProgress(
  plannedStart: string,
  plannedFinish: string,
  asOfDate: string,
  activityIdentifier?: string
): PlannedProgressCalculation {
  if (!DATE_REGEX.test(plannedStart) || !DATE_REGEX.test(plannedFinish) || !DATE_REGEX.test(asOfDate)) {
    throw new ValidationError(
      `Invalid calendar date format. plannedStart='${plannedStart}', plannedFinish='${plannedFinish}', asOfDate='${asOfDate}'. Expected YYYY-MM-DD.`
    );
  }

  if (plannedFinish < plannedStart) {
    const actLabel = activityIdentifier ? ` for activity '${activityIdentifier}'` : '';
    throw new ValidationError(
      `Invalid schedule dates${actLabel}: plannedFinish (${plannedFinish}) is before plannedStart (${plannedStart})`
    );
  }

  // Zero-duration activity / milestone
  if (plannedStart === plannedFinish) {
    const plannedDurationDays = 0;
    const plannedProgress = asOfDate >= plannedFinish ? 100 : 0;
    return { plannedDurationDays, plannedProgress };
  }

  const plannedDurationDays = diffInCalendarDays(plannedStart, plannedFinish);

  if (asOfDate < plannedStart) {
    return { plannedDurationDays, plannedProgress: 0 };
  }

  if (asOfDate >= plannedFinish) {
    return { plannedDurationDays, plannedProgress: 100 };
  }

  const elapsedDays = diffInCalendarDays(plannedStart, asOfDate);
  const rawProgress = (elapsedDays / plannedDurationDays) * 100;
  const clampedProgress = Math.min(100, Math.max(0, rawProgress));
  const plannedProgress = Math.round(clampedProgress * 100) / 100;

  return { plannedDurationDays, plannedProgress };
}

/**
 * Calculates progress variance and variance state.
 *
 * progressVariance = actualProgress - plannedProgress
 * Rounding: 2 decimal places
 *
 * Tolerance policy:
 * - variance > 0.01  => 'ahead'
 * - variance < -0.01 => 'behind'
 * - otherwise        => 'on_plan'
 */
export function calculateVariance(
  actualProgress: number,
  plannedProgress: number
): VarianceCalculation {
  let progressVariance = Math.round((actualProgress - plannedProgress) * 100) / 100;

  // Prevent -0 in output
  if (Object.is(progressVariance, -0)) {
    progressVariance = 0;
  }

  let varianceState: VarianceState = 'on_plan';
  if (progressVariance > 0.01) {
    varianceState = 'ahead';
  } else if (progressVariance < -0.01) {
    varianceState = 'behind';
  }

  return { progressVariance, varianceState };
}

/**
 * Determines whether an activity is overdue as of a snapshot date.
 *
 * overdue = snapshotDate > plannedFinish AND actualProgress < 100
 */
export function isOverdue(
  plannedFinish: string,
  actualProgress: number,
  asOfDate: string
): boolean {
  return asOfDate > plannedFinish && actualProgress < 100;
}

/**
 * Compiles a single ActivityProgressSnapshotItem from baseline Activity and historical observation.
 */
export function calculateActivitySnapshot(
  activity: Activity,
  latestObservation: ActivityProgress | null,
  asOfDate: string
): ActivityProgressSnapshotItem {
  const { plannedDurationDays, plannedProgress } = calculatePlannedProgress(
    activity.plannedStart,
    activity.plannedFinish,
    asOfDate,
    activity.externalId || activity.name
  );

  let actualProgress = 0;
  let actualStart: string | null = null;
  let actualFinish: string | null = null;
  let status: ActivityProgressSnapshotItem['status'] = 'not_started';

  if (latestObservation) {
    actualProgress = latestObservation.actualPercent;
    actualStart = latestObservation.actualStart;
    actualFinish = latestObservation.actualFinish;
    status = latestObservation.status;
  }

  const { progressVariance, varianceState } = calculateVariance(
    actualProgress,
    plannedProgress
  );

  const overdue = isOverdue(activity.plannedFinish, actualProgress, asOfDate);

  return {
    activityId: activity.id,
    externalId: activity.externalId,
    name: activity.name,
    wbsCode: activity.wbsCode,
    location: activity.location,
    plannedStart: activity.plannedStart,
    plannedFinish: activity.plannedFinish,
    plannedDurationDays,
    actualStart,
    actualFinish,
    plannedProgress,
    actualProgress,
    progressVariance,
    varianceState,
    status,
    overdue
  };
}

/**
 * Aggregates summary counts across snapshot activity items.
 */
export function calculateSnapshotSummary(
  activities: ActivityProgressSnapshotItem[]
): ProgressSnapshotSummary {
  const summary: ProgressSnapshotSummary = {
    totalActivities: activities.length,
    notStarted: 0,
    started: 0,
    inProgress: 0,
    completed: 0,
    delayed: 0,
    overdue: 0,
    ahead: 0,
    onPlan: 0,
    behind: 0
  };

  for (const act of activities) {
    // Status counts
    switch (act.status) {
      case 'not_started':
        summary.notStarted += 1;
        break;
      case 'started':
        summary.started += 1;
        break;
      case 'in_progress':
        summary.inProgress += 1;
        break;
      case 'completed':
        summary.completed += 1;
        break;
      case 'delayed':
        summary.delayed += 1;
        break;
    }

    // Overdue count
    if (act.overdue) {
      summary.overdue += 1;
    }

    // Variance state counts
    switch (act.varianceState) {
      case 'ahead':
        summary.ahead += 1;
        break;
      case 'on_plan':
        summary.onPlan += 1;
        break;
      case 'behind':
        summary.behind += 1;
        break;
    }
  }

  return summary;
}

/**
 * Builds the complete ProjectProgressSnapshot response structure.
 */
export function calculateProjectSnapshot(
  projectId: string,
  asOfDate: string,
  activities: Activity[],
  observationsByActivityId: Map<string, ActivityProgress | null>,
  generatedAt?: string
): ProjectProgressSnapshot {
  const activitySnapshots = activities.map(act =>
    calculateActivitySnapshot(
      act,
      observationsByActivityId.get(act.id) ?? null,
      asOfDate
    )
  );

  const summary = calculateSnapshotSummary(activitySnapshots);

  return {
    projectId,
    asOfDate,
    generatedAt: generatedAt || new Date().toISOString(),
    activities: activitySnapshots,
    summary
  };
}
