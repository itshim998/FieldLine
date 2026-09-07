import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkerReportModal } from '../src/components/worker/WorkerReportModal.js';
import { OperationalTaskItem } from '../src/components/worker/TodayWorkView.js';
import { AuthProvider } from '../src/context/AuthContext.js';

const mockTask: OperationalTaskItem = {
  id: 'task-pour-01',
  externalId: 'ACT-FOUND-01',
  name: 'Foundation Footing Concrete Pour',
  description: 'Pour 100m3 of grade 40 concrete',
  location: 'Area B',
  plannedStart: '2026-08-15',
  plannedFinish: '2026-08-30',
  plannedQuantity: 100,
  unit: 'm3',
  plannedProgress: 50,
  actualProgress: 20,
  status: 'ON_TRACK',
  statusLabel: 'On Track',
  isToday: true,
  isUpcoming: false,
  isOverdue: false,
  isCompleted: false
};

const mockTasksList: OperationalTaskItem[] = [
  mockTask,
  {
    id: 'task-steel-02',
    externalId: 'ACT-STEEL-02',
    name: 'Structural Steel Column Erection',
    description: 'Erect columns',
    location: 'Area C',
    plannedStart: '2026-08-18',
    plannedFinish: '2026-08-31',
    plannedQuantity: 50,
    unit: 'ton',
    plannedProgress: 40,
    actualProgress: 10,
    status: 'AT_RISK',
    statusLabel: 'At Risk',
    isToday: true,
    isUpcoming: false,
    isOverdue: false,
    isCompleted: false
  }
];

// Mock Web Audio API
class MockAudioContext {
  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  createAnalyser() {
    return {
      fftSize: 64,
      connect: vi.fn(),
      disconnect: vi.fn(),
      getByteFrequencyData: vi.fn()
    };
  }
  createScriptProcessor() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  close() {
    return Promise.resolve();
  }
}

describe('Pass 32 — WorkerReportModal Component Tests', () => {
  const originalFetch = global.fetch;
  let postedPayloads: any[] = [];

  beforeEach(() => {
    postedPayloads = [];
    localStorage.setItem('fieldline_session_token', 'test-worker-token');
    localStorage.setItem(
      'fieldline_session',
      JSON.stringify({
        projectId: 'proj-u4',
        accountType: 'worker',
        displayName: 'Mike Ross',
        roleTitle: 'Field Lead'
      })
    );

    (window as any).AudioContext = MockAudioContext;
    (window as any).webkitAudioContext = MockAudioContext;

    // Mock navigator.mediaDevices
    if (!navigator.mediaDevices) {
      (navigator as any).mediaDevices = {};
    }
    navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }]
    });

    global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);

      if (urlStr.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            session: {
              projectId: 'proj-u4',
              accountType: 'worker',
              displayName: 'Mike Ross',
              roleTitle: 'Field Lead'
            }
          })
        };
      }

      if (urlStr.includes('/api/projects/proj-u4/worker/quick-report')) {
        if (init?.body) {
          const parsed = JSON.parse(init.body as string);
          postedPayloads.push(parsed);

          // Simulate quantity derivation
          const derivedPct =
            parsed.actualQuantity != null
              ? Math.min(100, Math.round((parsed.actualQuantity / 100) * 100))
              : parsed.progressPercent ?? 0;

          return {
            ok: true,
            status: 201,
            json: async () => ({
              status: 'confirmed',
              message: `Update verified: Foundation Footing Concrete Pour saved at ${derivedPct}%.`,
              derivedPercent: derivedPct,
              progressUpdate: {
                id: 'up-12345',
                projectId: 'proj-u4',
                reportDate: parsed.reportDate,
                reporterName: parsed.reporterName,
                reporterRole: parsed.reporterRole,
                sourceType: parsed.sourceType || 'manual'
              }
            })
          };
        }
      }

      if (urlStr.includes('/api/projects/proj-u4/evidence')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            deduplicated: false,
            evidence: {
              id: 'ev-999',
              fileName: 'sample_photo.jpg',
              contentSha256: 'a1b2c3d4e5f6',
              progressUpdateId: 'up-12345'
            }
          })
        };
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' })
      };
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('1. Renders modal when isOpen=true and shows initial task details and target metrics', async () => {
    const handleClose = vi.fn();

    render(
      <AuthProvider>
        <WorkerReportModal
          projectId="proj-u4"
          projectCode="REFINERY-U4"
          isOpen={true}
          onClose={handleClose}
          initialTask={mockTask}
          tasks={mockTasksList}
          asOfDate="2026-08-28"
        />
      </AuthProvider>
    );

    expect(screen.getByText('FRICTIONLESS FIELD CAPTURE')).toBeTruthy();
    expect(screen.getByText('Report on ACT-FOUND-01')).toBeTruthy();
    expect(screen.getByText('Foundation Footing Concrete Pour')).toBeTruthy();
    expect(screen.getByText('100 m3')).toBeTruthy();
    expect(screen.getByText('Current Progress')).toBeTruthy();
  });

  it('2. Switches smoothly between Quantity, Voice, and Photo tabs', async () => {
    render(
      <AuthProvider>
        <WorkerReportModal
          projectId="proj-u4"
          projectCode="REFINERY-U4"
          isOpen={true}
          onClose={vi.fn()}
          initialTask={mockTask}
          tasks={mockTasksList}
        />
      </AuthProvider>
    );

    // Initial tab is Quantity / %
    expect(screen.getByText('Actual Completed Quantity (m3)')).toBeTruthy();

    // Click Voice tab
    const voiceTabBtn = screen.getByRole('button', { name: /Live Voice/i });
    fireEvent.click(voiceTabBtn);

    expect(screen.getByText(/Tap microphone to speak field progress hands-free/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Start spoken voice session/i })).toBeTruthy();

    // Click Photo tab
    const photoTabBtn = screen.getByRole('button', { name: /Photo Capture/i });
    fireEvent.click(photoTabBtn);

    expect(screen.getByText(/Snap Photo or Upload Field Evidence/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Upload & Attach Photo Evidence/i })).toBeTruthy();
  });

  it('3. Rapid Quantity tab: calculates percentage from actual quantity and steppers adjust percent', async () => {
    render(
      <AuthProvider>
        <WorkerReportModal
          projectId="proj-u4"
          projectCode="REFINERY-U4"
          isOpen={true}
          onClose={vi.fn()}
          initialTask={mockTask}
          tasks={mockTasksList}
        />
      </AuthProvider>
    );

    // Enter actual quantity 80 m3 out of 100 m3
    const qtyInput = screen.getByPlaceholderText(/e\.g\. 80 out of 100/i) as HTMLInputElement;
    fireEvent.change(qtyInput, { target: { value: '80' } });

    // Verify preview shows 80%
    expect(screen.getByText('80%')).toBeTruthy();

    // Click +10% stepper button
    const stepPlus10 = screen.getByRole('button', { name: '+10%' });
    fireEvent.click(stepPlus10);

    // 80 + 10 = 90%
    expect(screen.getByText('90%')).toBeTruthy();
  });

  it('4. Submits rapid quantity form and dispatches quick-report with human attribution', async () => {
    const handleSuccess = vi.fn();

    render(
      <AuthProvider>
        <WorkerReportModal
          projectId="proj-u4"
          projectCode="REFINERY-U4"
          isOpen={true}
          onClose={vi.fn()}
          initialTask={mockTask}
          tasks={mockTasksList}
          asOfDate="2026-08-28"
          onSuccess={handleSuccess}
        />
      </AuthProvider>
    );

    // Wait for session attribution to populate
    await waitFor(() => {
      expect(screen.getByDisplayValue('Mike Ross')).toBeTruthy();
    });

    // Enter quantity 80
    const qtyInput = screen.getByPlaceholderText(/e\.g\. 80 out of 100/i);
    fireEvent.change(qtyInput, { target: { value: '80' } });

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /Commit Verified Progress/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(postedPayloads).toHaveLength(1);
      expect(postedPayloads[0].activityId).toBe('task-pour-01');
      expect(postedPayloads[0].actualQuantity).toBe(80);
      expect(postedPayloads[0].reporterName).toBe('Mike Ross');
      expect(postedPayloads[0].reporterRole).toBe('Field Lead');
      expect(handleSuccess).toHaveBeenCalled();
    });

    // Check success banner appears
    await waitFor(() => {
      expect(screen.getByText(/Update verified/i)).toBeTruthy();
    });
  });

  it('5. Photo Capture tab: handles file selection, thumbnail preview, and photo submission', async () => {
    const handleSuccess = vi.fn();

    render(
      <AuthProvider>
        <WorkerReportModal
          projectId="proj-u4"
          projectCode="REFINERY-U4"
          isOpen={true}
          onClose={vi.fn()}
          initialTask={mockTask}
          tasks={mockTasksList}
          onSuccess={handleSuccess}
        />
      </AuthProvider>
    );

    // Switch to Photo tab
    fireEvent.click(screen.getByRole('button', { name: /Photo Capture/i }));

    // Simulate file selection
    const mockFile = new File(['mock_image_binary_content'], 'inspection_foundation.jpg', {
      type: 'image/jpeg'
    });

    // Mock URL.createObjectURL and revokeObjectURL
    const mockBlobUrl = 'blob:http://localhost/test-photo-url';
    global.URL.createObjectURL = vi.fn().mockReturnValue(mockBlobUrl);
    global.URL.revokeObjectURL = vi.fn();

    const fileInput = document.getElementById('photo-file-input') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    // Verify thumbnail and file name render
    await waitFor(() => {
      expect(screen.getByText('inspection_foundation.jpg')).toBeTruthy();
      const img = screen.getByAltText('Field preview') as HTMLImageElement;
      expect(img.src).toBe(mockBlobUrl);
    });

    // Submit photo report
    const submitPhotoBtn = screen.getByRole('button', { name: /Upload & Attach Photo Evidence/i });
    fireEvent.click(submitPhotoBtn);

    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalled();
      expect(screen.getByText(/Photo successfully captured & attached/i)).toBeTruthy();
    });
  });

  it('6. Calls onClose when close button is clicked', () => {
    const handleClose = vi.fn();

    render(
      <AuthProvider>
        <WorkerReportModal
          projectId="proj-u4"
          isOpen={true}
          onClose={handleClose}
          initialTask={mockTask}
        />
      </AuthProvider>
    );

    const closeBtn = screen.getByRole('button', { name: /Close modal/i });
    fireEvent.click(closeBtn);

    expect(handleClose).toHaveBeenCalled();
  });
});
