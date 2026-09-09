import { MatchFeatureVector } from '../types.js';
import {
  computeTextSimilarity,
  tokenize,
  jaccardSimilarity,
  overlapCoefficient,
  tokenContainmentScore
} from '../../services/matching/text-similarity.js';

function computeTokensSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0.0;
  const jaccard = jaccardSimilarity(tokensA, tokensB);
  const overlap = overlapCoefficient(tokensA, tokensB);
  const containment = tokenContainmentScore(tokensA, tokensB);
  const blended = 0.45 * overlap + 0.35 * containment + 0.20 * jaccard;
  return Math.min(1.0, Math.max(0.0, Math.round(blended * 1000) / 1000));
}

export interface MatchFeatureFactInput {
  reference: string;
  location?: string | null;
}

export interface MatchFeatureActivityInput {
  externalId: string;
  name: string;
  description?: string | null;
  wbsCode?: string | null;
  location?: string | null;
}

/**
 * Normalizes identifier strings for exact matching.
 */
function normalizeIdForMatch(id: string): string {
  return id.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Checks if a string has common external identifier characteristics.
 */
function isLikelyIdentifier(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 30) return false;
  return /^[a-zA-Z0-9]+([-_/.][a-zA-Z0-9]+)*$/.test(trimmed) && !trimmed.includes(' ');
}

/**
 * Extracts the 8 candidate-level Match Model features.
 * 
 * Candidate rank is strictly excluded to prevent rank leakage.
 * All features are deterministic and bounded in [0, 1].
 */
export function extractMatchFeatures(
  fact: MatchFeatureFactInput,
  activity: MatchFeatureActivityInput,
  scoreGapFromSecondCandidate: number = 0
): MatchFeatureVector {
  const ref = (fact.reference || '').trim();
  const refLower = ref.toLowerCase();
  const factLoc = (fact.location || '').trim();
  const actLoc = (activity.location || '').trim();
  const actName = (activity.name || '').trim();
  const actDesc = (activity.description || '').trim();
  const actExternalId = (activity.externalId || '').trim();
  const actWbs = (activity.wbsCode || '').trim();

  // 1. Name Similarity [0, 1]
  const name_similarity = computeTextSimilarity(ref, actName);

  // 2. Description Similarity [0, 1]
  const description_similarity = actDesc.length > 0
    ? computeTextSimilarity(ref, actDesc)
    : 0.0;

  // 3, 4, 5. Location Features
  let location_exact_match = 0.0;
  let location_similarity = 0.0;
  let location_contradiction = 0.0;

  if (factLoc.length > 0 && actLoc.length > 0) {
    const fLocNorm = factLoc.toLowerCase();
    const aLocNorm = actLoc.toLowerCase();

    if (fLocNorm === aLocNorm) {
      location_exact_match = 1.0;
      location_similarity = 1.0;
      location_contradiction = 0.0;
    } else if (fLocNorm.includes(aLocNorm) || aLocNorm.includes(fLocNorm)) {
      location_exact_match = 0.0;
      location_similarity = 0.90;
      location_contradiction = 0.0;
    } else {
      const fTokens = tokenize(factLoc, false);
      const aTokens = tokenize(actLoc, false);
      const locSim = computeTokensSimilarity(fTokens, aTokens);
      location_similarity = locSim;
      if (locSim >= 0.75) {
        location_exact_match = 0.0;
        location_contradiction = 0.0;
      } else {
        // Both non-empty and explicitly conflicting
        location_exact_match = 0.0;
        location_contradiction = 1.0;
      }
    }
  } else if (factLoc.length > 0 && actLoc.length === 0) {
    // Activity has no location, check if activity name explicitly mentions the location
    if (actName.toLowerCase().includes(factLoc.toLowerCase())) {
      location_similarity = 0.75;
    }
  }

  // 6. WBS Match [0.0 or 1.0]
  let wbs_match = 0.0;
  if (actWbs.length > 0) {
    const wbsNorm = actWbs.toLowerCase();
    if (refLower.includes(wbsNorm) || (factLoc.length > 0 && factLoc.toLowerCase().includes(wbsNorm))) {
      wbs_match = 1.0;
    }
  }

  // 7. Exact ID Match [0.0 or 1.0]
  let exact_id_match = 0.0;
  if (actExternalId.length > 0) {
    const actIdNorm = normalizeIdForMatch(actExternalId);
    const refIdNorm = normalizeIdForMatch(ref);

    if (refIdNorm === actIdNorm) {
      exact_id_match = 1.0;
    } else {
      // Check if reference contains exact external ID as a distinct token
      const refTokens = tokenize(ref, false);
      const hasExactIdToken = refTokens.some(
        t => normalizeIdForMatch(t) === actIdNorm && actIdNorm.length >= 3
      );
      if (hasExactIdToken && isLikelyIdentifier(actExternalId)) {
        exact_id_match = 1.0;
      }
    }
  }

  // 8. Deterministic score gap from runner up [0, 1]
  const score_gap_from_second_candidate = Math.min(
    1.0,
    Math.max(0.0, Math.round(scoreGapFromSecondCandidate * 1000) / 1000)
  );

  return {
    name_similarity,
    description_similarity,
    location_exact_match,
    location_similarity,
    location_contradiction,
    wbs_match,
    exact_id_match,
    score_gap_from_second_candidate
  };
}

/**
 * Converts a MatchFeatureVector into a flat array adhering to MATCH_FEATURE_NAMES order.
 */
export function matchFeatureVectorToArray(vector: MatchFeatureVector): number[] {
  return [
    vector.name_similarity,
    vector.description_similarity,
    vector.location_exact_match,
    vector.location_similarity,
    vector.location_contradiction,
    vector.wbs_match,
    vector.exact_id_match,
    vector.score_gap_from_second_candidate
  ];
}
