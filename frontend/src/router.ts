export type WorkspaceTab =
  | 'overview'
  | 'schedules'
  | 'progress'
  | 'evidence'
  | 'intelligence'
  | 'activity-detail';

export interface RouteState {
  projectId: string | null;
  tab: WorkspaceTab;
  activityId?: string | null;
  previousTab?: WorkspaceTab;
}

export function isValidTab(tab: string): tab is WorkspaceTab {
  return [
    'overview',
    'schedules',
    'progress',
    'evidence',
    'intelligence',
    'activity-detail'
  ].includes(tab);
}

/**
 * Parses the current browser URL (pathname, hash, search) into a structured RouteState.
 */
export function parseRoute(
  pathname: string = window.location.pathname,
  hash: string = window.location.hash,
  search: string = window.location.search
): RouteState {
  let targetPath = pathname;

  // Support hash routing fallback (#/projects/... or #projects/...)
  if (hash && hash.startsWith('#')) {
    const rawHash = hash.slice(1);
    if (rawHash.startsWith('/')) {
      targetPath = rawHash;
    }
  }

  // Parse query search parameters as fallback or overrides
  const searchParams = new URLSearchParams(search);
  const queryProjectId = searchParams.get('projectId') || searchParams.get('project');
  const rawQueryTab = searchParams.get('tab');
  const queryTab = rawQueryTab && isValidTab(rawQueryTab) ? (rawQueryTab as WorkspaceTab) : null;
  const queryActivityId = searchParams.get('activityId') || searchParams.get('activity');

  const segments = targetPath.split('/').filter(Boolean);

  // Root path: "/"
  if (segments.length === 0) {
    if (queryProjectId) {
      return {
        projectId: queryProjectId,
        tab: queryTab || (queryActivityId ? 'activity-detail' : 'overview'),
        activityId: queryActivityId || null
      };
    }
    return {
      projectId: null,
      tab: 'overview',
      activityId: null
    };
  }

  // Match /projects/:projectId/...
  if (segments[0] === 'projects' && segments[1]) {
    const projectId = decodeURIComponent(segments[1]);
    const tabOrSub = segments[2]?.toLowerCase();

    // /projects/:projectId/activities/:activityId or /projects/:projectId/activity/:activityId
    if (tabOrSub === 'activities' || tabOrSub === 'activity') {
      const activityId = segments[3] ? decodeURIComponent(segments[3]) : null;
      return {
        projectId,
        tab: 'activity-detail',
        activityId: activityId || queryActivityId || null
      };
    }

    // /projects/:projectId/:tab
    if (tabOrSub && isValidTab(tabOrSub)) {
      return {
        projectId,
        tab: tabOrSub,
        activityId: null
      };
    }

    if (queryActivityId) {
      return {
        projectId,
        tab: 'activity-detail',
        activityId: queryActivityId
      };
    }

    // Default project root: /projects/:projectId -> overview
    return {
      projectId,
      tab: queryTab || 'overview',
      activityId: null
    };
  }

  return {
    projectId: queryProjectId || null,
    tab: queryTab || 'overview',
    activityId: queryActivityId || null
  };
}

/**
 * Builds a clean canonical URL path for a RouteState.
 */
export function buildUrl(route: RouteState): string {
  if (!route.projectId) {
    return '/';
  }

  const encodedProj = encodeURIComponent(route.projectId);

  if (route.tab === 'activity-detail' && route.activityId) {
    return `/projects/${encodedProj}/activities/${encodeURIComponent(route.activityId)}`;
  }

  if (route.tab === 'overview' || !route.tab) {
    return `/projects/${encodedProj}`;
  }

  return `/projects/${encodedProj}/${route.tab}`;
}

/**
 * Pushes a new route onto the browser history stack.
 */
export function pushRoute(route: RouteState): void {
  const url = buildUrl(route);
  const currentUrl = window.location.pathname + window.location.search + window.location.hash;
  if (url !== currentUrl || JSON.stringify(window.history.state) !== JSON.stringify(route)) {
    window.history.pushState(route, '', url);
  }
}

/**
 * Replaces current route in the browser history stack.
 */
export function replaceRoute(route: RouteState): void {
  const url = buildUrl(route);
  window.history.replaceState(route, '', url);
}
