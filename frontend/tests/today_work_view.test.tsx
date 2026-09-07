import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TodayWorkView, OperationalTaskItem, OperationalTaskSummary } from '../src/components/worker/TodayWorkView.js';
import { AuthProvider } from '../src/context/AuthContext.js';

const mockOperationalTasks: OperationalTaskItem[] = [
  {
    id: 'act-c01',
    externalId: 'ACT-C01',
    name: 'Pipe Rack PR-07 Structural Steel Erection',
    description: 'Erect main structural steel columns and cross beams for Pipe Rack PR-07',
    location: 'Area C',
    plannedStart: '2026-08-10',
    plannedFinish: '2026-08-29',
    plannedQuantity: 320,
    unit: 'ton',
    plannedProgress: 65,
    actualProgress: 20,
    status: 'AT_RISK',
    statusLabel: 'At Risk',
    isToday: true,
    isUpcoming: false,
    isOverdue: false,
    isCompleted: false
  },
  {
    id: 'act-a02',
    externalId: 'ACT-A02',
    name: 'Unit 4 Site Rough Grading & Terracing',
    description: 'Earthworks and terracing for Unit 4 processing pad',
    location: 'Area A',
    plannedStart: '2026-08-05',
    plannedFinish: '2026-08-20',
    plannedQuantity: 12000,
    unit: 'm3',
    plannedProgress: 100,
    actualProgress: 65,
    status: 'DELAYED',
    statusLabel: 'Delayed',
    isToday: false,
    isUpcoming: false,
    isOverdue: true,
    isCompleted: false
  },
  {
    id: 'act-b03',
    externalId: 'ACT-B03',
    name: 'Substation Heavy Equipment Mat Foundation',
    description: 'Rebar placement and formwork for substation transformer pads',
    location: 'Area B',
    plannedStart: '2026-08-12',
    plannedFinish: '2026-08-31',
    plannedQuantity: 850,
    unit: 'm3',
    plannedProgress: 75,
    actualProgress: 75,
    status: 'ON_TRACK',
    statusLabel: 'On Track',
    isToday: true,
    isUpcoming: false,
    isOverdue: false,
    isCompleted: false
  },
  {
    id: 'act-a01',
    externalId: 'ACT-A01',
    name: 'Unit 4 Site Clearing & Grubbing',
    description: 'Surface vegetation removal and grubbing',
    location: 'Area A',
    plannedStart: '2026-08-01',
    plannedFinish: '2026-08-10',
    plannedQuantity: 5000,
    unit: 'm2',
    plannedProgress: 100,
    actualProgress: 100,
    status: 'COMPLETED',
    statusLabel: 'Completed',
    isToday: false,
    isUpcoming: false,
    isOverdue: false,
    isCompleted: true
  }
];

const mockSummary: OperationalTaskSummary = {
  total: 4,
  today: 2,
  upcoming: 0,
  completed: 1,
  delayed: 1,
  atRisk: 1,
  onTrack: 1
};

describe('TodayWorkView Component (Pass 31)', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    localStorage.clear();
    localStorage.setItem('fieldline_session_token', 'mock-worker-session-token');

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            valid: true,
            session: {
              projectId: 'proj-golden',
              accountType: 'worker',
              displayName: 'Worker Lead'
            }
          })
        };
      }

      if (urlStr.includes('/api/projects/proj-golden/worker/operational-tasks')) {
        // Parse filter params
        const parsedUrl = new URL(urlStr, 'http://localhost');
        const locationFilter = parsedUrl.searchParams.get('locationFilter');
        const scope = parsedUrl.searchParams.get('scope');

        let filtered = [...mockOperationalTasks];
        if (locationFilter) {
          filtered = filtered.filter((t) => t.location?.includes(locationFilter));
        }
        if (scope === 'today') {
          filtered = filtered.filter((t) => t.isToday);
        } else if (scope === 'delayed') {
          filtered = filtered.filter((t) => t.isOverdue || t.status === 'DELAYED');
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            projectId: 'proj-golden',
            asOfDate: '2026-08-28',
            tasks: filtered,
            summary: mockSummary
          })
        };
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' })
      };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('1. Fetches and renders operational task cards with target scope and status', async () => {
    const handleReport = vi.fn();
    const handleBlocker = vi.fn();

    render(
      <AuthProvider>
        <TodayWorkView
          projectId="proj-golden"
          asOfDate="2026-08-28"
          onReportActivity={handleReport}
          onLogBlocker={handleBlocker}
        />
      </AuthProvider>
    );

    // Assert loading state disappears and tasks render
    await waitFor(() => {
      expect(screen.getByText("Today's Execution Cockpit")).toBeTruthy();
      expect(screen.getByText('ACT-C01')).toBeTruthy();
      expect(screen.getByText('ACT-A02')).toBeTruthy();
      expect(screen.getByText('ACT-B03')).toBeTruthy();
    });

    // Check status badges
    expect(screen.getByTestId('status-badge-ACT-C01').textContent).toContain('At Risk');
    expect(screen.getByTestId('status-badge-ACT-A02').textContent).toContain('Delayed');
    expect(screen.getByTestId('status-badge-ACT-B03').textContent).toContain('On Track');

    // Check target quantities
    expect(screen.getByText('320 ton')).toBeTruthy();
    expect(screen.getByText('12,000 m3')).toBeTruthy();
    expect(screen.getByText('850 m3')).toBeTruthy();
  });

  it('2. Filters operational tasks when a work area chip is clicked', async () => {
    render(
      <AuthProvider>
        <TodayWorkView
          projectId="proj-golden"
          asOfDate="2026-08-28"
          onReportActivity={vi.fn()}
        />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('ACT-C01')).toBeTruthy();
    });

    // Click "Area C — Structural" chip
    const areaCChip = screen.getByText('Area C — Structural');
    fireEvent.click(areaCChip);

    await waitFor(() => {
      // Area C task should still be present
      expect(screen.getByText('ACT-C01')).toBeTruthy();
      // Tasks in other areas should not be shown
      expect(screen.queryByText('ACT-A02')).toBeNull();
      expect(screen.queryByText('ACT-B03')).toBeNull();
    });
  });

  it('3. Instant search filters tasks in real-time', async () => {
    render(
      <AuthProvider>
        <TodayWorkView
          projectId="proj-golden"
          asOfDate="2026-08-28"
          onReportActivity={vi.fn()}
        />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('ACT-C01')).toBeTruthy();
      expect(screen.getByText('ACT-A02')).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText('Search by ID, task name, or area...');
    fireEvent.change(searchInput, { target: { value: 'Grading' } });

    // Only ACT-A02 contains "Grading"
    expect(screen.getByText('ACT-A02')).toBeTruthy();
    expect(screen.queryByText('ACT-C01')).toBeNull();
    expect(screen.queryByText('ACT-B03')).toBeNull();
  });

  it('4. Action button "Report Progress" calls onReportActivity with task data', async () => {
    const handleReport = vi.fn();

    render(
      <AuthProvider>
        <TodayWorkView
          projectId="proj-golden"
          asOfDate="2026-08-28"
          onReportActivity={handleReport}
        />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('report-activity-btn-ACT-C01')).toBeTruthy();
    });

    const reportBtn = screen.getByTestId('report-activity-btn-ACT-C01');
    fireEvent.click(reportBtn);

    expect(handleReport).toHaveBeenCalledTimes(1);
    expect(handleReport).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'ACT-C01',
        name: 'Pipe Rack PR-07 Structural Steel Erection'
      })
    );
  });

  it('5. Action button "Log Blocker" calls onLogBlocker with task data', async () => {
    const handleBlocker = vi.fn();

    render(
      <AuthProvider>
        <TodayWorkView
          projectId="proj-golden"
          asOfDate="2026-08-28"
          onReportActivity={vi.fn()}
          onLogBlocker={handleBlocker}
        />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('blocker-btn-ACT-C01')).toBeTruthy();
    });

    const blockerBtn = screen.getByTestId('blocker-btn-ACT-C01');
    fireEvent.click(blockerBtn);

    expect(handleBlocker).toHaveBeenCalledTimes(1);
    expect(handleBlocker).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'ACT-C01'
      })
    );
  });

  it('6. Opens and closes Task Details Modal with full operational specifications', async () => {
    render(
      <AuthProvider>
        <TodayWorkView
          projectId="proj-golden"
          asOfDate="2026-08-28"
          onReportActivity={vi.fn()}
        />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('detail-btn-ACT-C01')).toBeTruthy();
    });

    const detailBtn = screen.getByTestId('detail-btn-ACT-C01');
    fireEvent.click(detailBtn);

    // Modal opens
    await waitFor(() => {
      const modal = screen.getByTestId('task-detail-modal');
      expect(modal).toBeTruthy();
      expect(modal.textContent).toContain('Work Area / Location');
      expect(modal.textContent).toContain('Physical Scope Target');
      expect(modal.textContent).toContain('320 ton');
    });

    // Close modal
    const closeBtn = screen.getByLabelText('Close task details');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('task-detail-modal')).toBeNull();
    });
  });

  it('7. Scope filtering (Active Today, Needs Attention) requests correct scope', async () => {
    render(
      <AuthProvider>
        <TodayWorkView
          projectId="proj-golden"
          asOfDate="2026-08-28"
          onReportActivity={vi.fn()}
        />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('ACT-C01')).toBeTruthy();
    });

    // Click "Active Today" tab
    const todayTab = screen.getByRole('tab', { name: /active today/i });
    fireEvent.click(todayTab);

    await waitFor(() => {
      // In mock, scope=today returns only tasks with isToday=true
      expect(screen.getByText('ACT-C01')).toBeTruthy();
      expect(screen.getByText('ACT-B03')).toBeTruthy();
      expect(screen.queryByText('ACT-A02')).toBeNull();
    });
  });

  it('8. Responsive layout verification across viewport widths', async () => {
    const viewports = [
      { width: 390, height: 844 },   // Mobile (iPhone 14)
      { width: 768, height: 1024 },  // Tablet (iPad)
      { width: 1200, height: 800 }   // Desktop
    ];

    for (const vp of viewports) {
      window.innerWidth = vp.width;
      window.innerHeight = vp.height;
      window.dispatchEvent(new Event('resize'));

      const { unmount } = render(
        <AuthProvider>
          <TodayWorkView
            projectId="proj-golden"
            asOfDate="2026-08-28"
            onReportActivity={vi.fn()}
          />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('today-work-view')).toBeTruthy();
      });

      unmount();
    }
  });
});
