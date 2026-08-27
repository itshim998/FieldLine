import { ProjectRepository, projectRepository as defaultProjectRepo } from '../../repositories/project.repository.js';
import { ProgressUpdateRepository, progressUpdateRepository as defaultProgressUpdateRepo } from '../../repositories/progress-update.repository.js';
import { ActivityRepository, activityRepository as defaultActivityRepo } from '../../repositories/activity.repository.js';
import { ActivityMatchRepository, activityMatchRepository as defaultActivityMatchRepo } from '../../repositories/activity-match.repository.js';
import { FieldProgressExtraction, FieldProgressItem } from '../../ai/contracts/field-progress-extraction.contract.js';
import {
  CandidateMatch,
  FieldFactMatchResult,
  MatchReportResult,
  MatchingOptions
} from './activity-matching.types.js';
import { scoreActivityCandidate } from './activity-match-scoring.js';
import { SemanticActivityMatcher, defaultSemanticMatcher } from './semantic-matcher.js';
import { LLMActivityDisambiguator, defaultLlmActivityDisambiguator } from './llm-disambiguator.js';
import { NotFoundError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';

export const DEFAULT_MIN_CONFIDENCE_THRESHOLD = 0.40;
export const DEFAULT_ALTERNATIVE_SCORE_MARGIN = 0.05;
export const DEFAULT_MAX_ALTERNATIVES = 3;

/**
 * Core application service orchestrating activity matching for field progress updates.
 */
export class ActivityMatchingService {
  private projectRepo: ProjectRepository;
  private progressUpdateRepo: ProgressUpdateRepository;
  private activityRepo: ActivityRepository;
  private activityMatchRepo: ActivityMatchRepository;
  private semanticMatcher: SemanticActivityMatcher;
  private llmDisambiguator: LLMActivityDisambiguator;

  constructor(dependencies?: {
    projectRepo?: ProjectRepository;
    progressUpdateRepo?: ProgressUpdateRepository;
    activityRepo?: ActivityRepository;
    activityMatchRepo?: ActivityMatchRepository;
    semanticMatcher?: SemanticActivityMatcher;
    llmDisambiguator?: LLMActivityDisambiguator;
  }) {
    this.projectRepo = dependencies?.projectRepo || defaultProjectRepo;
    this.progressUpdateRepo = dependencies?.progressUpdateRepo || defaultProgressUpdateRepo;
    this.activityRepo = dependencies?.activityRepo || defaultActivityRepo;
    this.activityMatchRepo = dependencies?.activityMatchRepo || defaultActivityMatchRepo;
    this.semanticMatcher = dependencies?.semanticMatcher || defaultSemanticMatcher;
    this.llmDisambiguator = dependencies?.llmDisambiguator || defaultLlmActivityDisambiguator;
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
        matchResults.push({
          fact,
          bestMatch: null,
          alternatives: []
        });
      }
      return matchResults;
    }

    // 3. Score each field fact against project activities
    for (const fact of extraction.items) {
      const candidates: CandidateMatch[] = [];

      for (const activity of activities) {
        const candidate = scoreActivityCandidate(fact, activity);
        if (candidate.confidenceScore >= minConfidenceThreshold) {
          candidates.push(candidate);
        }
      }

      // Sort descending by confidence score
      candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);

      let rankedCandidates = [...candidates];

      // Disambiguate if ambiguous top candidates exist and LLM disambiguation is enabled
      if (
        enableLlmDisambiguation &&
        rankedCandidates.length >= 2 &&
        rankedCandidates[0].matchMethod !== 'exact_id' &&
        Math.abs(rankedCandidates[0].confidenceScore - rankedCandidates[1].confidenceScore) <= alternativeScoreMargin
      ) {
        rankedCandidates = await this.llmDisambiguator.disambiguate(fact, rankedCandidates.slice(0, 3));
      }

      let bestMatch: CandidateMatch | null = null;
      let alternatives: CandidateMatch[] = [];

      if (rankedCandidates.length > 0) {
        bestMatch = rankedCandidates[0];
        alternatives = rankedCandidates.slice(1, 1 + maxAlternatives);
      }

      matchResults.push({
        fact,
        bestMatch,
        alternatives
      });
    }

    return matchResults;
  }

  /**
   * Matches structured field progress extraction items against project activities
   * and optionally persists candidates as 'suggested' matches.
   */
  async matchProgressUpdate(
    projectId: string,
    progressUpdateId: string,
    extraction: FieldProgressExtraction,
    options: MatchingOptions = {}
  ): Promise<MatchReportResult> {
    const { persist = true } = options;

    // 1. Verify progress report exists and belongs to the specified project (strict isolation)
    const progressRecord = this.progressUpdateRepo.getByIdAndProjectId(progressUpdateId, projectId);
    if (!progressRecord) {
      // Also verify project exists for appropriate error message
      const project = this.projectRepo.getById(projectId);
      if (!project) {
        throw new NotFoundError(`Project with ID '${projectId}' not found`);
      }
      throw new NotFoundError(
        `Progress report with ID '${progressUpdateId}' not found for project '${projectId}'`
      );
    }

    // 2. Compute candidate matches
    const matchResults = await this.computeMatches(projectId, extraction, options);

    // 3. Persist suggested matches if requested
    if (persist) {
      // Clean up only previous suggestions for this report to preserve human-reviewed confirmed/rejected matches
      this.activityMatchRepo.deleteSuggestedByProgressUpdateId(progressUpdateId, projectId);

      const toPersist = matchResults
        .filter((r): r is FieldFactMatchResult & { bestMatch: CandidateMatch } => r.bestMatch !== null)
        .map(r => ({
          projectId,
          progressUpdateId,
          activityId: r.bestMatch.activityId,
          confidenceScore: r.bestMatch.confidenceScore,
          matchMethod: r.bestMatch.matchMethod,
          matchedText: r.bestMatch.matchedText,
          rationale: r.bestMatch.rationale,
          status: 'suggested' as const // CRITICAL INVARIANT: always 'suggested', never 'confirmed'
        }));

      if (toPersist.length > 0) {
        this.activityMatchRepo.createMany(toPersist);
        logger.debug(`ActivityMatchingService: Persisted ${toPersist.length} suggested matches for report ${progressUpdateId}`);
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
  getMatchesForUpdate(projectId: string, progressUpdateId: string) {
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
}

export const activityMatchingService = new ActivityMatchingService();
