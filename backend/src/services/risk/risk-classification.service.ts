import {
  ProgressSnapshotService,
  progressSnapshotService as defaultSnapshotService
} from '../snapshot/progress-snapshot.service.js';
import {
  ProjectRiskStatus,
  RiskClassificationService
} from './risk-classification.types.js';
import { calculateProjectRiskStatus } from './risk-classification.calculator.js';
import {
  OperationalBlockerRepository,
  operationalBlockerRepository as defaultBlockerRepo
} from '../../repositories/operational-blocker.repository.js';
import { OperationalBlocker, ProjectProgressSnapshot } from '../../models/domain.types.js';
import { logger } from '../../config/logger.js';
import { MaybePromise } from '../../database/provider.js';

export type { RiskClassificationService };

export class DefaultRiskClassificationService implements RiskClassificationService {
  private snapshotService: ProgressSnapshotService;
  private blockerRepo: OperationalBlockerRepository;

  constructor(dependencies?: {
    snapshotService?: ProgressSnapshotService;
    blockerRepo?: OperationalBlockerRepository;
  }) {
    this.snapshotService = dependencies?.snapshotService || defaultSnapshotService;
    this.blockerRepo = dependencies?.blockerRepo || defaultBlockerRepo;
  }

  getProjectRiskStatus(projectId: string, asOfDate?: string): MaybePromise<ProjectRiskStatus> {
    const snapshotRes = this.snapshotService.getProgressSnapshot(projectId, asOfDate);
    const blockersRes = this.blockerRepo.listActiveByProject(projectId);

    if (snapshotRes instanceof Promise || blockersRes instanceof Promise) {
      return Promise.all([Promise.resolve(snapshotRes), Promise.resolve(blockersRes)]).then(
        ([snapshot, activeBlockers]) => this.calculateRisk(projectId, snapshot, activeBlockers)
      );
    }

    return this.calculateRisk(projectId, snapshotRes, blockersRes);
  }

  private calculateRisk(
    projectId: string,
    snapshot: ProjectProgressSnapshot,
    activeBlockers: OperationalBlocker[]
  ): ProjectRiskStatus {
    const activeBlockersMap = new Map<string, OperationalBlocker[]>();

    for (const blocker of activeBlockers) {
      if (blocker.activityId) {
        const existing = activeBlockersMap.get(blocker.activityId) || [];
        existing.push(blocker);
        activeBlockersMap.set(blocker.activityId, existing);
      }
    }

    const riskStatus = calculateProjectRiskStatus(snapshot, undefined, activeBlockersMap);

    logger.info(
      `RiskClassificationService: Calculated risk status for project '${projectId}' as-of '${snapshot.asOfDate}' (${snapshot.activities.length} activities: ${riskStatus.summary.completed} completed, ${riskStatus.summary.delayed} delayed, ${riskStatus.summary.atRisk} at risk, ${riskStatus.summary.ahead} ahead, ${riskStatus.summary.onTrack} on track)`
    );

    return riskStatus;
  }
}

export const riskClassificationService: RiskClassificationService =
  new DefaultRiskClassificationService();

