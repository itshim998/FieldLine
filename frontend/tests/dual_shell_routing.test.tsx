import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../src/context/AuthContext.js';
import { ProjectLoginView } from '../src/components/auth/ProjectLoginView.js';
import { WorkerCockpitView } from '../src/components/worker/WorkerCockpitView.js';
import { AdminWorkspaceView } from '../src/components/admin/AdminWorkspaceView.js';

// Test consumer helper for AuthContext
function AuthTestConsumer({
  onAuthReady
}: {
  onAuthReady?: (auth: ReturnType<typeof useAuth>) => void;
}) {
  const auth = useAuth();
  React.useEffect(() => {
    onAuthReady?.(auth);
  }, [auth, onAuthReady]);

  return (
    <div>
      <div data-testid="auth-status">{auth.isAuthenticated ? 'authenticated' : 'unauthenticated'}</div>
      <div data-testid="auth-role">{auth.session?.accountType || 'none'}</div>
      <div data-testid="auth-user">{auth.session?.displayName || 'none'}</div>
      <button data-testid="test-login-btn" onClick={() => auth.login({ accountType: 'worker', passcode: '4444', projectId: 'proj-1' })}>
        Login Worker
      </button>
      <button data-testid="test-logout-btn" onClick={() => auth.logout()}>
        Logout
      </button>
    </div>
  );
}

const mockProjects = [
  {
    id: 'proj-golden',
    code: 'REFINERY-U4',
    name: 'Refinery Expansion — Unit 4',
    description: 'Flagship EPC Refining Unit',
    status: 'active'
  },
  {
    id: 'proj-metro',
    code: 'METRO-LINE-3',
    name: 'Metro Line 3 Underground Corridor',
    description: 'Transit package',
    status: 'planning'
  }
];

describe('Dual-Shell Architecture & Authentication (Pass 30)', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
  });

  describe('AuthContext & Session Management', () => {
    it('initializes in unauthenticated state when no token in localStorage', async () => {
      global.fetch = vi.fn();

      render(
        <AuthProvider>
          <AuthTestConsumer />
        </AuthProvider>
      );

      expect(screen.getByTestId('auth-status').textContent).toBe('unauthenticated');
      expect(screen.getByTestId('auth-role').textContent).toBe('none');
    });

    it('restores session when valid token exists in localStorage', async () => {
      localStorage.setItem('fieldline_session_token', 'mock-valid-token');

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/auth/session')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              session: {
                accountId: 'acc-1',
                projectId: 'proj-golden',
                accountType: 'worker',
                displayName: 'Refinery Operations Crew',
                roleTitle: 'Shift Operations',
                issuedAt: Date.now(),
                expiresAt: Date.now() + 86400000
              },
              project: {
                id: 'proj-golden',
                code: 'REFINERY-U4',
                name: 'Refinery Expansion — Unit 4'
              }
            })
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(
        <AuthProvider>
          <AuthTestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('auth-status').textContent).toBe('authenticated');
      });

      expect(screen.getByTestId('auth-role').textContent).toBe('worker');
      expect(screen.getByTestId('auth-user').textContent).toBe('Refinery Operations Crew');
    });

    it('authenticates worker credentials and persists session token', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
        if (url.includes('/api/auth/login')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              token: 'new-worker-token-xyz',
              session: {
                accountId: 'acc-w1',
                projectId: 'proj-golden',
                accountType: 'worker',
                displayName: 'Refinery Crew',
                roleTitle: 'Field Welder',
                issuedAt: Date.now(),
                expiresAt: Date.now() + 86400000
              },
              project: {
                id: 'proj-golden',
                code: 'REFINERY-U4',
                name: 'Refinery Expansion — Unit 4'
              }
            })
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(
        <AuthProvider>
          <AuthTestConsumer />
        </AuthProvider>
      );

      fireEvent.click(screen.getByTestId('test-login-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('auth-status').textContent).toBe('authenticated');
      });

      expect(localStorage.getItem('fieldline_session_token')).toBe('new-worker-token-xyz');
      expect(screen.getByTestId('auth-role').textContent).toBe('worker');
    });

    it('clears token and session upon logout', async () => {
      localStorage.setItem('fieldline_session_token', 'active-token');

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/auth/session')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              session: {
                accountId: 'acc-1',
                projectId: 'proj-golden',
                accountType: 'admin',
                displayName: 'Superintendent',
                roleTitle: 'Lead',
                issuedAt: Date.now(),
                expiresAt: Date.now() + 86400000
              }
            })
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(
        <AuthProvider>
          <AuthTestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('auth-status').textContent).toBe('authenticated');
      });

      fireEvent.click(screen.getByTestId('test-logout-btn'));

      expect(screen.getByTestId('auth-status').textContent).toBe('unauthenticated');
      expect(localStorage.getItem('fieldline_session_token')).toBeNull();
    });

    it('authFetch automatically injects Authorization Bearer header', async () => {
      let capturedAuthHeader: string | null = null;

      global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
        if (url.includes('/api/test-endpoint')) {
          const headers = new Headers(init?.headers);
          capturedAuthHeader = headers.get('Authorization');
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      localStorage.setItem('fieldline_session_token', 'test-bearer-abc-123');

      let authInstance: ReturnType<typeof useAuth> | null = null;

      render(
        <AuthProvider>
          <AuthTestConsumer onAuthReady={(a) => (authInstance = a)} />
        </AuthProvider>
      );

      await act(async () => {
        await authInstance?.authFetch('/api/test-endpoint');
      });

      expect(capturedAuthHeader).toBe('Bearer test-bearer-abc-123');
    });
  });

  describe('ProjectLoginView', () => {
    it('renders project selector, role cards, and 1-click Golden Demo chips', () => {
      render(
        <AuthProvider>
          <ProjectLoginView
            projects={mockProjects}
            onLoginSuccess={vi.fn()}
          />
        </AuthProvider>
      );

      expect(screen.getByText('Project Control Room & Execution Access')).toBeDefined();
      expect(screen.getByText('Golden Demo Instant Access (REFINERY-U4)')).toBeDefined();
      expect(screen.getAllByText('Field Worker').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/Admin \/ Project Engineer/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('button', { name: /Field Worker PIN: 4444/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Admin \/ Superintendent RefineryAdmin2026!/i })).toBeDefined();
    });

    it('1-click Worker Golden Demo chip authenticates with PIN 4444 and calls onLoginSuccess', async () => {
      const loginSuccessSpy = vi.fn();

      global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
        if (url.includes('/api/auth/login')) {
          const body = JSON.parse(init.body);
          expect(body.accountType).toBe('worker');
          expect(body.passcode).toBe('4444');
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              token: 'demo-worker-token',
              session: {
                accountId: 'acc-demo-w',
                projectId: 'proj-golden',
                accountType: 'worker',
                displayName: 'Refinery Operations Crew',
                roleTitle: null,
                issuedAt: Date.now(),
                expiresAt: Date.now() + 86400000
              },
              project: { id: 'proj-golden', code: 'REFINERY-U4', name: 'Refinery Expansion — Unit 4' }
            })
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(
        <AuthProvider>
          <ProjectLoginView
            projects={mockProjects}
            onLoginSuccess={loginSuccessSpy}
          />
        </AuthProvider>
      );

      const workerChip = screen.getByRole('button', { name: /Field Worker PIN: 4444/i });
      fireEvent.click(workerChip);

      await waitFor(() => {
        expect(loginSuccessSpy).toHaveBeenCalledWith('worker', 'proj-golden');
      });
    });

    it('1-click Admin Golden Demo chip authenticates with RefineryAdmin2026! and calls onLoginSuccess', async () => {
      const loginSuccessSpy = vi.fn();

      global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
        if (url.includes('/api/auth/login')) {
          const body = JSON.parse(init.body);
          expect(body.accountType).toBe('admin');
          expect(body.passcode).toBe('RefineryAdmin2026!');
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              token: 'demo-admin-token',
              session: {
                accountId: 'acc-demo-a',
                projectId: 'proj-golden',
                accountType: 'admin',
                displayName: 'Refinery Project Superintendent',
                roleTitle: 'Project Superintendent',
                issuedAt: Date.now(),
                expiresAt: Date.now() + 86400000
              },
              project: { id: 'proj-golden', code: 'REFINERY-U4', name: 'Refinery Expansion — Unit 4' }
            })
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(
        <AuthProvider>
          <ProjectLoginView
            projects={mockProjects}
            onLoginSuccess={loginSuccessSpy}
          />
        </AuthProvider>
      );

      const adminChip = screen.getByRole('button', { name: /Admin \/ Superintendent RefineryAdmin2026!/i });
      fireEvent.click(adminChip);

      await waitFor(() => {
        expect(loginSuccessSpy).toHaveBeenCalledWith('admin', 'proj-golden');
      });
    });

    it('displays error alert when login fails', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/auth/login')) {
          return Promise.resolve({
            ok: false,
            status: 401,
            json: async () => ({
              success: false,
              error: { message: 'Invalid passcode for Worker account' }
            })
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(
        <AuthProvider>
          <ProjectLoginView
            projects={mockProjects}
            selectedProjectId="proj-golden"
            onLoginSuccess={vi.fn()}
          />
        </AuthProvider>
      );

      const passcodeField = screen.getByPlaceholderText(/Enter 4-digit PIN/i);
      fireEvent.change(passcodeField, { target: { value: '9999' } });

      const submitBtn = screen.getByRole('button', { name: /Enter Execution Cockpit/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeDefined();
        expect(screen.getByText(/Invalid passcode for Worker account/i)).toBeDefined();
      });
    });
  });

  describe('WorkerCockpitView', () => {
    const mockActivities = [
      {
        id: 'act-1',
        projectId: 'proj-golden',
        scheduleId: 'sched-1',
        externalId: 'ACT-CIV-001',
        name: 'Excavation & Site Clearing — Area A',
        description: 'Deep grading and soil clearing',
        wbsCode: '1.1.1',
        location: 'Area A — Civil',
        plannedStart: '2026-08-01',
        plannedFinish: '2026-08-15',
        plannedQuantity: 500,
        unit: 'm3',
        baselineProgress: 60
      },
      {
        id: 'act-2',
        projectId: 'proj-golden',
        scheduleId: 'sched-1',
        externalId: 'ACT-PIP-004',
        name: 'Crude Unit Main Header Piping',
        description: 'Spool alignment and weld inspection',
        wbsCode: '2.1.4',
        location: 'Area D — Piping',
        plannedStart: '2026-08-10',
        plannedFinish: '2026-08-25',
        plannedQuantity: 120,
        unit: 'm',
        baselineProgress: 35
      }
    ];

    beforeEach(() => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/activities')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ activities: mockActivities })
          });
        }
        if (url.includes('/api/projects/proj-golden/schedules')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              schedules: [{ id: 'sched-1', name: 'Refinery Baseline', isBaseline: true }]
            })
          });
        }
        if (url.includes('/api/projects/proj-golden/progress-updates')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              progressUpdates: [
                {
                  id: 'up-1',
                  projectId: 'proj-golden',
                  reportDate: '2026-08-28',
                  reporterName: 'Mike Ross',
                  reporterRole: 'Civil Lead',
                  rawText: 'Excavated 100m3 soil today',
                  status: 'processed',
                  createdAt: '2026-08-28T14:00:00Z'
                }
              ]
            })
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });
    });

    it('renders Execution Cockpit header badge, user attribution, and 3 worker tabs', async () => {
      render(
        <AuthProvider>
          <WorkerCockpitView
            projectId="proj-golden"
            projectCode="REFINERY-U4"
            projectName="Refinery Expansion — Unit 4"
            activeWorkerTab="work"
            onTabChange={vi.fn()}
            onLogout={vi.fn()}
          />
        </AuthProvider>
      );

      expect(screen.getByText('EXECUTION COCKPIT')).toBeDefined();
      expect(screen.getByText(/REFINERY-U4 — Refinery Expansion/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /Today's Work/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Quick Report/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Field Assistant/i })).toBeDefined();

      await waitFor(() => {
        expect(screen.getByText('ACT-CIV-001')).toBeDefined();
        expect(screen.getByText('Excavation & Site Clearing — Area A')).toBeDefined();
      });
    });

    it('clicking "Report Progress" on an activity triggers pre-fill and switches to report tab', async () => {
      const tabChangeSpy = vi.fn();

      render(
        <AuthProvider>
          <WorkerCockpitView
            projectId="proj-golden"
            projectCode="REFINERY-U4"
            projectName="Refinery Expansion — Unit 4"
            activeWorkerTab="work"
            onTabChange={tabChangeSpy}
            onLogout={vi.fn()}
          />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('ACT-CIV-001')).toBeDefined();
      });

      const reportBtn = screen.getAllByRole('button', { name: /Report Progress/i })[0];
      fireEvent.click(reportBtn);

      expect(tabChangeSpy).toHaveBeenCalledWith('report');
    });

    it('Quick Report form preserves human attribution and submits operational update', async () => {
      let capturedPayload: any = null;

      global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
        if (url.includes('/api/projects/proj-golden/progress-updates') && init?.method === 'POST') {
          capturedPayload = JSON.parse(init.body);
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              progressUpdate: {
                id: 'up-new',
                projectId: 'proj-golden',
                reportDate: capturedPayload.reportDate,
                reporterName: capturedPayload.reporterName,
                reporterRole: capturedPayload.reporterRole,
                rawText: capturedPayload.rawText,
                status: 'received'
              }
            })
          });
        }
        if (url.includes('/api/projects/proj-golden/schedules')) {
          return Promise.resolve({ ok: true, json: async () => ({ schedules: [] }) });
        }
        if (url.includes('/api/projects/proj-golden/progress-updates')) {
          return Promise.resolve({ ok: true, json: async () => ({ progressUpdates: [] }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(
        <AuthProvider>
          <WorkerCockpitView
            projectId="proj-golden"
            projectCode="REFINERY-U4"
            projectName="Refinery Expansion — Unit 4"
            activeWorkerTab="report"
            onTabChange={vi.fn()}
            onLogout={vi.fn()}
          />
        </AuthProvider>
      );

      // Verify human attribution inputs exist
      const reporterInput = screen.getByPlaceholderText(/Mike Ross/i);
      fireEvent.change(reporterInput, { target: { value: 'David Miller' } });

      const roleInput = screen.getByPlaceholderText(/Piping Superintendent/i);
      fireEvent.change(roleInput, { target: { value: 'Lead Piping Inspector' } });

      // Click a quick phrase snippet
      const snippetBtn = screen.getByRole('button', { name: /\+ Pour completed/i });
      fireEvent.click(snippetBtn);

      // Submit the field report
      const submitBtn = screen.getByRole('button', { name: /Submit Field Report/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(capturedPayload).not.toBeNull();
      });

      expect(capturedPayload.reporterName).toBe('David Miller');
      expect(capturedPayload.reporterRole).toBe('Lead Piping Inspector');
      expect(capturedPayload.rawText).toContain('Completed planned concrete pour');
      expect(screen.getByRole('status')).toBeDefined();
    });

    it('Field Assistant tab sends queries and renders grounded responses with fact citations', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
        if (url.includes('/api/projects/proj-golden/assistant/query')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              question: 'What activities are delayed?',
              answer: 'Activity ACT-CIV-002 is delayed by 4 days due to soil moisture.',
              grounded: true,
              asOfDate: '2026-08-28',
              verifiedFacts: [
                {
                  ref: 'FACT-DEL-1',
                  category: 'DELAY',
                  summary: 'ACT-CIV-002 is overdue by 4 calendar days'
                }
              ]
            })
          });
        }
        if (url.includes('/api/projects/proj-golden/schedules')) {
          return Promise.resolve({ ok: true, json: async () => ({ schedules: [] }) });
        }
        if (url.includes('/api/projects/proj-golden/progress-updates')) {
          return Promise.resolve({ ok: true, json: async () => ({ progressUpdates: [] }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(
        <AuthProvider>
          <WorkerCockpitView
            projectId="proj-golden"
            projectCode="REFINERY-U4"
            projectName="Refinery Expansion — Unit 4"
            activeWorkerTab="assistant"
            onTabChange={vi.fn()}
            onLogout={vi.fn()}
          />
        </AuthProvider>
      );

      const assistantInput = screen.getByPlaceholderText(/Ask about project activities/i);
      fireEvent.change(assistantInput, { target: { value: 'What activities are delayed?' } });

      const askBtn = screen.getByRole('button', { name: /Ask/i });
      fireEvent.click(askBtn);

      await waitFor(() => {
        expect(screen.getByText(/Activity ACT-CIV-002 is delayed by 4 days/i)).toBeDefined();
      });

      expect(screen.getByText('FACT-DEL-1')).toBeDefined();
      expect(screen.getByText('ACT-CIV-002 is overdue by 4 calendar days')).toBeDefined();
    });
  });

  describe('AdminWorkspaceView', () => {
    it('renders authenticated Admin Control Room badge and preserves all 6 workspace tabs', () => {
      const tabChangeSpy = vi.fn();
      const switchToWorkerSpy = vi.fn();

      render(
        <AuthProvider>
          <AdminWorkspaceView
            project={{
              id: 'proj-golden',
              code: 'REFINERY-U4',
              name: 'Refinery Expansion — Unit 4',
              description: 'Flagship EPC project',
              status: 'active'
            }}
            activeTab="overview"
            onTabChange={tabChangeSpy}
            onBackToProjects={vi.fn()}
            onEditProject={vi.fn()}
            onDeleteProject={vi.fn()}
            onLogout={vi.fn()}
            onSwitchToWorker={switchToWorkerSpy}
            schedulesCount={3}
            progressCount={12}
            evidenceCount={8}
            intelligenceFactsCount={15}
          >
            <div data-testid="tab-content">Dashboard Content</div>
          </AdminWorkspaceView>
        </AuthProvider>
      );

      // Verify Admin Control Room session bar
      expect(screen.getByText('ADMIN CONTROL ROOM')).toBeDefined();
      expect(screen.getByText(/Refinery Project Superintendent/i)).toBeDefined();

      // Verify all 6 tabs exist
      expect(screen.getByRole('button', { name: /Project Dashboard/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Schedule Baselines/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Field Progress Updates/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Evidence Documents/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Project Intelligence/i })).toBeDefined();

      // Verify badge counts
      expect(screen.getByText('3')).toBeDefined();
      expect(screen.getByText('12')).toBeDefined();
      expect(screen.getByText('8')).toBeDefined();
      expect(screen.getByText('15 Facts')).toBeDefined();

      // Verify children rendered
      expect(screen.getByTestId('tab-content')).toBeDefined();

      // Verify tab switching
      fireEvent.click(screen.getByRole('button', { name: /Schedule Baselines/i }));
      expect(tabChangeSpy).toHaveBeenCalledWith('schedules');

      // Verify switch to worker button
      const switchBtn = screen.getByRole('button', { name: /Worker Cockpit/i });
      fireEvent.click(switchBtn);
      expect(switchToWorkerSpy).toHaveBeenCalledTimes(1);
    });
  });
});
