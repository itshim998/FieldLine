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
import { MaybePromise } from '../../database/provider.js';
import { Activity } from '../../models/domain.types.js';
import { ActivityProgress } from '../../models/domain.types.js';

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

  evaluateProgressAnomaly(input: EvaluateProgressAnomalyInput): MaybePromise<AnomalyPrediction | null> {
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
      // 3. Resolve canonical evaluation date
      const effectiveDate = (reportDate || '').slice(0, 10) || new Date().toISOString().slice(0, 10);

      // 2. Resolve activity metadata for planned timeline and identifiers
      const actRes = passedActivity || this.activityRepo.getById(activityId);
      if (actRes instanceof Promise) {
        return actRes.then((act) => {
          if (!act) {
            logger.warn(
              `ProgressAnomalyEvaluationService: Activity '${activityId}' not found for project '${projectId}'. Falling back to cold-start.`
            );
            return { ...COLD_START_ANOMALY_PREDICTION };
          }
          const priorRes = this.activityProgressRepo.getLatestByActivityIdAsOfDate(
            act.id,
            projectId,
            effectiveDate
          );
          if (priorRes instanceof Promise) {
            return priorRes.then((prior) =>
              this.computePrediction(act, prior, effectiveDate, reportedPercent)
            );
          }
          return this.computePrediction(act, priorRes, effectiveDate, reportedPercent);
        }).catch((err: any) => {
          logger.warn(
            `ProgressAnomalyEvaluationService: Anomaly evaluation failed gracefully for activity '${activityId}': ${err?.message || err}. Falling back to cold-start.`
          );
          return { ...COLD_START_ANOMALY_PREDICTION };
        });
      }

      const act = actRes;
      if (!act) {
        logger.warn(
          `ProgressAnomalyEvaluationService: Activity '${activityId}' not found for project '${projectId}'. Falling back to cold-start.`
        );
        return { ...COLD_START_ANOMALY_PREDICTION };
      }

      const priorRes = this.activityProgressRepo.getLatestByActivityIdAsOfDate(
        act.id,
        projectId,
        effectiveDate
      );
      if (priorRes instanceof Promise) {
        return priorRes.then((prior) =>
          this.computePrediction(act, prior, effectiveDate, reportedPercent)
        ).catch((err: any) => {
          logger.warn(
            `ProgressAnomalyEvaluationService: Anomaly evaluation failed gracefully for activity '${activityId}': ${err?.message || err}. Falling back to cold-start.`
          );
          return { ...COLD_START_ANOMALY_PREDICTION };
        });
      }

      return this.computePrediction(act, priorRes, effectiveDate, reportedPercent);
    } catch (err: any) {
      logger.warn(
        `ProgressAnomalyEvaluationService: Anomaly evaluation failed gracefully for activity '${activityId}': ${err?.message || err}. Falling back to cold-start.`
      );
      return { ...COLD_START_ANOMALY_PREDICTION };
    }
  }

  private computePrediction(
    act: Pick<Activity, 'id' | 'plannedStart' | 'plannedFinish' | 'externalId' | 'name'>,
    priorObservation: ActivityProgress | null,
    effectiveDate: string,
    reportedPercent: number
  ): AnomalyPrediction {
    if (!priorObservation) {
      return { ...COLD_START_ANOMALY_PREDICTION };
    }

    const { plannedProgress } = calculatePlannedProgress(
      act.plannedStart,
      act.plannedFinish,
      effectiveDate,
      act.externalId || act.name
    );

    const anomalyFeatures = extractAnomalyFeatures({
      reportedPercent,
      priorObservation,
      plannedPercent: plannedProgress,
      reportDate: effectiveDate
    });

    if (anomalyFeatures && this.anomalyModelService.isAvailable()) {
      return this.anomalyModelService.predict(anomalyFeatures);
    }

    return { ...COLD_START_ANOMALY_PREDICTION };
  }
}

export const defaultProgressAnomalyEvaluationService: ProgressAnomalyEvaluationService =
  new DefaultProgressAnomalyEvaluationService();
