import {
  ProgressSnapshotService,
  progressSnapshotService as defaultSnapshotService
} from '../snapshot/progress-snapshot.service.js';
import {
  ProjectRiskStatus,
  RiskClassificationService
} from './risk-classification.types.js';
import { calculateProjectRiskStatus } from './risk-classification.calculator.js';
import { logger } from '../../config/logger.js';

export type { RiskClassificationService };

export class DefaultRiskClassificationService implements RiskClassificationService {
  private snapshotService: ProgressSnapshotService;

  constructor(dependencies?: {
    snapshotService?: ProgressSnapshotService;
  }) {
    this.snapshotService = dependencies?.snapshotService || defaultSnapshotService;
  }

  getProjectRiskStatus(projectId: string, asOfDate?: string): ProjectRiskStatus {
    // 1. Obtain authoritative, validated Pass 11 snapshot (validates project existence & asOfDate)
    const snapshot = this.snapshotService.getProgressSnapshot(projectId, asOfDate);

    // 2. Perform deterministic risk classification calculation
    const riskStatus = calculateProjectRiskStatus(snapshot);

    logger.info(
      `RiskClassificationService: Calculated risk status for project '${projectId}' as-of '${snapshot.asOfDate}' (${snapshot.activities.length} activities: ${riskStatus.summary.completed} completed, ${riskStatus.summary.delayed} delayed, ${riskStatus.summary.atRisk} at risk, ${riskStatus.summary.ahead} ahead, ${riskStatus.summary.onTrack} on track)`
    );

    return riskStatus;
  }
}

export const riskClassificationService: RiskClassificationService =
  new DefaultRiskClassificationService();
