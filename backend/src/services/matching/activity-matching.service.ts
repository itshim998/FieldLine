import { ProjectRepository, projectRepository as defaultProjectRepo } from '../../repositories/project.repository.js';
import { ProgressUpdateRepository, progressUpdateRepository as defaultProgressUpdateRepo } from '../../repositories/progress-update.repository.js';
import { ActivityRepository, activityRepository as defaultActivityRepo } from '../../repositories/activity.repository.js';
import { ActivityMatchRepository, activityMatchRepository as defaultActivityMatchRepo } from '../../repositories/activity-match.repository.js';
import { ProjectEventRepository, projectEventRepository as defaultProjectEventRepo } from '../../repositories/project-event.repository.js';
import { ActivityProgressRepository, activityProgressRepository as defaultActivityProgressRepo } from '../../repositories/activity-progress.repository.js';
import { FieldProgressExtraction } from '../../ai/contracts/field-progress-extraction.contract.js';
import {
  CandidateMatch,
  FieldFactMatchResult,
  MatchReportResult,
  MatchingOptions
} from './activity-matching.types.js';
import { scoreActivityCandidate } from './activity-match-scoring.js';
import { SemanticActivityMatcher, defaultSemanticMatcher } from './semantic-matcher.js';
import { LLMActivityDisambiguator, defaultLlmActivityDisambiguator } from './llm-disambiguator.js';
import { classifyMatchConfidence, DEFAULT_MIN_CONFIDENCE_THRESHOLD, DEFAULT_AUTO_CONFIRM_MARGIN, DEFAULT_HIGH_CONFIDENCE_THRESHOLD, DEFAULT_MEDIUM_CONFIDENCE_THRESHOLD } from './match-review-policy.js';
import { Activity, ActivityMatch, CreateActivityMatchInput, CreateProjectEventInput } from '../../models/domain.types.js';
import { MatchModelService, defaultMatchModelService } from '../../ml/match/match-model.service.js';
import { extractMatchFeatures } from '../../ml/match/match-feature-extractor.js';
import { AnomalyModelService, defaultAnomalyModelService } from '../../ml/anomaly/anomaly-model.service.js';
import {
  ProgressAnomalyEvaluationService,
  DefaultProgressAnomalyEvaluationService,
  defaultProgressAnomalyEvaluationService
} from '../anomaly/progress-anomaly-evaluation.service.js';
import {
  AnomalyNotificationService,
  defaultAnomalyNotificationService,
  isEligibleForAnomalyAlert
} from '../anomaly/index.js';
import { AnomalyPrediction } from '../../ml/types.js';
import { NotFoundError, ValidationError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';

export {
  DEFAULT_MIN_CONFIDENCE_THRESHOLD,
  DEFAULT_AUTO_CONFIRM_MARGIN,
  DEFAULT_HIGH_CONFIDENCE_THRESHOLD,
  DEFAULT_MEDIUM_CONFIDENCE_THRESHOLD
};

export const DEFAULT_ALTERNATIVE_SCORE_MARGIN = 0.05;
export const DEFAULT_MAX_ALTERNATIVES = 3;

/**
 * Core application service orchestrating activity matching and human review workflow for field progress updates.
 */
export class ActivityMatchingService {
  private projectRepo: ProjectRepository;
  private progressUpdateRepo: ProgressUpdateRepository;
  private activityRepo: ActivityRepository;
  private activityMatchRepo: ActivityMatchRepository;
  private projectEventRepo: ProjectEventRepository;
  private semanticMatcher: SemanticActivityMatcher;
  private llmDisambiguator: LLMActivityDisambiguator;
  private matchModelService: MatchModelService;
  private activityProgressRepo: ActivityProgressRepository;
  private anomalyModelService: AnomalyModelService;
  private anomalyEvaluationService: ProgressAnomalyEvaluationService;
  private anomalyNotificationService: AnomalyNotificationService;

  constructor(dependencies?: {
    projectRepo?: ProjectRepository;
    progressUpdateRepo?: ProgressUpdateRepository;
    activityRepo?: ActivityRepository;
    activityMatchRepo?: ActivityMatchRepository;
    projectEventRepo?: ProjectEventRepository;
    semanticMatcher?: SemanticActivityMatcher;
    llmDisambiguator?: LLMActivityDisambiguator;
    matchModelService?: MatchModelService;
    activityProgressRepo?: ActivityProgressRepository;
    anomalyModelService?: AnomalyModelService;
    anomalyEvaluationService?: ProgressAnomalyEvaluationService;
    anomalyNotificationService?: AnomalyNotificationService;
  }) {
    this.projectRepo = dependencies?.projectRepo || defaultProjectRepo;
    this.progressUpdateRepo = dependencies?.progressUpdateRepo || defaultProgressUpdateRepo;
    this.activityRepo = dependencies?.activityRepo || defaultActivityRepo;
    this.activityMatchRepo = dependencies?.activityMatchRepo || defaultActivityMatchRepo;
    this.projectEventRepo = dependencies?.projectEventRepo || defaultProjectEventRepo;
    this.semanticMatcher = dependencies?.semanticMatcher || defaultSemanticMatcher;
    this.llmDisambiguator = dependencies?.llmDisambiguator || defaultLlmActivityDisambiguator;
    this.matchModelService = dependencies?.matchModelService || defaultMatchModelService;
    this.activityProgressRepo = dependencies?.activityProgressRepo || defaultActivityProgressRepo;
    this.anomalyModelService = dependencies?.anomalyModelService || defaultAnomalyModelService;
    this.anomalyEvaluationService =
      dependencies?.anomalyEvaluationService ||
      new DefaultProgressAnomalyEvaluationService({
        activityProgressRepo: this.activityProgressRepo,
        activityRepo: this.activityRepo,
        anomalyModelService: this.anomalyModelService
      });
    this.anomalyNotificationService =
      dependencies?.anomalyNotificationService || defaultAnomalyNotificationService;
  }

  /**
   * Computes candidate matches for field progress extraction items without mutating database state.
   */
  async computeMatches(
    projectId: string,
    extraction: FieldProgressExtraction,
    options: MatchingOptions = {}
  ): Promise<FieldFactMatchResult[]> {
    const {
      minConfidenceThreshold = DEFAULT_MIN_CONFIDENCE_THRESHOLD,
      alternativeScoreMargin = DEFAULT_ALTERNATIVE_SCORE_MARGIN,
      maxAlternatives = DEFAULT_MAX_ALTERNATIVES,
      enableLlmDisambiguation = false
    } = options;

    // 1. Verify project exists
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    // 2. Fetch scheduled activities for this project
    const activities = this.activityRepo.listByProjectId(projectId);
    logger.debug(`ActivityMatchingService: Loaded ${activities.length} activities for project ${projectId}`);

    const matchResults: FieldFactMatchResult[] = [];

    // If project has no activities, return empty match results for each fact
    if (activities.length === 0) {
      for (const fact of extraction.items) {
        const decision = classifyMatchConfidence(null, []);
        matchResults.push({
          fact,
          bestMatch: null,
          alternatives: [],
          confidenceTier: decision.tier,
          reviewDecision: decision
        });
      }
      return matchResults;
    }

    // 3. Score each field fact against project activities
    for (const fact of extraction.items) {
      const candidates: CandidateMatch[] = [];
      const activityMap = new Map<string, Activity>();

      for (const activity of activities) {
        activityMap.set(activity.id, activity);
        const candidate = scoreActivityCandidate(fact, activity);
        if (candidate.confidenceScore >= minConfidenceThreshold) {
          candidates.push(candidate);
        }
      }

      // Sort descending by deterministic confidence score
      candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);

      // Determine effective report date for planned progress and anomaly calculations
      const reportDate = options.asOfDate || new Date().toISOString().slice(0, 10);

      // Score candidates with Match Model (ML Reranker - Phase 10) & Anomaly Model (Phase 18)
      const rankedWithMl: CandidateMatch[] = candidates.map((candidate, idx) => {
        // Deterministic candidate separation:
        // runnerUpScore = best deterministic competitor's score
        // For candidate 0: runnerUp is candidate 1 (if exists)
        // For candidate k > 0: best competitor is candidate 0
        const runnerUp = idx === 0 ? candidates[1] : candidates[0];
        const scoreGap = runnerUp
          ? Math.max(0, candidate.confidenceScore - runnerUp.confidenceScore)
          : 1.0;

        let mlConfidence: number | undefined = undefined;
        let finalScore = candidate.confidenceScore;
        let rationale = candidate.rationale;

        const act = activityMap.get(candidate.activityId);
        if (this.matchModelService.isAvailable() && act) {
          const features = extractMatchFeatures(
            { reference: fact.reference, location: fact.location },
            {
              externalId: act.externalId,
              name: act.name,
              description: act.description,
              wbsCode: act.wbsCode,
              location: act.location
            },
            scoreGap
          );
          mlConfidence = this.matchModelService.predict(features);

          if (candidate.matchMethod === 'exact_id') {
            // Exact ID candidates retain deterministic exact-ID score behavior
            finalScore = candidate.confidenceScore;
          } else {
            // Plan formula: 0.4 deterministic + 0.6 ML confidence
            finalScore = Math.round((candidate.confidenceScore * 0.4 + mlConfidence * 0.6) * 1000) / 1000;
          }

          if (!rationale.includes('Learned ML confidence')) {
            rationale = `${candidate.rationale}; Learned ML confidence: ${Math.round(mlConfidence * 100)}%`;
          }
        }

        // Anomaly Evaluation (Review-Prioritization Assistant - Phase 1 & Phase 18)
        // Evaluates candidates with non-null reported progress against prior canonical history
        let anomaly: AnomalyPrediction | undefined = undefined;
        let previousPercent: number | null = null;
        if (fact.progress_percent !== null && fact.progress_percent !== undefined && act) {
          const priorObs = this.activityProgressRepo.getLatestByActivityIdAsOfDate(
            act.id,
            projectId,
            reportDate
          );
          if (priorObs) {
            previousPercent = priorObs.actualPercent;
          }

          const evalResult = this.anomalyEvaluationService.evaluateProgressAnomaly({
            projectId,
            activityId: act.id,
            activity: act,
            reportedPercent: fact.progress_percent,
            reportDate
          });
          if (evalResult) {
            anomaly = evalResult;
          }
        }

        return {
          ...candidate,
          deterministicScore: candidate.confidenceScore,
          rationale,
          mlConfidence: mlConfidence ?? null,
          finalScore,
          scoreGap,
          anomaly,
          anomalyScore: anomaly ? anomaly.anomalyScore : null,
          anomalySeverity: anomaly ? anomaly.severity : null,
          anomalyReasons: anomaly ? anomaly.reasons : null,
          previousPercent
        };
      });

      // Rerank candidates by final score descending
      rankedWithMl.sort((a, b) => {
        const scoreA = a.finalScore ?? a.confidenceScore;
        const scoreB = b.finalScore ?? b.confidenceScore;
        if (Math.abs(scoreB - scoreA) > 1e-6) {
          return scoreB - scoreA;
        }
        return b.confidenceScore - a.confidenceScore;
      });

      let rankedCandidates = [...rankedWithMl];

      // Disambiguate if ambiguous top candidates exist and LLM disambiguation is enabled
      if (
        enableLlmDisambiguation &&
        rankedCandidates.length >= 2 &&
        rankedCandidates[0].matchMethod !== 'exact_id' &&
        Math.abs(
          (rankedCandidates[0].finalScore ?? rankedCandidates[0].confidenceScore) -
            (rankedCandidates[1].finalScore ?? rankedCandidates[1].confidenceScore)
        ) <= alternativeScoreMargin
      ) {
        rankedCandidates = await this.llmDisambiguator.disambiguate(fact, rankedCandidates.slice(0, 3));
      }

      let bestMatch: CandidateMatch | null = null;
      let alternatives: CandidateMatch[] = [];

      if (rankedCandidates.length > 0) {
        bestMatch = rankedCandidates[0];
        alternatives = rankedCandidates.slice(1, 1 + maxAlternatives);
      }

      const reviewDecision = classifyMatchConfidence(bestMatch, alternatives);

      // Enforce strict dual-threshold auto-confirm gate (Phase 10)
      // Exact ID matches retain deterministic exact-ID auto-confirm behavior.
      // For all non-exact matches:
      //   Auto-confirm ONLY IF:
      //     deterministicScore >= 0.90
      //     AND mlConfidence >= 0.85
      //     AND deterministic scoreGap >= 0.15
      // If any condition fails:
      //   autoConfirm = false
      //   reviewState = 'awaiting_review'
      if (bestMatch) {
        const isExactId = bestMatch.matchMethod === 'exact_id';
        if (!isExactId) {
          const s_det = bestMatch.confidenceScore;
          const p_ml = bestMatch.mlConfidence ?? 0;
          const scoreGap = bestMatch.scoreGap ?? 0;

          const meetsGate = s_det >= 0.90 && p_ml >= 0.85 && scoreGap >= 0.15;
          if (!meetsGate) {
            reviewDecision.autoConfirm = false;
            reviewDecision.reviewState = 'awaiting_review';
            if (reviewDecision.tier === 'high') {
              reviewDecision.tier = 'medium';
            }
          }
        }
      }

      matchResults.push({
        fact,
        bestMatch,
        alternatives,
        confidenceTier: reviewDecision.tier,
        reviewDecision
      });
    }

    return matchResults;
  }

  /**
   * Matches structured field progress extraction items against project activities
   * and persists candidates according to the Pass 19 deterministic review policy:
   * - High confidence unambiguous -> auto-confirmed (status: 'confirmed', reviewedBy: 'system')
   * - Medium confidence / ambiguous -> suggested (status: 'suggested', reviewState: 'awaiting_review')
   * - Low confidence -> unresolved (status: 'suggested', reviewState: 'unresolved')
   *
   * All match updates, deletions, and audit events are committed atomically inside a single transaction.
   */
  async matchProgressUpdate(
    projectId: string,
    progressUpdateId: string,
    extraction: FieldProgressExtraction,
    options: MatchingOptions = {}
  ): Promise<MatchReportResult> {
    const { persist = true } = options;

    // 1. Verify project and progress report exist and belong to the specified project (strict isolation)
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const progressRecord = this.progressUpdateRepo.getByIdAndProjectId(progressUpdateId, projectId);
    if (!progressRecord) {
      throw new NotFoundError(
        `Progress report with ID '${progressUpdateId}' not found for project '${projectId}'`
      );
    }

    // 2. Compute candidate matches (passing progress report date as-of date)
    const matchResults = await this.computeMatches(projectId, extraction, {
      ...options,
      asOfDate: options.asOfDate || progressRecord.reportDate
    });

    // 3. Persist matches and events atomically if requested
    if (persist) {
      const nowIso = new Date().toISOString();
      const toPersist: CreateActivityMatchInput[] = [];
      const events: CreateProjectEventInput[] = [];

      for (const r of matchResults) {
        if (!r.bestMatch) continue;

        const decision = r.reviewDecision || classifyMatchConfidence(r.bestMatch, r.alternatives);
        const isAutoConfirm = decision.autoConfirm;
        const matchId = crypto.randomUUID();
        const effectiveScore = r.bestMatch.finalScore ?? r.bestMatch.confidenceScore;

        const anomalyScore = r.bestMatch.anomalyScore ?? r.bestMatch.anomaly?.anomalyScore ?? null;
        const anomalySeverity = r.bestMatch.anomalySeverity ?? r.bestMatch.anomaly?.severity ?? null;
        const anomalyReasons = r.bestMatch.anomalyReasons ?? r.bestMatch.anomaly?.reasons ?? null;

        toPersist.push({
          id: matchId,
          projectId,
          progressUpdateId,
          activityId: r.bestMatch.activityId,
          confidenceScore: effectiveScore,
          matchMethod: r.bestMatch.matchMethod,
          matchedText: r.bestMatch.matchedText,
          rationale: r.bestMatch.rationale,
          status: isAutoConfirm ? ('confirmed' as const) : ('suggested' as const),
          confidenceTier: decision.tier,
          reviewState: decision.reviewState,
          reviewedBy: isAutoConfirm ? 'system' : null,
          reviewedAt: isAutoConfirm ? nowIso : null,
          mlConfidence: r.bestMatch.mlConfidence ?? null,
          anomalyScore,
          anomalySeverity,
          anomalyReasonsJson: anomalyReasons && anomalyReasons.length > 0 ? JSON.stringify(anomalyReasons) : null
        });

        if (isAutoConfirm) {
          events.push({
            projectId,
            eventType: 'match_auto_confirmed',
            entityType: 'activity_matches',
            entityId: matchId,
            summary: `Activity match automatically confirmed by system for activity '${r.bestMatch.activityId}' (${(effectiveScore * 100).toFixed(0)}% confidence)`,
            payloadJson: JSON.stringify({
              matchId,
              progressUpdateId,
              activityId: r.bestMatch.activityId,
              confidenceScore: effectiveScore,
              deterministicScore: r.bestMatch.confidenceScore,
              mlConfidence: r.bestMatch.mlConfidence,
              confidenceTier: decision.tier,
              reviewSource: 'system',
              anomaly: r.bestMatch.anomaly
            })
          });
        } else {
          events.push({
            projectId,
            eventType: 'match_suggested',
            entityType: 'activity_matches',
            entityId: matchId,
            summary: `Activity match suggested for activity '${r.bestMatch.activityId}' (${(effectiveScore * 100).toFixed(0)}% confidence, ${decision.tier} tier, state: ${decision.reviewState})`,
            payloadJson: JSON.stringify({
              matchId,
              progressUpdateId,
              activityId: r.bestMatch.activityId,
              confidenceScore: effectiveScore,
              deterministicScore: r.bestMatch.confidenceScore,
              mlConfidence: r.bestMatch.mlConfidence,
              confidenceTier: decision.tier,
              reviewState: decision.reviewState,
              anomaly: r.bestMatch.anomaly
            })
          });
        }
      }


      this.activityMatchRepo.persistMatchesAndEventsAtomically({
        projectId,
        progressUpdateId,
        matches: toPersist,
        events
      });
      logger.debug(`ActivityMatchingService: Atomically persisted ${toPersist.length} matches and ${events.length} events for report ${progressUpdateId}`);

      // Phase 3 Anomaly Notification: Trigger alerts for persisted matches with eligible anomalies
      for (const r of matchResults) {
        if (r.bestMatch && r.bestMatch.anomaly && isEligibleForAnomalyAlert(r.bestMatch.anomaly)) {
          const act = this.activityRepo.getById(r.bestMatch.activityId);
          const persistedMatch = toPersist.find((m) => m.activityId === r.bestMatch!.activityId);
          try {
            await this.anomalyNotificationService.notifyAnomalyAlert({
              prediction: r.bestMatch.anomaly,
              context: {
                projectName: project.name,
                activityExternalId: r.bestMatch.activityExternalId,
                activityName: r.bestMatch.activityName,
                activityLocation: act?.location || null,
                reportDate: progressRecord.reportDate,
                reporterName: progressRecord.reporterName,
                previousPercent: r.bestMatch.previousPercent ?? null,
                reportedPercent: r.fact.progress_percent ?? 0,
                activityMatchId: persistedMatch?.id || null
              }
            });
          } catch (notifErr: any) {
            logger.warn(
              `ActivityMatchingService: Anomaly notification dispatch failed non-fatally for match '${persistedMatch?.id}': ${notifErr?.message || notifErr}`
            );
          }
        }
      }
    }

    return {
      projectId,
      progressUpdateId,
      matches: matchResults
    };
  }

  /**
   * Retrieves existing persisted matches for a given progress update.
   */
  getMatchesForUpdate(projectId: string, progressUpdateId: string): ActivityMatch[] {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const progressRecord = this.progressUpdateRepo.getByIdAndProjectId(progressUpdateId, projectId);
    if (!progressRecord) {
      throw new NotFoundError(
        `Progress report with ID '${progressUpdateId}' not found for project '${projectId}'`
      );
    }

    return this.activityMatchRepo.listByProgressUpdateId(progressUpdateId, projectId);
  }

  /**
   * Retrieves a single match by ID, ensuring strict project boundary.
   */
  getMatchById(projectId: string, matchId: string): ActivityMatch {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const match = this.activityMatchRepo.getByIdAndProjectId(matchId, projectId);
    if (!match) {
      throw new NotFoundError(
        `Activity match with ID '${matchId}' not found for project '${projectId}'`
      );
    }

    return match;
  }

  /**
   * Human review action: Confirms a suggested match atomically with its audit event.
   * Confirmed matches are immutable historical decisions and cannot be re-confirmed, rejected, or retargeted.
   */
  async confirmMatch(
    projectId: string,
    matchId: string,
    reviewer: string = 'human'
  ): Promise<ActivityMatch> {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const existingMatch = this.activityMatchRepo.getByIdAndProjectId(matchId, projectId);
    if (!existingMatch) {
      throw new NotFoundError(
        `Activity match with ID '${matchId}' not found for project '${projectId}'`
      );
    }

    if (existingMatch.status === 'confirmed') {
      throw new ValidationError(
        `Cannot confirm match '${matchId}'. Confirmed match history is immutable.`
      );
    }
    if (existingMatch.status === 'rejected') {
      throw new ValidationError(
        `Cannot confirm match '${matchId}'. Rejected match history is immutable.`
      );
    }
    if (existingMatch.reviewState === 'unresolved') {
      throw new ValidationError(
        `Cannot confirm unresolved match '${matchId}' without selecting an activity. Use resolve to assign a specific activity.`
      );
    }

    const nowIso = new Date().toISOString();
    return this.activityMatchRepo.confirmMatchAtomically({
      id: matchId,
      projectId,
      reviewer: reviewer || 'human',
      nowIso
    });
  }

  /**
   * Human review action: Rejects a suggested or unresolved match atomically with its audit event.
   * Rejected matches are immutable historical decisions and cannot be re-rejected, confirmed, or retargeted.
   */
  async rejectMatch(
    projectId: string,
    matchId: string,
    reviewer: string = 'human',
    reason?: string
  ): Promise<ActivityMatch> {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const existingMatch = this.activityMatchRepo.getByIdAndProjectId(matchId, projectId);
    if (!existingMatch) {
      throw new NotFoundError(
        `Activity match with ID '${matchId}' not found for project '${projectId}'`
      );
    }

    if (existingMatch.status === 'confirmed') {
      throw new ValidationError(
        `Cannot reject match '${matchId}'. Confirmed match history is immutable.`
      );
    }
    if (existingMatch.status === 'rejected') {
      throw new ValidationError(
        `Cannot reject match '${matchId}'. Rejected match history is immutable.`
      );
    }

    const nowIso = new Date().toISOString();
    const rationale = reason
      ? `${existingMatch.rationale || ''} [Rejected: ${reason}]`.trim()
      : existingMatch.rationale;

    return this.activityMatchRepo.rejectMatchAtomically({
      id: matchId,
      projectId,
      reviewer: reviewer || 'human',
      rationale,
      nowIso,
      reason
    });
  }

  /**
   * Human review action: Resolves an unresolved or candidate match to a chosen activity atomically with its audit event.
   * Once a match is confirmed, its activityId and status become immutable and cannot be retargeted.
   */
  async resolveMatch(
    projectId: string,
    matchId: string,
    targetActivityId: string,
    reviewer: string = 'human',
    reason?: string
  ): Promise<ActivityMatch> {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const existingMatch = this.activityMatchRepo.getByIdAndProjectId(matchId, projectId);
    if (!existingMatch) {
      throw new NotFoundError(
        `Activity match with ID '${matchId}' not found for project '${projectId}'`
      );
    }

    if (existingMatch.status === 'confirmed') {
      throw new ValidationError(
        `Cannot resolve or retarget match '${matchId}'. Confirmed match history is immutable.`
      );
    }
    if (existingMatch.status === 'rejected') {
      throw new ValidationError(
        `Cannot resolve match '${matchId}'. Rejected match history is immutable.`
      );
    }

    // Verify target activity belongs to the same project (strict cross-project isolation)
    const targetActivity = this.activityRepo.getById(targetActivityId);
    if (!targetActivity || targetActivity.projectId !== projectId) {
      throw new NotFoundError(
        `Target activity with ID '${targetActivityId}' not found for project '${projectId}'`
      );
    }

    const nowIso = new Date().toISOString();
    const originalRationale = existingMatch.rationale;
    const rationale = reason
      ? `${originalRationale || ''} [Resolved manually to ${targetActivity.name} (${targetActivity.externalId}): ${reason}]`.trim()
      : `${originalRationale || ''} [Resolved manually to ${targetActivity.name} (${targetActivity.externalId})]`.trim();

    return this.activityMatchRepo.resolveMatchAtomically({
      id: matchId,
      projectId,
      targetActivityId,
      targetActivityName: targetActivity.name,
      targetActivityExternalId: targetActivity.externalId,
      originalActivityId: existingMatch.activityId,
      originalRationale,
      reviewer: reviewer || 'human',
      rationale,
      nowIso,
      reason
    });
  }
}

export const activityMatchingService = new ActivityMatchingService();
