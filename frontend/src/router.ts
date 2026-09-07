export type WorkspaceTab =
  | 'overview'
  | 'schedules'
  | 'progress'
  | 'evidence'
  | 'intelligence'
  | 'activity-detail';

export type WorkerTab = 'work' | 'report' | 'assistant';
export type RouteRole = 'worker' | 'admin' | null;

export interface RouteState {
  projectId: string | null;
  tab: WorkspaceTab;
  activityId?: string | null;
  previousTab?: WorkspaceTab;
  authRole?: RouteRole;
  workerTab?: WorkerTab;
  isLogin?: boolean;
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

export function isValidWorkerTab(tab: string): tab is WorkerTab {
  return ['work', 'report', 'assistant'].includes(tab);
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
  const rawQueryWorkerTab = searchParams.get('workerTab');
  const queryWorkerTab =
    rawQueryWorkerTab && isValidWorkerTab(rawQueryWorkerTab) ? (rawQueryWorkerTab as WorkerTab) : null;
  const queryActivityId = searchParams.get('activityId') || searchParams.get('activity');
  const queryRole = searchParams.get('role');
  const authRole: RouteRole =
    queryRole === 'worker' || queryRole === 'admin' ? queryRole : null;

  const segments = targetPath.split('/').filter(Boolean);

  // Top-level /login route
  if (segments[0] === 'login') {
    return {
      projectId: queryProjectId || null,
      tab: 'overview',
      isLogin: true,
      activityId: null
    };
  }

  // Root path: "/"
  if (segments.length === 0) {
    if (queryProjectId) {
      if (authRole === 'worker') {
        return {
          projectId: queryProjectId,
          tab: 'overview',
          authRole: 'worker',
          workerTab: queryWorkerTab || 'work',
          activityId: null
        };
      }
      return {
        projectId: queryProjectId,
        tab: queryTab || (queryActivityId ? 'activity-detail' : 'overview'),
        activityId: queryActivityId || null,
        authRole: authRole || 'admin'
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

    // /projects/:projectId/login
    if (tabOrSub === 'login') {
      return {
        projectId,
        tab: 'overview',
        isLogin: true,
        activityId: null
      };
    }

    // /projects/:projectId/worker or /projects/:projectId/worker/:workerTab
    if (tabOrSub === 'worker') {
      const subWorkerTab = segments[3]?.toLowerCase();
      const workerTab: WorkerTab =
        subWorkerTab && isValidWorkerTab(subWorkerTab) ? (subWorkerTab as WorkerTab) : 'work';
      return {
        projectId,
        tab: 'overview',
        authRole: 'worker',
        workerTab: queryWorkerTab || workerTab,
        activityId: null
      };
    }

    // /projects/:projectId/admin or /projects/:projectId/admin/:tab
    if (tabOrSub === 'admin') {
      const subAdminTab = segments[3]?.toLowerCase();
      const adminTab: WorkspaceTab =
        subAdminTab && isValidTab(subAdminTab) ? (subAdminTab as WorkspaceTab) : 'overview';
      return {
        projectId,
        tab: adminTab,
        authRole: 'admin',
        activityId: null
      };
    }

    // /projects/:projectId/activities/:activityId or /projects/:projectId/activity/:activityId
    if (tabOrSub === 'activities' || tabOrSub === 'activity') {
      const activityId = segments[3] ? decodeURIComponent(segments[3]) : null;
      return {
        projectId,
        tab: 'activity-detail',
        activityId: activityId || queryActivityId || null,
        authRole: authRole || 'admin'
      };
    }

    // /projects/:projectId/:tab
    if (tabOrSub && isValidTab(tabOrSub)) {
      return {
        projectId,
        tab: tabOrSub,
        activityId: null,
        authRole: authRole || 'admin'
      };
    }

    if (queryActivityId) {
      return {
        projectId,
        tab: 'activity-detail',
        activityId: queryActivityId,
        authRole: authRole || 'admin'
      };
    }

    // Default project root: /projects/:projectId -> overview
    return {
      projectId,
      tab: queryTab || 'overview',
      activityId: null,
      authRole: authRole || (queryWorkerTab ? 'worker' : null)
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
  if (route.isLogin) {
    return route.projectId ? `/projects/${encodeURIComponent(route.projectId)}/login` : '/login';
  }

  if (!route.projectId) {
    return '/';
  }

  const encodedProj = encodeURIComponent(route.projectId);

  if (route.authRole === 'worker') {
    const workerTab = route.workerTab || 'work';
    return `/projects/${encodedProj}/worker/${workerTab}`;
  }

  if (route.tab === 'activity-detail' && route.activityId) {
    return `/projects/${encodedProj}/activities/${encodeURIComponent(route.activityId)}`;
  }

  if (route.tab === 'overview' || !route.tab) {
    return `/projects/${encodedProj}`;
  }

  return `/projects/${encodedProj}/${route.tab}`;
}

/**
 * Route protection helper that guards against unauthorized direct navigation.
 * - Workers cannot access admin tabs (overview, schedules, progress, evidence, intelligence, activity-detail).
 *   Redirects to the worker cockpit (`/projects/:projectId/worker/work`).
 */
export function protectRouteForRole(
  route: RouteState,
  sessionRole?: 'worker' | 'admin' | null
): RouteState {
  if (route.isLogin) {
    return route;
  }

  if (sessionRole === 'worker') {
    if (route.authRole !== 'worker') {
      return {
        ...route,
        authRole: 'worker',
        workerTab: route.workerTab || 'work',
        tab: 'overview',
        activityId: null
      };
    }
  }

  return route;
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
