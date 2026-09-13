import {
  ActivityProgressRepository,
  activityProgressRepository as defaultActivityProgressRepo
} from '../../repositories/activity-progress.repository.js';
import {
  ActivityRepository,
  activityRepository as defaultActivityRepo
} from '../../repositories/activity.repository.js';
import {
  AnomalyModelService,
  defaultAnomalyModelService
} from '../../ml/anomaly/anomaly-model.service.js';
import { extractAnomalyFeatures } from '../../ml/anomaly/anomaly-feature-extractor.js';
import { calculatePlannedProgress } from '../snapshot/progress-snapshot.calculator.js';
import { COLD_START_ANOMALY_PREDICTION, AnomalyPrediction } from '../../ml/types.js';
import type {
  EvaluateProgressAnomalyInput,
  ProgressAnomalyEvaluationService
} from './progress-anomaly-evaluation.types.js';
export type {
  EvaluateProgressAnomalyInput,
  ProgressAnomalyEvaluationService
} from './progress-anomaly-evaluation.types.js';
import { logger } from '../../config/logger.js';

export interface ProgressAnomalyEvaluationServiceDependencies {
  activityProgressRepo?: ActivityProgressRepository;
  activityRepo?: ActivityRepository;
  anomalyModelService?: AnomalyModelService;
}

export class DefaultProgressAnomalyEvaluationService implements ProgressAnomalyEvaluationService {
  private activityProgressRepo: ActivityProgressRepository;
  private activityRepo: ActivityRepository;
  private anomalyModelService: AnomalyModelService;

  constructor(dependencies?: ProgressAnomalyEvaluationServiceDependencies) {
    this.activityProgressRepo = dependencies?.activityProgressRepo || defaultActivityProgressRepo;
    this.activityRepo = dependencies?.activityRepo || defaultActivityRepo;
    this.anomalyModelService = dependencies?.anomalyModelService || defaultAnomalyModelService;
  }

  evaluateProgressAnomaly(input: EvaluateProgressAnomalyInput): AnomalyPrediction | null {
    const { projectId, activityId, activity: passedActivity, reportedPercent, reportDate } = input;

    // 1. If progress percent is missing or non-numeric, return null (no progress observation to evaluate)
    if (
      reportedPercent === null ||
      reportedPercent === undefined ||
      typeof reportedPercent !== 'number' ||
      !Number.isFinite(reportedPercent)
    ) {
      return null;
    }

    try {
      // 2. Resolve activity metadata for planned timeline and identifiers
      let act = passedActivity;
      if (!act) {
        act = this.activityRepo.getById(activityId);
      }

      if (!act) {
        logger.warn(
          `ProgressAnomalyEvaluationService: Activity '${activityId}' not found for project '${projectId}'. Falling back to cold-start.`
        );
        return { ...COLD_START_ANOMALY_PREDICTION };
      }

      // 3. Resolve canonical evaluation date
      const effectiveDate = (reportDate || '').slice(0, 10) || new Date().toISOString().slice(0, 10);

      // 4. Retrieve latest canonical observation strictly as of report date
      // Critical Invariant: Must run before new observation is committed so current report does not become its own baseline
      const priorObservation = this.activityProgressRepo.getLatestByActivityIdAsOfDate(
        act.id,
        projectId,
        effectiveDate
      );

      // 5. Cold start: if no prior canonical observation exists, return safe cold-start
      if (!priorObservation) {
        return { ...COLD_START_ANOMALY_PREDICTION };
      }

      // 6. Calculate planned progress as-of report date
      const { plannedProgress } = calculatePlannedProgress(
        act.plannedStart,
        act.plannedFinish,
        effectiveDate,
        act.externalId || act.name
      );

      // 7. Extract the 5 canonical anomaly features
      const anomalyFeatures = extractAnomalyFeatures({
        reportedPercent,
        priorObservation,
        plannedPercent: plannedProgress,
        reportDate: effectiveDate
      });

      // 8. Invoke AnomalyModelService inference
      if (anomalyFeatures && this.anomalyModelService.isAvailable()) {
        return this.anomalyModelService.predict(anomalyFeatures);
      }

      return { ...COLD_START_ANOMALY_PREDICTION };
    } catch (err: any) {
      logger.warn(
        `ProgressAnomalyEvaluationService: Anomaly evaluation failed gracefully for activity '${activityId}': ${err?.message || err}. Falling back to cold-start.`
      );
      return { ...COLD_START_ANOMALY_PREDICTION };
    }
  }
}

export const defaultProgressAnomalyEvaluationService: ProgressAnomalyEvaluationService =
  new DefaultProgressAnomalyEvaluationService();
