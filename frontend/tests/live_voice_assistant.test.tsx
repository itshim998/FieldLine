import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  useLiveVoiceSession,
  floatTo16BitPCM,
  int16ToBase64,
  base64ToFloat32,
  resampleTo16k,
  resolveGatewayWsUrl
} from '../src/components/assistant/live/useLiveVoiceSession.js';
import { FloatingAIAssistant } from '../src/components/assistant/FloatingAIAssistant.js';
import type { Project } from '../src/App.js';

// --- MOCK ENVIRONMENT SETUP ---

class MockAudioBufferSourceNode {
  public buffer: any = null;
  public isStarted = false;
  public isStopped = false;
  public isDisconnected = false;
  public onended: (() => void) | null = null;

  connect() {}
  start(time?: number) {
    this.isStarted = true;
  }
  stop() {
    this.isStopped = true;
    this.onended?.();
  }
  disconnect() {
    this.isDisconnected = true;
  }
}

class MockAudioContext {
  static instances: MockAudioContext[] = [];
  static activeSources: MockAudioBufferSourceNode[] = [];

  public sampleRate: number;
  public currentTime: number = 0;
  public state: string = 'running';
  public audioWorklet = {
    addModule: vi.fn().mockResolvedValue(undefined)
  };
  public destination = {};

  constructor(options: { sampleRate?: number } = {}) {
    this.sampleRate = options.sampleRate || 16000;
    MockAudioContext.instances.push(this);
  }

  createMediaStreamSource() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn()
    };
  }

  createAnalyser() {
    return {
      fftSize: 64,
      frequencyBinCount: 32,
      connect: vi.fn(),
      disconnect: vi.fn(),
      getByteFrequencyData: (arr: Uint8Array) => {
        arr.fill(120);
      }
    };
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    return {
      duration: length / sampleRate,
      length,
      sampleRate,
      copyToChannel: vi.fn()
    };
  }

  createBufferSource() {
    const src = new MockAudioBufferSourceNode();
    MockAudioContext.activeSources.push(src);
    return src;
  }

  createScriptProcessor() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null
    };
  }

  resume() {
    return Promise.resolve();
  }

  close() {
    return Promise.resolve();
  }
}

class MockAudioWorkletNode {
  public port = {
    postMessage: vi.fn(),
    onmessage: null as ((e: any) => void) | null
  };
  connect() {}
  disconnect() {}
}

class MockMediaStreamTrack {
  public stopped = false;
  stop() {
    this.stopped = true;
  }
}

class MockMediaStream {
  public tracks = [new MockMediaStreamTrack(), new MockMediaStreamTrack()];
  getTracks() {
    return this.tracks;
  }
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static lastInstance: MockWebSocket | null = null;

  public url: string;
  public readyState: number = 0; // CONNECTING
  public onopen: (() => void) | null = null;
  public onmessage: ((e: { data: string }) => void) | null = null;
  public onerror: ((e: any) => void) | null = null;
  public onclose: ((e: any) => void) | null = null;
  public sentMessages: string[] = [];
  public openTimer: any = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    MockWebSocket.lastInstance = this;

    this.openTimer = setTimeout(() => {
      this.openTimer = null;
      this.readyState = 1; // OPEN
      this.onopen?.();
    }, 10);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string) {
    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
    this.readyState = 3; // CLOSED
    this.onclose?.({ code, reason });
  }

  simulateServerMessage(payload: Record<string, any>) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

// Sample Test Projects
const mockProjects: Project[] = [
  {
    id: 'proj-001',
    name: 'Metropolitan Light Rail',
    code: 'MLR-B1',
    description: 'Transit Expansion',
    status: 'active',
    startDate: '2026-01-01',
    targetEndDate: '2026-12-31',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'proj-002',
    name: 'Harbor Bridge Retrofit',
    code: 'HBR-02',
    description: 'Bridge Rehabilitation',
    status: 'active',
    startDate: '2026-02-01',
    targetEndDate: '2026-11-30',
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z'
  }
];

// Test Harness Component for Testing the Hook Directly
const TestHookConsumer: React.FC<{
  projectId?: string;
  onSessionReady?: (session: ReturnType<typeof useLiveVoiceSession>) => void;
}> = ({ projectId = 'proj-001', onSessionReady }) => {
  const session = useLiveVoiceSession({ projectId });

  React.useEffect(() => {
    onSessionReady?.(session);
  }, [session, onSessionReady]);

  return (
    <div>
      <div data-testid="connection-state">{session.connectionState}</div>
      <div data-testid="active-slot">{session.activeSlot || 'none'}</div>
      <div data-testid="is-listening">{session.isListening ? 'listening' : 'idle'}</div>
      <div data-testid="is-speaking">{session.isSpeaking ? 'speaking' : 'silent'}</div>
      <button data-testid="start-btn" onClick={() => session.startSession(projectId)}>
        Start
      </button>
      <button data-testid="stop-btn" onClick={() => session.stopSession()}>
        Stop
      </button>
      <button data-testid="toggle-btn" onClick={() => session.toggleSession(projectId)}>
        Toggle
      </button>
    </div>
  );
};

describe('Pass 4: Frontend Live Voice Client & Floating AI Panel Integration', () => {
  let originalAudioContext: any;
  let originalWebSocket: any;
  let originalMediaDevices: any;
  let originalAudioWorkletNode: any;

  beforeEach(() => {
    MockAudioContext.instances = [];
    MockAudioContext.activeSources = [];
    MockWebSocket.instances = [];
    MockWebSocket.lastInstance = null;

    originalAudioContext = (window as any).AudioContext;
    originalWebSocket = (window as any).WebSocket;
    originalMediaDevices = navigator.mediaDevices;
    originalAudioWorkletNode = (window as any).AudioWorkletNode;

    (window as any).AudioContext = MockAudioContext;
    (window as any).webkitAudioContext = MockAudioContext;
    (window as any).AudioWorkletNode = MockAudioWorkletNode;
    (window as any).WebSocket = MockWebSocket;

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(new MockMediaStream())
      },
      writable: true,
      configurable: true
    });
  });

  afterEach(() => {
    for (const ws of MockWebSocket.instances) {
      if (ws.openTimer) {
        clearTimeout(ws.openTimer);
        ws.openTimer = null;
      }
    }
    MockWebSocket.instances = [];
    MockWebSocket.lastInstance = null;

    (window as any).AudioContext = originalAudioContext;
    (window as any).webkitAudioContext = originalAudioContext;
    (window as any).AudioWorkletNode = originalAudioWorkletNode;
    (window as any).WebSocket = originalWebSocket;

    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      writable: true,
      configurable: true
    });
  });

  describe('Audio Processing & Utility Functions', () => {
    it('should correctly convert Float32Array to 16-bit PCM Linear (Int16Array)', () => {
      const float32 = new Float32Array([-1.0, -0.5, 0.0, 0.5, 1.0]);
      const pcm16 = floatTo16BitPCM(float32);

      expect(pcm16).toBeInstanceOf(Int16Array);
      expect(pcm16.length).toBe(5);
      expect(pcm16[0]).toBe(-32768);
      expect(pcm16[2]).toBe(0);
      expect(pcm16[4]).toBe(32767);
    });

    it('should correctly encode Int16Array to Base64 and decode Base64 back to Float32Array', () => {
      const originalFloat = new Float32Array([0.0, 0.5, -0.5]);
      const pcm16 = floatTo16BitPCM(originalFloat);
      const b64 = int16ToBase64(pcm16);

      expect(typeof b64).toBe('string');
      expect(b64.length).toBeGreaterThan(0);

      const decodedFloat = base64ToFloat32(b64);
      expect(decodedFloat.length).toBe(3);
      expect(decodedFloat[0]).toBeCloseTo(0.0, 2);
      expect(decodedFloat[1]).toBeCloseTo(0.5, 2);
      expect(decodedFloat[2]).toBeCloseTo(-0.5, 2);
    });

    it('should properly resample audio when input sample rate is 48kHz to 16kHz', () => {
      // 48 samples at 48kHz -> should downsample by 3x to ~16 samples
      const input48k = new Float32Array(48).fill(0.5);
      const resampled16k = resampleTo16k(input48k, 48000);

      expect(resampled16k.length).toBe(16);
      expect(resampled16k[0]).toBeCloseTo(0.5, 2);
    });

    it('should return identical buffer when input is already 16kHz', () => {
      const input16k = new Float32Array([0.1, 0.2, 0.3]);
      const resampled = resampleTo16k(input16k, 16000);
      expect(resampled).toBe(input16k);
    });

    it('should construct correct gateway WebSocket URL with project query parameter', () => {
      const url = resolveGatewayWsUrl('proj-xyz', 'ws://localhost:3001/ws/live-session');
      expect(url).toBe('ws://localhost:3001/ws/live-session?projectId=proj-xyz');
    });
  });

  describe('useLiveVoiceSession Hook Pipeline', () => {
    it('should request microphone, initialize AudioContext and AudioWorklet, and connect WebSocket', async () => {
      let sessionRef: any;
      render(
        <TestHookConsumer
          projectId="proj-001"
          onSessionReady={(session) => {
            sessionRef = session;
          }}
        />
      );

      // Start live voice session
      await act(async () => {
        await sessionRef.startSession('proj-001');
      });

      // Verify microphone request with required audio constraints
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // Verify WebSocket was instantiated with correct URL
      expect(MockWebSocket.instances.length).toBe(1);
      const ws = MockWebSocket.lastInstance!;
      expect(ws.url).toContain('projectId=proj-001');

      // Wait for socket open event
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      // Check connected state
      expect(screen.getByTestId('is-listening').textContent).toBe('listening');
      expect(screen.getByTestId('connection-state').textContent).toBe('connected');

      // Cleanup
      act(() => {
        sessionRef.stopSession();
      });
      expect(screen.getByTestId('connection-state').textContent).toBe('idle');
    });

    it('should handle status message updating active slot from Gemini Key Router', async () => {
      let sessionRef: any;
      render(
        <TestHookConsumer
          projectId="proj-001"
          onSessionReady={(session) => {
            sessionRef = session;
          }}
        />
      );

      await act(async () => {
        await sessionRef.startSession('proj-001');
      });

      const ws = MockWebSocket.lastInstance!;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        // Server sends status with active key slot (Pass 1 & 2 integration)
        ws.simulateServerMessage({
          type: 'status',
          state: 'ready',
          activeSlot: '03'
        });
      });

      expect(screen.getByTestId('active-slot').textContent).toBe('03');
      expect(screen.getByTestId('connection-state').textContent).toBe('ready');
    });

    it('should schedule incoming 24kHz audio playback buffers', async () => {
      let sessionRef: any;
      render(
        <TestHookConsumer
          projectId="proj-001"
          onSessionReady={(session) => {
            sessionRef = session;
          }}
        />
      );

      await act(async () => {
        await sessionRef.startSession('proj-001');
      });

      const ws = MockWebSocket.lastInstance!;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));

        // Send a 24kHz audio chunk
        const sampleAudio = new Float32Array(480).fill(0.2);
        const pcm16 = floatTo16BitPCM(sampleAudio);
        const b64 = int16ToBase64(pcm16);

        ws.simulateServerMessage({
          type: 'audio_chunk',
          data: b64
        });
      });

      expect(screen.getByTestId('is-speaking').textContent).toBe('speaking');
      expect(MockAudioContext.activeSources.length).toBeGreaterThan(0);
      expect(MockAudioContext.activeSources[0].isStarted).toBe(true);
    });

    it('should immediately flush playback buffers on interruption (barge-in event)', async () => {
      let sessionRef: any;
      render(
        <TestHookConsumer
          projectId="proj-001"
          onSessionReady={(session) => {
            sessionRef = session;
          }}
        />
      );

      await act(async () => {
        await sessionRef.startSession('proj-001');
      });

      const ws = MockWebSocket.lastInstance!;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));

        // Start playback
        const sampleAudio = new Float32Array(480).fill(0.2);
        const b64 = int16ToBase64(floatTo16BitPCM(sampleAudio));
        ws.simulateServerMessage({ type: 'audio_chunk', data: b64 });
      });

      expect(screen.getByTestId('is-speaking').textContent).toBe('speaking');
      const activeSource = MockAudioContext.activeSources[0];

      // Simulate worker interrupting the assistant
      await act(async () => {
        ws.simulateServerMessage({ type: 'interrupted' });
      });

      // Scheduled source must be immediately stopped and flushed
      expect(activeSource.isStopped).toBe(true);
      expect(screen.getByTestId('is-speaking').textContent).toBe('silent');
    });

    it('should record streaming input and output transcriptions and verified updates', async () => {
      let sessionRef: any;
      render(
        <TestHookConsumer
          projectId="proj-001"
          onSessionReady={(session) => {
            sessionRef = session;
          }}
        />
      );

      await act(async () => {
        await sessionRef.startSession('proj-001');
      });

      const ws = MockWebSocket.lastInstance!;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));

        // 1. Worker speech transcript
        ws.simulateServerMessage({
          type: 'input_transcription',
          text: 'We finished casting concrete on Pier 12'
        });

        // 2. Gemini speech transcript
        ws.simulateServerMessage({
          type: 'output_transcription',
          text: 'Understood. Logging that now.'
        });

        // 3. Progress verified event (Pass 3 loop)
        ws.simulateServerMessage({
          type: 'progress_verified',
          activityId: 'act-pier-12',
          activityCode: 'ACT-P12',
          activityName: 'Pier 12 Concrete Slab',
          progressPercent: 100,
          message: 'Update verified: Pier 12 Concrete Slab is saved at 100%.'
        });
      });

      expect(sessionRef.liveTranscript.length).toBe(2);
      expect(sessionRef.liveTranscript[0].sender).toBe('user');
      expect(sessionRef.liveTranscript[0].text).toContain('Pier 12');
      expect(sessionRef.liveTranscript[1].sender).toBe('gemini');
      expect(sessionRef.liveTranscript[1].text).toContain('Logging that now');

      expect(sessionRef.verifiedUpdates.length).toBe(1);
      expect(sessionRef.verifiedUpdates[0].activityCode).toBe('ACT-P12');
      expect(sessionRef.verifiedUpdates[0].progressPercent).toBe(100);
    });

    it('should cleanly stop session and release microphone tracks on cleanup', async () => {
      let sessionRef: any;
      const { unmount } = render(
        <TestHookConsumer
          projectId="proj-001"
          onSessionReady={(session) => {
            sessionRef = session;
          }}
        />
      );

      await act(async () => {
        await sessionRef.startSession('proj-001');
      });

      const ws = MockWebSocket.lastInstance!;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      // Unmount component
      act(() => {
        unmount();
      });

      // WebSocket should be closed
      expect(ws.readyState).toBe(3);
    });
  });

  describe('FloatingAIAssistant Panel UI Integration', () => {
    it('should render the Floating AI Trigger and open the assistant panel', () => {
      render(
        <FloatingAIAssistant
          projects={mockProjects}
          currentProject={mockProjects[0]}
        />
      );

      const triggerBtn = screen.getByRole('button', { name: /Toggle FieldLine AI Assistant/i });
      expect(triggerBtn).toBeDefined();

      // Open panel
      fireEvent.click(triggerBtn);
      expect(screen.getByRole('dialog')).toBeDefined();
      expect(screen.getByText('FieldLine AI')).toBeDefined();
      expect(screen.getByRole('button', { name: /Start Live Voice Assistant/i })).toBeDefined();
    });

    it('should toggle Live Voice mode on mic button click and display Live Voice HUD', async () => {
      render(
        <FloatingAIAssistant
          projects={mockProjects}
          currentProject={mockProjects[0]}
        />
      );

      // Open panel
      fireEvent.click(screen.getByRole('button', { name: /Toggle FieldLine AI Assistant/i }));

      // Locate Live Voice mic button in footer
      const micBtn = screen.getByRole('button', { name: /Start Live Voice Assistant/i });
      expect(micBtn.id).toBe('floating-ai-live-voice-btn');

      // Click to start Live Voice session
      await act(async () => {
        fireEvent.click(micBtn);
      });

      // Verify HUD renders with status, badges, and visualizer
      expect(document.getElementById('floating-ai-live-hud')).toBeDefined();
      expect(screen.getByText(/Gemini 3 Flash Live/i)).toBeDefined();
      expect(screen.getByLabelText('Audio Visualizer')).toBeDefined();

      const ws = MockWebSocket.lastInstance!;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        ws.simulateServerMessage({
          type: 'status',
          state: 'ready',
          activeSlot: '05'
        });
      });

      // Active slot badge should show Slot 05
      expect(screen.getByText('Slot 05')).toBeDefined();
      expect(screen.getByText('LISTENING...')).toBeDefined();

      // Click mic button again to stop Live Voice
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Stop Live Voice Assistant/i }));
      });

      expect(document.getElementById('floating-ai-live-hud')).toBeNull();
    });

    it('should render real-time streaming speech captions in HUD banner', async () => {
      render(
        <FloatingAIAssistant
          projects={mockProjects}
          currentProject={mockProjects[0]}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Toggle FieldLine AI Assistant/i }));
      const micBtn = screen.getByRole('button', { name: /Start Live Voice Assistant/i });

      await act(async () => {
        fireEvent.click(micBtn);
      });

      const ws = MockWebSocket.lastInstance!;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        ws.simulateServerMessage({
          type: 'input_transcription',
          text: 'What is our next scheduled task?'
        });
        ws.simulateServerMessage({
          type: 'output_transcription',
          text: 'Pier 14 Reinforcement is scheduled next for Block B.'
        });
      });

      expect(screen.getByText('Worker:')).toBeDefined();
      expect(screen.getByText('What is our next scheduled task?')).toBeDefined();
      expect(screen.getByText('Gemini:')).toBeDefined();
      expect(screen.getByText('Pier 14 Reinforcement is scheduled next for Block B.')).toBeDefined();
    });

    it('should render verified progress update card and trigger activity navigation on click', async () => {
      const handleNavigateToActivity = vi.fn();

      render(
        <FloatingAIAssistant
          projects={mockProjects}
          currentProject={mockProjects[0]}
          onNavigateToActivity={handleNavigateToActivity}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Toggle FieldLine AI Assistant/i }));
      const micBtn = screen.getByRole('button', { name: /Start Live Voice Assistant/i });

      await act(async () => {
        fireEvent.click(micBtn);
      });

      const ws = MockWebSocket.lastInstance!;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        ws.simulateServerMessage({
          type: 'progress_verified',
          activityId: 'act-deck-10',
          activityCode: 'ACT-DK10',
          activityName: 'Bridge Deck Pour',
          progressPercent: 75,
          message: 'Update verified: Bridge Deck Pour is saved at 75%.'
        });
      });

      // Verify progress confirmation card
      expect(screen.getByText('Update Verified & Saved')).toBeDefined();
      expect(screen.getByText('75%')).toBeDefined();
      expect(screen.getByText('Update verified: Bridge Deck Pour is saved at 75%.')).toBeDefined();

      // Click "View Activity (ACT-DK10)" button
      const viewActBtn = screen.getByRole('button', { name: /View Activity \(ACT-DK10\)/i });
      fireEvent.click(viewActBtn);

      // Must call onNavigateToActivity with the exact activityId
      expect(handleNavigateToActivity).toHaveBeenCalledWith('act-deck-10');
    });

    it('should seamlessly sync project selection from dropdown to active live voice session', async () => {
      render(
        <FloatingAIAssistant
          projects={mockProjects}
          currentProject={mockProjects[0]}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Toggle FieldLine AI Assistant/i }));
      const micBtn = screen.getByRole('button', { name: /Start Live Voice Assistant/i });

      // Start live voice on Project 1
      await act(async () => {
        fireEvent.click(micBtn);
      });

      const firstWs = MockWebSocket.lastInstance!;
      expect(firstWs.url).toContain('projectId=proj-001');

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      // Switch project in dropdown to Project 2 (HBR-02)
      const projectSelect = screen.getByTitle('Select project context for AI queries');
      await act(async () => {
        fireEvent.change(projectSelect, { target: { value: 'proj-002' } });
      });

      // Live voice session should reconnect to the new project
      const secondWs = MockWebSocket.lastInstance!;
      expect(secondWs.url).toContain('projectId=proj-002');
    });
  });
});
