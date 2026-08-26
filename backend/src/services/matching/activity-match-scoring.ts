import { Activity, MatchMethod } from '../../models/domain.types.js';
import { FieldProgressItem } from '../../ai/contracts/field-progress-extraction.contract.js';
import { CandidateMatch } from './activity-matching.types.js';
import { computeTextSimilarity, tokenize } from './text-similarity.js';

export interface ScoreDetail {
  candidate: CandidateMatch;
  rawScore: number;
}

/**
 * Normalizes identifier for exact comparison.
 */
function normalizeIdForMatch(id: string): string {
  return id.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Checks if a string looks like an external ID format (e.g., ACT-101, A100, WBS-1.2, #101).
 */
export function isLikelyIdentifier(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 30) return false;
  // Common activity code patterns: alphanumeric with hyphens, underscores, dots, slashes
  return /^[a-zA-Z0-9]+([-_/.][a-zA-Z0-9]+)*$/.test(trimmed) && !trimmed.includes(' ');
}

/**
 * Evaluates whether two location descriptions align or contradict.
 */
function evaluateLocationMatch(
  factLoc: string,
  actLoc: string
): { modifier: number; matched: boolean; rationale: string } {
  const fNorm = factLoc.trim().toLowerCase();
  const aNorm = actLoc.trim().toLowerCase();

  if (fNorm === aNorm) {
    return {
      modifier: 0.18,
      matched: true,
      rationale: `Location '${actLoc}' aligns with reported location '${factLoc}'.`
    };
  }

  // If one contains the other (e.g. "Block B" in "Block B East")
  if (fNorm.includes(aNorm) || aNorm.includes(fNorm)) {
    return {
      modifier: 0.15,
      matched: true,
      rationale: `Location '${actLoc}' aligns with reported location '${factLoc}'.`
    };
  }

  const locSim = computeTextSimilarity(factLoc, actLoc);
  if (locSim >= 0.75) {
    return {
      modifier: 0.15,
      matched: true,
      rationale: `Location '${actLoc}' aligns with reported location '${factLoc}'.`
    };
  }

  // Explicit location mismatch/contradiction
  return {
    modifier: -0.25,
    matched: false,
    rationale: `Location mismatch: reported '${factLoc}', activity specifies '${actLoc}'.`
  };
}

/**
 * Scores a candidate activity against a structured field progress item.
 */
export function scoreActivityCandidate(
  fact: FieldProgressItem,
  activity: Activity
): CandidateMatch {
  const ref = fact.reference.trim();
  const refNorm = ref.toLowerCase();
  const actExternalIdNorm = normalizeIdForMatch(activity.externalId);
  const refIdNorm = normalizeIdForMatch(ref);

  // 1. Layer 1 — Exact Activity / External ID
  if (refIdNorm === actExternalIdNorm) {
    return {
      activityId: activity.id,
      activityExternalId: activity.externalId,
      activityName: activity.name,
      confidenceScore: 0.99,
      matchMethod: 'exact_id',
      matchedText: activity.externalId,
      rationale: `Exact match with activity external ID '${activity.externalId}'.`
    };
  }

  // Also check if reference is like "ACT-101: Foundation" or contains exact ID as a distinct token
  const refTokens = tokenize(ref, false);
  const hasExactIdToken = refTokens.some(
    t => normalizeIdForMatch(t) === actExternalIdNorm && actExternalIdNorm.length >= 3
  );
  if (hasExactIdToken && isLikelyIdentifier(activity.externalId)) {
    return {
      activityId: activity.id,
      activityExternalId: activity.externalId,
      activityName: activity.name,
      confidenceScore: 0.95,
      matchMethod: 'exact_id',
      matchedText: activity.externalId,
      rationale: `Reference explicitly contains activity external ID '${activity.externalId}'.`
    };
  }

  // 2. Layer 2 — Deterministic Text Similarity
  const nameSim = computeTextSimilarity(ref, activity.name);
  let descSim = 0;
  if (activity.description) {
    descSim = computeTextSimilarity(ref, activity.description);
  }

  // Base text score: primary weight on name, description as fallback/blend
  let textSim = nameSim;
  let matchedSnippet = activity.name;
  if (descSim > nameSim && descSim > 0.4) {
    textSim = Math.max(nameSim, descSim * 0.85);
    matchedSnippet = activity.description || activity.name;
  }

  // Scale base text score: strong text match scores 0.75-0.88 on its own, allowing location/wbs to adjust
  let textScore = textSim >= 0.85 ? Math.min(0.88, Math.max(0.75, textSim * 0.88)) : textSim * 0.78;

  const rationaleParts: string[] = [];
  let matchMethod: MatchMethod = 'text_similarity';

  if (nameSim >= 0.85) {
    rationaleParts.push(`Reference strongly matches activity name '${activity.name}' (text similarity: ${(nameSim * 100).toFixed(0)}%)`);
  } else if (nameSim >= 0.5) {
    rationaleParts.push(`Reference partially matches activity name '${activity.name}' (text similarity: ${(nameSim * 100).toFixed(0)}%)`);
  } else if (descSim >= 0.6) {
    rationaleParts.push(`Reference matches activity description (similarity: ${(descSim * 100).toFixed(0)}%)`);
  } else {
    rationaleParts.push(`Low text match with activity name '${activity.name}' (text similarity: ${(nameSim * 100).toFixed(0)}%)`);
  }

  // 3. Layer 3 — Location and WBS Metadata Signals
  let locationModifier = 0.0;
  let locationMatched = false;

  if (fact.location && fact.location.trim().length > 0) {
    const factLoc = fact.location.trim();
    if (activity.location && activity.location.trim().length > 0) {
      const actLoc = activity.location.trim();
      const locEval = evaluateLocationMatch(factLoc, actLoc);
      locationModifier += locEval.modifier;
      locationMatched = locEval.matched;
      rationaleParts.push(locEval.rationale);
    } else {
      // Activity has no location field, but check if activity name explicitly mentions the location
      const nameContainsLoc = activity.name.toLowerCase().includes(factLoc.toLowerCase());
      if (nameContainsLoc) {
        locationModifier += 0.12;
        locationMatched = true;
        rationaleParts.push(`Reported location '${factLoc}' found in activity name.`);
      }
    }
  }

  // WBS Signal
  let wbsModifier = 0.0;
  if (activity.wbsCode && activity.wbsCode.trim().length > 0) {
    const wbsNorm = activity.wbsCode.trim().toLowerCase();
    if (refNorm.includes(wbsNorm) || (fact.location && fact.location.toLowerCase().includes(wbsNorm))) {
      wbsModifier += 0.12;
      rationaleParts.push(`WBS code '${activity.wbsCode}' detected in field reference.`);
    }
  }

  if (locationMatched && locationModifier > 0) {
    matchMethod = 'wbs_location';
  }

  // Final combined score calculation (clamped between 0.0 and 1.0)
  let finalScore = textScore + locationModifier + wbsModifier;
  finalScore = Math.min(1.0, Math.max(0.0, Math.round(finalScore * 100) / 100));

  return {
    activityId: activity.id,
    activityExternalId: activity.externalId,
    activityName: activity.name,
    confidenceScore: finalScore,
    matchMethod,
    matchedText: matchedSnippet,
    rationale: rationaleParts.join('; ') + '.'
  };
}
