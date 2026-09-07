import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkerCockpitView } from '../src/components/worker/WorkerCockpitView.js';
import { AuthProvider } from '../src/context/AuthContext.js';

describe('Pass 34 — Worker Cockpit Field Assistant & Query Suggestions Tests', () => {
  const projectId = 'proj-worker-456';
  const asOfDate = '2026-08-28';

  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    localStorage.clear();
    localStorage.setItem(
      'fieldline_session',
      JSON.stringify({
        token: 'mock-worker-session-token',
        projectId,
        accountType: 'worker',
        displayName: 'John Crane Operator',
        roleTitle: 'Rigging Crew Lead',
        expiresAt: Date.now() + 86400000
      })
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders quick operational query suggestions on the Field Assistant tab', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/schedules')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ schedules: [] })
        });
      }
      if (url.includes('/progress-updates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ progressUpdates: [] })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    }) as any;

    render(
      <AuthProvider>
        <WorkerCockpitView
          projectId={projectId}
          projectCode="REFINERY-U4"
          projectName="Refinery Unit 4 Expansion"
          asOfDate={asOfDate}
          activeWorkerTab="assistant"
          onTabChange={vi.fn()}
          onLogout={vi.fn()}
        />
      </AuthProvider>
    );

    expect(screen.getByText(/Operational Field Assistant/i)).toBeDefined();

    // Verify Pass 34 quick query suggestion chips
    expect(screen.getByText('"What are we doing in Area C?"')).toBeDefined();
    expect(screen.getByText('"Has piling cleared?"')).toBeDefined();
    expect(screen.getByText('"What is blocking crude pump?"')).toBeDefined();
  });

  it('clicking a suggested query populates input and dispatches assistant request with role: "worker"', async () => {
    let capturedBody: any = null;
    let capturedUrl: string = '';

    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/assistant/query')) {
        capturedUrl = url;
        capturedBody = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              question: capturedBody.question,
              intent: { intent: 'activity_status', activityQuery: 'crude pump', explicitDate: null },
              resolvedActivity: null,
              ambiguousCandidates: null,
              answer: 'Crude pump skids are currently blocked by crane availability in Area C.',
              claims: [],
              factRefs: [],
              grounded: true,
              status: 'success',
              asOfDate,
              verifiedFacts: []
            })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ schedules: [], progressUpdates: [] })
      });
    }) as any;

    render(
      <AuthProvider>
        <WorkerCockpitView
          projectId={projectId}
          projectCode="REFINERY-U4"
          projectName="Refinery Unit 4 Expansion"
          asOfDate={asOfDate}
          activeWorkerTab="assistant"
          onTabChange={vi.fn()}
          onLogout={vi.fn()}
        />
      </AuthProvider>
    );

    const crudePumpChip = screen.getByText('"What is blocking crude pump?"');
    fireEvent.click(crudePumpChip);

    await waitFor(() => {
      expect(capturedUrl).toContain(`/api/projects/${projectId}/assistant/query`);
    });

    expect(capturedBody).toBeDefined();
    expect(capturedBody.question).toBe('What is blocking crude pump?');
    expect(capturedBody.asOfDate).toBe(asOfDate);
    expect(capturedBody.role).toBe('worker');

    // Verify response answer is rendered
    await waitFor(() => {
      expect(screen.getByText(/Crude pump skids are currently blocked by crane availability/i)).toBeDefined();
    });
  });

  it('displays operational scope boundary gracefully when worker asks out-of-scope query', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/assistant/query')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              question: 'What is delayed across all 6 areas?',
              intent: { intent: 'delayed', activityQuery: null, explicitDate: null },
              resolvedActivity: null,
              ambiguousCandidates: null,
              answer:
                'This query requires project control room access. As a field worker, your scope is focused on active operational tasks, task progress, locations, and blockers for your work area.',
              claims: [],
              factRefs: [],
              grounded: true,
              status: 'scope_restricted',
              asOfDate,
              verifiedFacts: []
            })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ schedules: [], progressUpdates: [] })
      });
    }) as any;

    render(
      <AuthProvider>
        <WorkerCockpitView
          projectId={projectId}
          projectCode="REFINERY-U4"
          projectName="Refinery Unit 4 Expansion"
          asOfDate={asOfDate}
          activeWorkerTab="assistant"
          onTabChange={vi.fn()}
          onLogout={vi.fn()}
        />
      </AuthProvider>
    );

    const input = screen.getByPlaceholderText(/Ask about project activities/i);
    fireEvent.change(input, { target: { value: 'What is delayed across all 6 areas?' } });

    const askBtn = screen.getByRole('button', { name: /Ask/i });
    fireEvent.click(askBtn);

    await waitFor(() => {
      expect(screen.getByText(/This query requires project control room access./i)).toBeDefined();
    });
  });
});
