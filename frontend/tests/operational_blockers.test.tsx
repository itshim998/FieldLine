import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BlockerModal } from '../src/components/worker/BlockerModal.js';
import { WorkAreaSafetyBanner } from '../src/components/worker/WorkAreaSafetyBanner.js';
import { ReportHazardModal } from '../src/components/worker/ReportHazardModal.js';
import { AttentionSummary } from '../src/components/dashboard/AttentionSummary.js';
import { OperationalTaskItem } from '../src/components/worker/TodayWorkView.js';

// Mock AuthContext
const mockAuthFetch = vi.fn();
vi.mock('../src/context/AuthContext.js', () => ({
  useAuth: () => ({
    session: {
      sessionId: 'sess-worker-1',
      projectId: 'proj-123',
      accountType: 'worker',
      displayName: 'Carlos Rivera'
    },
    authFetch: mockAuthFetch
  })
}));

const mockTask: OperationalTaskItem = {
  id: 'act-c01',
  externalId: 'ACT-C01',
  name: 'Pipe Rack PR-07 Structural Steel Erection',
  description: 'Erect structural steel frames',
  location: 'Area C',
  plannedStart: '2026-08-10',
  plannedFinish: '2026-08-29',
  plannedQuantity: 320,
  unit: 'ton',
  plannedProgress: 65,
  actualProgress: 50,
  status: 'AT_RISK',
  statusLabel: 'At Risk',
  isToday: true,
  isUpcoming: false,
  isOverdue: false,
  isCompleted: false
};

describe('Frontend Pass 33 — Operational Blockers & Safety Context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. BlockerModal Component', () => {
    it('renders category options and pre-populates linked task info', () => {
      render(
        <BlockerModal
          isOpen={true}
          onClose={vi.fn()}
          projectId="proj-123"
          initialTask={mockTask}
        />
      );

      expect(screen.getByRole('heading', { name: /Log Operational Blocker/i })).toBeDefined();
      expect(screen.getByText('ACT-C01')).toBeDefined();
      expect(screen.getByText('Pipe Rack PR-07 Structural Steel Erection')).toBeDefined();
      expect(screen.getByRole('radio', { name: /equipment/i })).toBeDefined();
      expect(screen.getByRole('radio', { name: /material/i })).toBeDefined();
      expect(screen.getByRole('radio', { name: /access/i })).toBeDefined();
      expect(screen.getByRole('radio', { name: /inspection/i })).toBeDefined();
    });

    it('submits blocker report with correct payload and calls callback', async () => {
      mockAuthFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          blocker: {
            id: 'blocker-999',
            category: 'equipment',
            description: 'Mobile crane hydraulic failure',
            status: 'active'
          }
        })
      });

      const onBlockerLogged = vi.fn();
      const onClose = vi.fn();

      render(
        <BlockerModal
          isOpen={true}
          onClose={onClose}
          projectId="proj-123"
          initialTask={mockTask}
          onBlockerLogged={onBlockerLogged}
        />
      );

      // Select Material category
      const materialBtn = screen.getByRole('radio', { name: /material/i });
      fireEvent.click(materialBtn);

      // Fill in description
      const descInput = screen.getByLabelText(/Blocker Description/i);
      fireEvent.change(descInput, { target: { value: 'Grade-B structural bolts delivery delayed by 3 shifts' } });

      // Submit
      const submitBtn = screen.getByRole('button', { name: /Log Operational Blocker/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockAuthFetch).toHaveBeenCalledWith(
          '/api/projects/proj-123/blockers',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"category":"material"')
          })
        );
      });

      await waitFor(() => {
        expect(onBlockerLogged).toHaveBeenCalled();
      });
    });
  });

  describe('2. WorkAreaSafetyBanner Component', () => {
    it('displays contextual PPE and hazard notifications based on work area', () => {
      const { rerender } = render(
        <WorkAreaSafetyBanner selectedArea="Area C" onOpenReportHazard={vi.fn()} />
      );

      // Area C: Overhead crane lifts
      expect(screen.getByText(/Active Overhead Crane Lifts/i)).toBeDefined();
      expect(screen.getByText(/Safety Harness \(100% Tie-Off\)/i)).toBeDefined();

      // Switch to Area A: Earthmoving & open trenching
      rerender(<WorkAreaSafetyBanner selectedArea="Area A" onOpenReportHazard={vi.fn()} />);
      expect(screen.getByText(/Heavy Machinery & Open Trenching Zone/i)).toBeDefined();
      expect(screen.getByText(/High-Vis Vest/i)).toBeDefined();
    });

    it('triggers onOpenReportHazard when Report Hazard button is clicked', () => {
      const onOpenHazard = vi.fn();
      render(<WorkAreaSafetyBanner selectedArea="Area C" onOpenReportHazard={onOpenHazard} />);

      const hazardBtn = screen.getByTestId('report-hazard-btn');
      fireEvent.click(hazardBtn);
      expect(onOpenHazard).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. ReportHazardModal Component', () => {
    it('renders hazard report form and dispatches observation to safety hazards endpoint', async () => {
      mockAuthFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          event: {
            id: 'evt-safety-1',
            eventType: 'safety_hazard_reported'
          }
        })
      });

      const onReported = vi.fn();
      render(
        <ReportHazardModal
          isOpen={true}
          onClose={vi.fn()}
          projectId="proj-123"
          selectedArea="Area C"
          onHazardReported={onReported}
        />
      );

      expect(screen.getByText('Report Site Hazard / Near Miss')).toBeDefined();

      // Enter description
      const descInput = screen.getByLabelText(/Hazard Observation & Condition/i);
      fireEvent.change(descInput, { target: { value: 'Loose scaffolding clamp above pedestrian route' } });

      // Click submit
      const submitBtn = screen.getByRole('button', { name: /Submit Safety Hazard/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockAuthFetch).toHaveBeenCalledWith(
          '/api/projects/proj-123/safety/hazards',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('Loose scaffolding clamp')
          })
        );
      });

      await waitFor(() => {
        expect(onReported).toHaveBeenCalled();
      });
    });
  });

  describe('4. AttentionSummary Component Active Blockers', () => {
    it('renders active blockers section with root cause tags and triggers resolve callback', () => {
      const mockBlockers = [
        {
          id: 'blk-1',
          activityId: 'act-c01',
          activityExternalId: 'ACT-C01',
          activityName: 'Pipe Rack PR-07',
          category: 'equipment',
          description: '50T crane breakdown halting lifts',
          reporterName: 'Carlos Rivera',
          createdAt: '2026-08-28T10:00:00Z'
        },
        {
          id: 'blk-2',
          activityId: null,
          activityExternalId: null,
          activityName: 'General Site',
          category: 'access',
          description: 'Perimeter access road flooded',
          reporterName: 'Site Lead',
          createdAt: '2026-08-28T11:00:00Z'
        }
      ];

      const onResolve = vi.fn();

      render(
        <AttentionSummary
          delayedCount={0}
          delayed={[]}
          atRiskCount={1}
          atRisk={[]}
          staleCount={0}
          stale={[]}
          unresolvedMatchesCount={0}
          unresolvedMatches={[]}
          activeBlockersCount={2}
          activeBlockers={mockBlockers}
          blockersByRootCause={{ equipment: 1, access: 1, material: 0 }}
          onResolveBlocker={onResolve}
        />
      );

      // Verify section renders
      expect(screen.getByTestId('attention-blockers-section')).toBeDefined();
      expect(screen.getByText(/Active Operational Blockers \(2\)/i)).toBeDefined();

      // Verify root cause tags
      expect(screen.getByTestId('root-cause-equipment')).toBeDefined();
      expect(screen.getByTestId('root-cause-access')).toBeDefined();

      // Verify blocker descriptions
      expect(screen.getByText('50T crane breakdown halting lifts')).toBeDefined();
      expect(screen.getByText('Perimeter access road flooded')).toBeDefined();

      // Click resolve on blk-1
      const resolveBtn = screen.getByTestId('resolve-blocker-btn-blk-1');
      fireEvent.click(resolveBtn);
      expect(onResolve).toHaveBeenCalledWith('blk-1');
    });
  });
});
