import { Router, Request, Response } from 'express';
import { MatchModelService, defaultMatchModelService } from '../ml/match/match-model.service.js';
import { AnomalyModelService, defaultAnomalyModelService } from '../ml/anomaly/anomaly-model.service.js';

export interface MLStatusDependencies {
  matchModelService?: MatchModelService;
  anomalyModelService?: AnomalyModelService;
}

export interface ModelStatusSummary {
  loaded: boolean;
  version: string | null;
  type: string;
  featureCount: number;
}

export interface MLStatusResponse {
  status: 'healthy' | 'degraded' | 'unavailable';
  models: {
    matchModel: ModelStatusSummary;
    anomalyModel: ModelStatusSummary;
  };
}

/**
 * Creates the ML router exposing GET /ml/status (mounted under /api -> GET /api/ml/status).
 * Reflects actual runtime availability of both the Match Model and Anomaly Model.
 */
export function createMLRouter(deps: MLStatusDependencies = {}): Router {
  const router = Router();
  const matchService = deps.matchModelService || defaultMatchModelService;
  const anomalyService = deps.anomalyModelService || defaultAnomalyModelService;

  router.get('/ml/status', (_req: Request, res: Response): void => {
    const matchLoaded = matchService.isAvailable();
    const anomalyLoaded = anomalyService.isAvailable();

    const matchArtifact = matchService.getArtifact();
    const anomalyArtifact = anomalyService.getArtifact();

    let status: 'healthy' | 'degraded' | 'unavailable' = 'healthy';
    if (!matchLoaded && !anomalyLoaded) {
      status = 'unavailable';
    } else if (!matchLoaded || !anomalyLoaded) {
      status = 'degraded';
    }

    const responseBody: MLStatusResponse = {
      status,
      models: {
        matchModel: {
          loaded: matchLoaded,
          version: matchArtifact?.version ?? null,
          type: matchArtifact?.modelType ?? 'logistic_regression',
          featureCount: matchArtifact?.featureNames ? matchArtifact.featureNames.length : 8
        },
        anomalyModel: {
          loaded: anomalyLoaded,
          version: anomalyArtifact?.version ?? null,
          type: anomalyArtifact?.modelType ?? 'standardized_distance_anomaly',
          featureCount: anomalyArtifact?.featureNames ? anomalyArtifact.featureNames.length : 5
        }
      }
    };

    res.status(200).json(responseBody);
  });

  return router;
}

export const mlRouter: Router = createMLRouter();
