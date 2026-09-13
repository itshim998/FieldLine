import {
  ActivityRepository,
  activityRepository as defaultActivityRepo
} from '../../repositories/activity.repository.js';
import { Activity } from '../../models/domain.types.js';
import {
  ActivityResolutionResult,
  ResolvedActivityInfo
} from './assistant.types.js';
import { MaybePromise } from '../../database/provider.js';

function mapToResolvedInfo(activity: Activity): ResolvedActivityInfo {
  return {
    id: activity.id,
    externalId: activity.externalId,
    name: activity.name,
    location: activity.location || null
  };
}

/**
 * Deduplicates activity candidates by canonical externalId so that multiple schedule
 * baselines, imports, or re-seeds never cause artificial ambiguity.
 */
function dedupeCandidates(candidates: ResolvedActivityInfo[]): ResolvedActivityInfo[] {
  const seen = new Set<string>();
  const deduped: ResolvedActivityInfo[] = [];
  for (const c of candidates) {
    if (!seen.has(c.externalId)) {
      seen.add(c.externalId);
      deduped.push(c);
    }
  }
  return deduped;
}

export function normalizeActivityText(str: string | null | undefined): string {
  return (str || '')
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Common English stop words for activity resolution token comparison.
 */
export const RESOLVER_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to',
  'was', 'were', 'will', 'with'
]);

/**
 * Deterministic lexical canonicalization map for construction and scheduling terminology.
 * Maps morphological variations (plurals, participles, gerunds, nominalizations) to a canonical lemma.
 */
export const CONSTRUCTION_LEXICAL_MAP: Record<string, string> = {
  // Piling / Piles
  pile: 'pile',
  piles: 'pile',
  piling: 'pile',
  pilings: 'pile',

  // Installation
  install: 'install',
  installs: 'install',
  installed: 'install',
  installing: 'install',
  installation: 'install',
  installations: 'install',

  // Erection
  erect: 'erect',
  erects: 'erect',
  erected: 'erect',
  erecting: 'erect',
  erection: 'erect',
  erections: 'erect',

  // Welding
  weld: 'weld',
  welds: 'weld',
  welded: 'weld',
  welding: 'weld',
  weldings: 'weld',

  // Excavation
  excavate: 'excavate',
  excavates: 'excavate',
  excavated: 'excavate',
  excavating: 'excavate',
  excavation: 'excavate',
  excavations: 'excavate',

  // Foundation
  foundation: 'foundation',
  foundations: 'foundation',

  // Construction
  construct: 'construct',
  constructs: 'construct',
  constructed: 'construct',
  constructing: 'construct',
  construction: 'construct',
  constructions: 'construct',

  // Completion
  complete: 'complete',
  completes: 'complete',
  completed: 'complete',
  completing: 'complete',
  completion: 'complete',
  completions: 'complete',

  // Inspection
  inspect: 'inspect',
  inspects: 'inspect',
  inspected: 'inspect',
  inspecting: 'inspect',
  inspection: 'inspect',
  inspections: 'inspect',

  // Pouring
  pour: 'pour',
  pours: 'pour',
  poured: 'pour',
  pouring: 'pour',

  // Reinforcement
  reinforce: 'reinforce',
  reinforces: 'reinforce',
  reinforced: 'reinforce',
  reinforcing: 'reinforce',
  reinforcement: 'reinforce',
  reinforcements: 'reinforce',

  // Structure
  structure: 'structure',
  structures: 'structure',
  structural: 'structure',

  // Pier
  pier: 'pier',
  piers: 'pier',

  // Grading
  grade: 'grade',
  grades: 'grade',
  graded: 'grade',
  grading: 'grade',

  // Terracing
  terrace: 'terrace',
  terraces: 'terrace',
  terraced: 'terrace',
  terracing: 'terrace',

  // Compaction
  compact: 'compact',
  compacts: 'compact',
  compacted: 'compact',
  compacting: 'compact',
  compaction: 'compact',

  // Clearing / Grubbing
  clear: 'clear',
  clears: 'clear',
  cleared: 'clear',
  clearing: 'clear',
  grub: 'grub',
  grubs: 'grub',
  grubbed: 'grub',
  grubbing: 'grub',

  // Spooling
  spool: 'spool',
  spools: 'spool',
  spooled: 'spool',
  spooling: 'spool',

  // Assembly
  assemble: 'assemble',
  assembles: 'assemble',
  assembled: 'assemble',
  assembling: 'assemble',
  assembly: 'assemble',
  assemblies: 'assemble',

  // Bolting
  bolt: 'bolt',
  bolts: 'bolt',
  bolted: 'bolt',
  bolting: 'bolt',

  // Splicing
  splice: 'splice',
  splices: 'splice',
  spliced: 'splice',
  splicing: 'splice',

  // Trenching
  trench: 'trench',
  trenches: 'trench',
  trenched: 'trench',
  trenching: 'trench',

  // Pulling
  pull: 'pull',
  pulls: 'pull',
  pulled: 'pull',
  pulling: 'pull',

  // Termination
  terminate: 'terminate',
  terminates: 'terminate',
  terminated: 'terminate',
  terminating: 'terminate',
  termination: 'terminate',
  terminations: 'terminate',

  // Testing
  test: 'test',
  tests: 'test',
  tested: 'test',
  testing: 'test',

  // Certification
  certify: 'certify',
  certifies: 'certify',
  certified: 'certify',
  certifying: 'certify',
  certification: 'certify',
  certifications: 'certify',

  // Verification
  verify: 'verify',
  verifies: 'verify',
  verified: 'verify',
  verifying: 'verify',
  verification: 'verify',
  verifications: 'verify',

  // Supporting
  support: 'support',
  supports: 'support',
  supported: 'support',
  supporting: 'support',

  // Distribution
  distribute: 'distribute',
  distributes: 'distribute',
  distributed: 'distribute',
  distributing: 'distribute',
  distribution: 'distribute',

  // Earthing
  earth: 'earth',
  earthing: 'earth',

  // Works / Work
  work: 'work',
  works: 'work',
  worked: 'work',
  working: 'work'
};

/**
 * Deterministically stems and canonicalizes a single token.
 * Identifiers containing digits or hyphens (e.g. 'ACT-B02', 'PR-07', 'WBS-02.02') are never modified.
 */
export function stemConstructionToken(rawToken: string): string {
  const token = (rawToken || '').trim().toLowerCase();
  if (!token) return '';

  // Preserve technical identifiers containing digits or hyphens
  if (/\d/.test(token) || token.includes('-')) {
    return token;
  }

  // Exact lookup in construction dictionary
  if (CONSTRUCTION_LEXICAL_MAP[token]) {
    return CONSTRUCTION_LEXICAL_MAP[token];
  }

  // Regular English plural stemming (length > 3, e.g. "pumps" -> "pump", "tanks" -> "tank", "roads" -> "road")
  // Avoid words ending in "ss" (e.g. "process", "grass")
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    const withoutS = token.slice(0, -1);
    if (CONSTRUCTION_LEXICAL_MAP[withoutS]) {
      return CONSTRUCTION_LEXICAL_MAP[withoutS];
    }
    return withoutS;
  }

  return token;
}

export const normalizeConstructionWord = stemConstructionToken;

export class DeterministicActivityResolver {
  private activityRepo: ActivityRepository;

  constructor(activityRepo: ActivityRepository = defaultActivityRepo) {
    this.activityRepo = activityRepo;
  }

  /**
   * Deterministically resolves an activity query string within a specific project.
   * Cross-project resolution is strictly forbidden.
   *
   * Precedence:
   * 1. Exact externalId (case-insensitive normalized)
   * 2. Exact activity name (case-insensitive normalized)
   * 3. Exact name + location (case-insensitive normalized)
   * 4. Unique deterministic textual & morphological match
   */
  resolve(projectId: string, query: string): MaybePromise<ActivityResolutionResult> {
    const rawQuery = (query || '').trim();
    if (!rawQuery) {
      return { status: 'not_found', activity: null, candidates: [] };
    }

    const normQuery = normalizeActivityText(rawQuery);
    if (!normQuery) {
      return { status: 'not_found', activity: null, candidates: [] };
    }

    // Strictly list activities belonging to the specified project only
    const rawActivities = this.activityRepo.listByProjectId(projectId);
    if (rawActivities instanceof Promise) {
      return rawActivities.then((activities) =>
        this.resolveWithActivities(activities, normQuery, rawQuery)
      );
    }
    return this.resolveWithActivities(rawActivities, normQuery, rawQuery);
  }

  private resolveWithActivities(
    rawActivities: Activity[],
    normQuery: string,
    rawQuery: string
  ): ActivityResolutionResult {
    if (rawActivities.length === 0) {
      return { status: 'not_found', activity: null, candidates: [] };
    }

    // Deduplicate activities by externalId so multiple schedule baselines/imports
    // never create duplicate entries of the same canonical activity.
    const activitiesMap = new Map<string, Activity>();
    for (const a of rawActivities) {
      if (!activitiesMap.has(a.externalId)) {
        activitiesMap.set(a.externalId, a);
      }
    }
    const activities = Array.from(activitiesMap.values());

    // 1. Exact externalId match
    const externalIdMatches = activities.filter(
      (a) => normalizeActivityText(a.externalId) === normQuery
    );
    const dedupedExt = dedupeCandidates(externalIdMatches.map(mapToResolvedInfo));
    if (dedupedExt.length === 1) {
      return {
        status: 'resolved',
        activity: dedupedExt[0],
        candidates: []
      };
    }
    if (dedupedExt.length > 1) {
      return {
        status: 'ambiguous',
        activity: null,
        candidates: dedupedExt
      };
    }

    // 2. Exact case-insensitive normalized activity name match
    const nameMatches = activities.filter(
      (a) => normalizeActivityText(a.name) === normQuery
    );
    const dedupedName = dedupeCandidates(nameMatches.map(mapToResolvedInfo));
    if (dedupedName.length === 1) {
      return {
        status: 'resolved',
        activity: dedupedName[0],
        candidates: []
      };
    }
    if (dedupedName.length > 1) {
      return {
        status: 'ambiguous',
        activity: null,
        candidates: dedupedName
      };
    }

    // 3. Exact normalized name + location match
    const nameLocationMatches = activities.filter((a) => {
      const nameAndLoc = normalizeActivityText(`${a.name} ${a.location || ''}`);
      const locAndName = normalizeActivityText(`${a.location || ''} ${a.name}`);
      return nameAndLoc === normQuery || locAndName === normQuery;
    });
    const dedupedNameLoc = dedupeCandidates(nameLocationMatches.map(mapToResolvedInfo));
    if (dedupedNameLoc.length === 1) {
      return {
        status: 'resolved',
        activity: dedupedNameLoc[0],
        candidates: []
      };
    }
    if (dedupedNameLoc.length > 1) {
      return {
        status: 'ambiguous',
        activity: null,
        candidates: dedupedNameLoc
      };
    }

    // 4. Unique deterministic textual & morphology-aware match
    // 4a. Exact contiguous substring containment on name or externalId (e.g. "PR-07" in "Pipe Rack PR-07 Structural Steel Erection")
    const substringMatches = activities.filter((a) => {
      const normName = normalizeActivityText(a.name);
      const normExtId = normalizeActivityText(a.externalId);

      if (normName.includes(normQuery) || (normQuery.length >= normName.length && normQuery.includes(normName))) {
        return true;
      }
      if (normExtId.includes(normQuery) || (normQuery.length >= normExtId.length && normQuery.includes(normExtId))) {
        return true;
      }
      return false;
    });

    const dedupedSub = dedupeCandidates(substringMatches.map(mapToResolvedInfo));
    if (dedupedSub.length === 1) {
      return {
        status: 'resolved',
        activity: dedupedSub[0],
        candidates: []
      };
    }
    if (dedupedSub.length > 1) {
      return {
        status: 'ambiguous',
        activity: null,
        candidates: dedupedSub
      };
    }

    // 4b. Morphology-aware token & location resolution
    const queryRawTokens = normQuery.split(' ').filter((t) => t.length > 0);
    const queryStemmed = queryRawTokens.map(stemConstructionToken);
    const contentQueryTokens = queryStemmed.filter(
      (t) => !RESOLVER_STOP_WORDS.has(t) && !/^\d+$/.test(t)
    );

    if (contentQueryTokens.length === 0) {
      return { status: 'not_found', activity: null, candidates: [] };
    }

    const queryWantsInspection = /(inspection|sign\s*off|signoff|acceptance|milestone)/i.test(rawQuery);

    // Identify if the query explicitly mentions a project location
    const distinctLocations = Array.from(
      new Set(
        activities
          .map((a) => a.location ? normalizeActivityText(a.location) : '')
          .filter((loc) => loc.length > 0)
      )
    );
    const mentionedLocation = distinctLocations.find((loc) => normQuery.includes(loc)) || null;

    // Helper to extract canonical tokens for an activity
    const buildActivityMetadata = (a: Activity) => {
      const normName = normalizeActivityText(a.name);
      const nameTokens = normName.split(' ').filter((t) => t.length > 0);
      const nameStemmed = nameTokens.map(stemConstructionToken);
      const distinctiveNameTokens = nameStemmed.filter(
        (t) => !RESOLVER_STOP_WORDS.has(t) && t !== 'work' && t !== 'works'
      );

      const normExtId = normalizeActivityText(a.externalId);
      const extIdTokens = normExtId.split(' ').filter((t) => t.length > 0);
      const extIdStemmed = extIdTokens.map(stemConstructionToken);

      const normLoc = a.location ? normalizeActivityText(a.location) : '';
      const locTokens = normLoc ? normLoc.split(' ').filter((t) => t.length > 0) : [];
      const locStemmed = locTokens.map(stemConstructionToken);

      const allTokensSet = new Set<string>([
        ...extIdTokens,
        ...extIdStemmed,
        ...nameTokens,
        ...nameStemmed,
        ...locTokens,
        ...locStemmed,
        normExtId,
        a.externalId.toLowerCase()
      ]);

      const isInspectionMilestone = /(inspection|sign\s*off|signoff|acceptance|milestone)/i.test(a.name);
      const locationMatches = normLoc ? normQuery.includes(normLoc) : false;

      return {
        activity: a,
        normName,
        nameStemmed,
        distinctiveNameTokens,
        allTokensSet,
        isInspectionMilestone,
        normLoc,
        locationMatches
      };
    };

    const activitiesMeta = activities.map(buildActivityMetadata);

    // --- Strategy 1: Query token containment in activity (Query in Activity) ---
    // All content query tokens are matched by the activity tokens.
    // e.g. "Pump foundation piles" -> ['pump', 'foundation', 'pile'] are all present in ACT-B02
    let ruleACandidates = activitiesMeta.filter((meta) => {
      // If query mentions a specific location, filter out activities in different locations
      if (mentionedLocation && meta.normLoc && meta.normLoc !== mentionedLocation) {
        return false;
      }

      // Check if all content query tokens are contained in the activity's token set
      const allMatched = contentQueryTokens.every((token) => meta.allTokensSet.has(token));
      return allMatched;
    });

    // If both physical work and inspection sign-off match (e.g. "Foundation piling Area B"),
    // prefer the actual physical work activity when inspection/sign-off is not specifically queried.
    if (!queryWantsInspection && ruleACandidates.length > 1) {
      const nonMilestone = ruleACandidates.filter((c) => !c.isInspectionMilestone);
      if (nonMilestone.length > 0) {
        ruleACandidates = nonMilestone;
      }
    }

    const dedupedRuleA = dedupeCandidates(ruleACandidates.map((c) => mapToResolvedInfo(c.activity)));
    if (dedupedRuleA.length === 1) {
      return {
        status: 'resolved',
        activity: dedupedRuleA[0],
        candidates: []
      };
    }
    if (dedupedRuleA.length > 1) {
      return {
        status: 'ambiguous',
        activity: null,
        candidates: dedupedRuleA
      };
    }

    // --- Strategy 2: Distinctive activity tokens contained in query (Activity in Query) ---
    // For full natural language queries containing extra operational/progress details
    // e.g. "Pump foundation piles completed to 65% at Area B crude pump bay."
    let ruleBCandidates = activitiesMeta.filter((meta) => {
      if (mentionedLocation && meta.normLoc && meta.normLoc !== mentionedLocation) {
        return false;
      }

      if (meta.distinctiveNameTokens.length === 0) return false;

      // Count how many distinctive activity name tokens are in the query
      const matchedCount = meta.distinctiveNameTokens.filter((t) => queryStemmed.includes(t)).length;
      const coverage = matchedCount / meta.distinctiveNameTokens.length;

      // Require full coverage or high coverage (>= 75% and at least 3 distinctive tokens)
      const satisfiesDistinctive =
        (meta.distinctiveNameTokens.length >= 2 && matchedCount === meta.distinctiveNameTokens.length) ||
        (matchedCount >= 3 && coverage >= 0.75);

      return satisfiesDistinctive;
    });

    if (!queryWantsInspection && ruleBCandidates.length > 1) {
      const nonMilestone = ruleBCandidates.filter((c) => !c.isInspectionMilestone);
      if (nonMilestone.length > 0) {
        ruleBCandidates = nonMilestone;
      }
    }

    const dedupedRuleB = dedupeCandidates(ruleBCandidates.map((c) => mapToResolvedInfo(c.activity)));
    if (dedupedRuleB.length === 1) {
      return {
        status: 'resolved',
        activity: dedupedRuleB[0],
        candidates: []
      };
    }
    if (dedupedRuleB.length > 1) {
      return {
        status: 'ambiguous',
        activity: null,
        candidates: dedupedRuleB
      };
    }

    return { status: 'not_found', activity: null, candidates: [] };
  }
}

export const deterministicActivityResolver = new DeterministicActivityResolver();
