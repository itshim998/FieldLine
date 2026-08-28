import {
  ActivityRepository,
  activityRepository as defaultActivityRepo
} from '../../repositories/activity.repository.js';
import { Activity } from '../../models/domain.types.js';
import {
  ActivityResolutionResult,
  ResolvedActivityInfo
} from './assistant.types.js';

function mapToResolvedInfo(activity: Activity): ResolvedActivityInfo {
  return {
    id: activity.id,
    externalId: activity.externalId,
    name: activity.name,
    location: activity.location || null
  };
}

export function normalizeActivityText(str: string | null | undefined): string {
  return (str || '')
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

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
   * 4. Unique deterministic textual match (substring / containment)
   */
  resolve(projectId: string, query: string): ActivityResolutionResult {
    const rawQuery = (query || '').trim();
    if (!rawQuery) {
      return { status: 'not_found', activity: null, candidates: [] };
    }

    const normQuery = normalizeActivityText(rawQuery);
    if (!normQuery) {
      return { status: 'not_found', activity: null, candidates: [] };
    }

    // Strictly list activities belonging to the specified project only
    const activities = this.activityRepo.listByProjectId(projectId);
    if (activities.length === 0) {
      return { status: 'not_found', activity: null, candidates: [] };
    }

    // 1. Exact externalId match
    const externalIdMatches = activities.filter(
      (a) => normalizeActivityText(a.externalId) === normQuery
    );
    if (externalIdMatches.length === 1) {
      return {
        status: 'resolved',
        activity: mapToResolvedInfo(externalIdMatches[0]),
        candidates: []
      };
    }
    if (externalIdMatches.length > 1) {
      return {
        status: 'ambiguous',
        activity: null,
        candidates: externalIdMatches.map(mapToResolvedInfo)
      };
    }

    // 2. Exact case-insensitive normalized activity name match
    const nameMatches = activities.filter(
      (a) => normalizeActivityText(a.name) === normQuery
    );
    if (nameMatches.length === 1) {
      return {
        status: 'resolved',
        activity: mapToResolvedInfo(nameMatches[0]),
        candidates: []
      };
    }
    if (nameMatches.length > 1) {
      return {
        status: 'ambiguous',
        activity: null,
        candidates: nameMatches.map(mapToResolvedInfo)
      };
    }

    // 3. Exact normalized name + location match
    const nameLocationMatches = activities.filter((a) => {
      const nameAndLoc = normalizeActivityText(`${a.name} ${a.location || ''}`);
      const locAndName = normalizeActivityText(`${a.location || ''} ${a.name}`);
      return nameAndLoc === normQuery || locAndName === normQuery;
    });
    if (nameLocationMatches.length === 1) {
      return {
        status: 'resolved',
        activity: mapToResolvedInfo(nameLocationMatches[0]),
        candidates: []
      };
    }
    if (nameLocationMatches.length > 1) {
      return {
        status: 'ambiguous',
        activity: null,
        candidates: nameLocationMatches.map(mapToResolvedInfo)
      };
    }

    // 4. Unique deterministic textual substring / token match
    const textualMatches = activities.filter((a) => {
      const normName = normalizeActivityText(a.name);
      const normExtId = normalizeActivityText(a.externalId);
      const normLoc = normalizeActivityText(a.location);

      // Substring containment in either direction
      if (normName.includes(normQuery) || normQuery.includes(normName)) {
        return true;
      }
      if (normExtId.includes(normQuery) || normQuery.includes(normExtId)) {
        return true;
      }
      if (normLoc && (normLoc.includes(normQuery) || normQuery.includes(normLoc))) {
        return true;
      }

      // Check all query words contained in name + location
      const combined = `${normExtId} ${normName} ${normLoc}`.trim();
      const queryWords = normQuery.split(' ').filter((w) => w.length > 1);
      if (queryWords.length > 0 && queryWords.every((w) => combined.includes(w))) {
        return true;
      }

      return false;
    });

    if (textualMatches.length === 1) {
      return {
        status: 'resolved',
        activity: mapToResolvedInfo(textualMatches[0]),
        candidates: []
      };
    }
    if (textualMatches.length > 1) {
      return {
        status: 'ambiguous',
        activity: null,
        candidates: textualMatches.map(mapToResolvedInfo)
      };
    }

    return { status: 'not_found', activity: null, candidates: [] };
  }
}

export const deterministicActivityResolver = new DeterministicActivityResolver();
