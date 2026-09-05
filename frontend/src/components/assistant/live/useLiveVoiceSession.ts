import { useState, useEffect, useRef, useCallback } from 'react';

export interface LiveTranscriptItem {
  id: string;
  sender: 'user' | 'gemini';
  text: string;
  timestamp: string;
  isFinal?: boolean;
}

export interface VerifiedProgressUpdate {
  id: string;
  activityId: string;
  activityCode: string;
  activityName: string;
  progressPercent: number;
  message: string;
  timestamp: string;
}

export type LiveConnectionState = 'idle' | 'connecting' | 'connected' | 'ready' | 'handover' | 'error';

export interface UseLiveVoiceSessionOptions {
  projectId?: string | null;
  gatewayWsUrl?: string;
  onVerifiedUpdate?: (update: VerifiedProgressUpdate) => void;
  onError?: (error: string) => void;
}

export interface UseLiveVoiceSessionReturn {
  isLiveConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  connectionState: LiveConnectionState;
  activeSlot: string | null;
  liveTranscript: LiveTranscriptItem[];
  verifiedUpdates: VerifiedProgressUpdate[];
  audioVolume: number;
  frequencyBars: number[];
  error: string | null;
  startSession: (projectId?: string) => Promise<void>;
  stopSession: () => void;
  toggleSession: (projectId?: string) => Promise<void>;
  clearTranscript: () => void;
}

// Convert Float32Array (-1.0 to 1.0) to 16-bit Linear PCM (Int16Array)
export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

// Convert Int16Array to Base64
export function int16ToBase64(int16Array: Int16Array): string {
  const uint8 = new Uint8Array(int16Array.buffer, int16Array.byteOffset, int16Array.byteLength);
  let binary = '';
  const len = uint8.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunkSize) as unknown as number[]);
  }
  return btoa(binary);
}

// Decode Base64 24kHz PCM to Float32Array
export function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

// Resample audio to 16kHz if input context has a different sample rate
export function resampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === 16000) return input;
  const ratio = inputSampleRate / 16000;
  const newLength = Math.round(input.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetInput = 0;
  while (offsetResult < result.length) {
    const nextOffsetInput = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetInput; i < nextOffsetInput && i < input.length; i++) {
      accum += input[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetInput = nextOffsetInput;
  }
  return result;
}

// Helper to determine the WebSocket gateway URL
export function resolveGatewayWsUrl(projectId: string, customWsUrl?: string): string {
  if (customWsUrl) {
    const sep = customWsUrl.includes('?') ? '&' : '?';
    return `${customWsUrl}${sep}projectId=${encodeURIComponent(projectId)}`;
  }
  if (typeof window !== 'undefined' && window.location) {
    const loc = window.location;
    const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    const port = (loc.port === '3000' || loc.port === '5173') ? '3001' : (loc.port || (loc.protocol === 'https:' ? '443' : '80'));
    return `${protocol}//${loc.hostname}:${port}/ws/live-session?projectId=${encodeURIComponent(projectId)}`;
  }
  return `ws://localhost:3001/ws/live-session?projectId=${encodeURIComponent(projectId)}`;
}

// Inline AudioWorklet code as Blob URL
const WORKLET_CODE = `
class PCMRecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      this.port.postMessage(new Float32Array(input[0]));
    }
    return true;
  }
}
registerProcessor('pcm-recorder-processor', PCMRecorderProcessor);
`;

export function useLiveVoiceSession({
  projectId,
  gatewayWsUrl,
  onVerifiedUpdate,
  onError
}: UseLiveVoiceSessionOptions = {}): UseLiveVoiceSessionReturn {
  const [connectionState, setConnectionState] = useState<LiveConnectionState>('idle');
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [liveTranscript, setLiveTranscript] = useState<LiveTranscriptItem[]>([]);
  const [verifiedUpdates, setVerifiedUpdates] = useState<VerifiedProgressUpdate[]>([]);
  const [audioVolume, setAudioVolume] = useState<number>(0);
  const [frequencyBars, setFrequencyBars] = useState<number[]>([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
  const [error, setError] = useState<string | null>(null);

  // References for WebSockets and Audio Nodes
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const workletNodeRef = useRef<AudioNode | null>(null);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextScheduledTimeRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);
  const isSessionActiveRef = useRef<boolean>(false);
  const workletBlobUrlRef = useRef<string | null>(null);
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLiveConnected = connectionState === 'connected' || connectionState === 'ready';

  // Flush scheduled audio buffers on interruption (barge-in)
  const flushScheduledPlayback = useCallback(() => {
    for (const source of scheduledSourcesRef.current) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Ignore already stopped sources
      }
    }
    scheduledSourcesRef.current = [];
    if (outputAudioContextRef.current) {
      nextScheduledTimeRef.current = outputAudioContextRef.current.currentTime;
    } else {
      nextScheduledTimeRef.current = 0;
    }
    setIsSpeaking(false);
  }, []);

  // Visualizer update loop: computes real-time volume and 8 equalizer bars
  const updateVisualizer = useCallback(() => {
    let activeAnalyser: AnalyserNode | null = null;

    if (isSpeaking && outputAnalyserRef.current) {
      activeAnalyser = outputAnalyserRef.current;
    } else if (isListening && inputAnalyserRef.current) {
      activeAnalyser = inputAnalyserRef.current;
    }

    if (activeAnalyser) {
      const bufferLength = activeAnalyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      activeAnalyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const avg = sum / (bufferLength || 1);
      const normalizedVol = Math.min(1, avg / 128);
      setAudioVolume(normalizedVol);

      // Extract 8 frequency bands
      const bandSize = Math.max(1, Math.floor(bufferLength / 8));
      const bars: number[] = [];
      for (let b = 0; b < 8; b++) {
        let bandSum = 0;
        const start = b * bandSize;
        const end = Math.min(bufferLength, start + bandSize);
        for (let i = start; i < end; i++) {
          bandSum += dataArray[i];
        }
        const bandAvg = bandSum / Math.max(1, end - start);
        bars.push(Math.max(0.08, Math.min(1, bandAvg / 200)));
      }
      setFrequencyBars(bars);
    } else {
      setAudioVolume(0);
      setFrequencyBars((prev) => prev.map((v) => Math.max(0.08, v * 0.9)));
    }

    if (isSessionActiveRef.current && (typeof process === 'undefined' || process.env?.NODE_ENV !== 'test')) {
      animFrameRef.current = requestAnimationFrame(updateVisualizer);
    }
  }, [isListening, isSpeaking]);

  // Play incoming 24kHz PCM chunk
  const scheduleAudioPlayback = useCallback((base64Chunk: string) => {
    try {
      const float32Data = base64ToFloat32(base64Chunk);
      if (float32Data.length === 0) return;

      if (!outputAudioContextRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          outputAudioContextRef.current = new AudioCtx({ sampleRate: 24000 });
          const analyser = outputAudioContextRef.current.createAnalyser();
          analyser.fftSize = 64;
          analyser.connect(outputAudioContextRef.current.destination);
          outputAnalyserRef.current = analyser;
        }
      }

      const ctx = outputAudioContextRef.current;
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const audioBuffer = ctx.createBuffer(1, float32Data.length, 24000);
      audioBuffer.copyToChannel(float32Data as any, 0);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      if (outputAnalyserRef.current) {
        source.connect(outputAnalyserRef.current);
      } else {
        source.connect(ctx.destination);
      }

      const currentTime = ctx.currentTime;
      const startTime = Math.max(currentTime, nextScheduledTimeRef.current);
      source.start(startTime);
      nextScheduledTimeRef.current = startTime + audioBuffer.duration;

      scheduledSourcesRef.current.push(source);
      setIsSpeaking(true);

      source.onended = () => {
        scheduledSourcesRef.current = scheduledSourcesRef.current.filter((s) => s !== source);
        if (scheduledSourcesRef.current.length === 0) {
          setIsSpeaking(false);
        }
      };
    } catch (err: any) {
      console.warn('Audio playback error:', err);
    }
  }, []);

  // Cleanup all audio resources and connections
  const cleanupResources = useCallback(() => {
    isSessionActiveRef.current = false;

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }

    // Flush scheduled audio
    flushScheduledPlayback();

    // Close WebSocket
    if (wsRef.current) {
      try {
        wsRef.current.close(1000, 'User disconnected');
      } catch {}
      wsRef.current = null;
    }

    // Stop MediaStream tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    // Disconnect Worklet / Processor Node
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.disconnect();
      } catch {}
      workletNodeRef.current = null;
    }

    // Close Audio Contexts
    if (inputAudioContextRef.current) {
      try {
        inputAudioContextRef.current.close();
      } catch {}
      inputAudioContextRef.current = null;
    }

    if (outputAudioContextRef.current) {
      try {
        outputAudioContextRef.current.close();
      } catch {}
      outputAudioContextRef.current = null;
    }

    if (workletBlobUrlRef.current) {
      try {
        URL.revokeObjectURL(workletBlobUrlRef.current);
      } catch {}
      workletBlobUrlRef.current = null;
    }

    setIsListening(false);
    setIsSpeaking(false);
    setAudioVolume(0);
    setFrequencyBars([0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08]);
  }, [flushScheduledPlayback]);

  // Teardown session
  const stopSession = useCallback(() => {
    cleanupResources();
    setConnectionState('idle');
  }, [cleanupResources]);

  // Initialize and start live voice session
  const startSession = useCallback(
    async (targetProjectId?: string) => {
      const activePid = targetProjectId || projectId;
      if (!activePid) {
        const msg = 'Cannot start Live Voice: No project selected.';
        setError(msg);
        onError?.(msg);
        return;
      }

      cleanupResources();
      setError(null);
      setConnectionState('connecting');

      try {
        // 1. Request microphone permission
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Microphone access is not supported by your browser environment.');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        mediaStreamRef.current = stream;

        // 2. Setup Input Web Audio Context
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) {
          throw new Error('Web Audio API is not supported by your browser.');
        }

        const inputCtx = new AudioCtx({ sampleRate: 16000 });
        inputAudioContextRef.current = inputCtx;
        const sourceNode = inputCtx.createMediaStreamSource(stream);

        // Setup Input Analyser Node for visualizer
        const inputAnalyser = inputCtx.createAnalyser();
        inputAnalyser.fftSize = 64;
        sourceNode.connect(inputAnalyser);
        inputAnalyserRef.current = inputAnalyser;

        // Setup Output Audio Context (24kHz)
        const outputCtx = new AudioCtx({ sampleRate: 24000 });
        outputAudioContextRef.current = outputCtx;
        const outputAnalyser = outputCtx.createAnalyser();
        outputAnalyser.fftSize = 64;
        outputAnalyser.connect(outputCtx.destination);
        outputAnalyserRef.current = outputAnalyser;

        // 3. Connect WebSocket to FieldLine Gateway
        const wsUrl = resolveGatewayWsUrl(activePid, gatewayWsUrl);
        const socket = new WebSocket(wsUrl);
        wsRef.current = socket;

        // Arm 10s connection timeout
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
        }
        connectionTimeoutRef.current = setTimeout(() => {
          if (isSessionActiveRef.current || wsRef.current) {
            const timeoutMsg = 'Connection timed out. Please verify the FieldLine backend is running on port 3001 and your Gemini keys are configured.';
            setError(timeoutMsg);
            setConnectionState('error');
            onError?.(timeoutMsg);
            cleanupResources();
          }
        }, 10000);

        // Audio chunk sender
        const sendAudioChunk = (float32Chunk: Float32Array) => {
          if (socket.readyState === WebSocket.OPEN) {
            const resampled = resampleTo16k(float32Chunk, inputCtx.sampleRate);
            const pcm16 = floatTo16BitPCM(resampled);
            const base64 = int16ToBase64(pcm16);
            socket.send(
              JSON.stringify({
                type: 'audio_chunk',
                data: base64
              })
            );
          }
        };

        // 4. Setup AudioWorklet (with ScriptProcessorNode fallback)
        let workletLoaded = false;
        if (inputCtx.audioWorklet && typeof Blob !== 'undefined' && typeof URL.createObjectURL === 'function') {
          try {
            const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            workletBlobUrlRef.current = blobUrl;
            await inputCtx.audioWorklet.addModule(blobUrl);

            const workletNode = new AudioWorkletNode(inputCtx, 'pcm-recorder-processor');
            workletNode.port.onmessage = (e) => {
              if (e.data && e.data instanceof Float32Array) {
                sendAudioChunk(e.data);
              }
            };
            sourceNode.connect(workletNode);
            workletNode.connect(inputCtx.destination);
            workletNodeRef.current = workletNode;
            workletLoaded = true;
          } catch (workletErr) {
            console.warn('AudioWorklet initialization failed, falling back to ScriptProcessorNode:', workletErr);
          }
        }

        // ScriptProcessorNode fallback
        if (!workletLoaded && typeof inputCtx.createScriptProcessor === 'function') {
          const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
          scriptProcessor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            sendAudioChunk(inputData);
          };
          sourceNode.connect(scriptProcessor);
          scriptProcessor.connect(inputCtx.destination);
          workletNodeRef.current = scriptProcessor;
        }

        socket.onopen = () => {
          setConnectionState('connected');
          setIsListening(true);
          isSessionActiveRef.current = true;
          if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'test') {
            animFrameRef.current = requestAnimationFrame(updateVisualizer);
          } else {
            updateVisualizer();
          }
        };

        socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            switch (msg.type) {
              case 'status':
                if (connectionTimeoutRef.current) {
                  clearTimeout(connectionTimeoutRef.current);
                  connectionTimeoutRef.current = null;
                }
                if (msg.state === 'connected' || msg.state === 'ready') {
                  setConnectionState('ready');
                  if (msg.activeSlot) setActiveSlot(msg.activeSlot);
                } else if (msg.state === 'handover') {
                  setConnectionState('handover');
                }
                break;

              case 'audio_chunk':
                if (msg.data) {
                  scheduleAudioPlayback(msg.data);
                }
                break;

              case 'input_transcription':
                if (msg.text) {
                  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  setLiveTranscript((prev) => {
                    const last = prev[prev.length - 1];
                    if (last && last.sender === 'user' && !last.isFinal) {
                      return [...prev.slice(0, -1), { ...last, text: msg.text }];
                    }
                    return [
                      ...prev,
                      {
                        id: `user-${Date.now()}`,
                        sender: 'user',
                        text: msg.text,
                        timestamp: now
                      }
                    ];
                  });
                }
                break;

              case 'output_transcription':
                if (msg.text) {
                  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  setLiveTranscript((prev) => {
                    const last = prev[prev.length - 1];
                    if (last && last.sender === 'gemini' && !last.isFinal) {
                      return [...prev.slice(0, -1), { ...last, text: msg.text }];
                    }
                    return [
                      ...prev,
                      {
                        id: `gemini-${Date.now()}`,
                        sender: 'gemini',
                        text: msg.text,
                        timestamp: now
                      }
                    ];
                  });
                }
                break;

              case 'turn_complete':
                setLiveTranscript((prev) =>
                  prev.map((item, idx) => (idx === prev.length - 1 ? { ...item, isFinal: true } : item))
                );
                break;

              case 'interrupted':
                // Worker interrupted Gemini (barge-in)
                flushScheduledPlayback();
                setLiveTranscript((prev) => {
                  const last = prev[prev.length - 1];
                  if (last && last.sender === 'gemini') {
                    return [...prev.slice(0, -1), { ...last, isFinal: true }];
                  }
                  return prev;
                });
                break;

              case 'progress_verified':
                if (msg.activityId) {
                  const update: VerifiedProgressUpdate = {
                    id: `verified-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    activityId: msg.activityId,
                    activityCode: msg.activityCode || 'ACT',
                    activityName: msg.activityName || 'Activity',
                    progressPercent: typeof msg.progressPercent === 'number' ? msg.progressPercent : 100,
                    message: msg.message || `Update verified: ${msg.activityName} is saved at ${msg.progressPercent}%.`,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  };
                  setVerifiedUpdates((prev) => [update, ...prev]);
                  onVerifiedUpdate?.(update);
                }
                break;

              case 'error':
                if (connectionTimeoutRef.current) {
                  clearTimeout(connectionTimeoutRef.current);
                  connectionTimeoutRef.current = null;
                }
                setError(msg.message || 'Live session error');
                setConnectionState('error');
                onError?.(msg.message || 'Live session error');
                break;

              default:
                break;
            }
          } catch (err: any) {
            console.warn('Failed to parse gateway message:', err);
          }
        };

        socket.onerror = () => {
          if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
          }
          const errMsg = 'WebSocket connection to Gemini Live Gateway failed. Is the backend running on port 3001?';
          setError(errMsg);
          setConnectionState('error');
          onError?.(errMsg);
        };

        socket.onclose = (ev) => {
          if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
          }
          if (isSessionActiveRef.current) {
            if (ev.code !== 1000) {
              setConnectionState('error');
              const reason = ev.reason ? `: ${ev.reason}` : '';
              setError(`Gateway disconnected (code ${ev.code}${reason})`);
            } else {
              setConnectionState('idle');
            }
            setIsListening(false);
          }
        };
      } catch (err: any) {
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        const errorText = err.message || 'Failed to initialize microphone or live audio session';
        setError(errorText);
        setConnectionState('error');
        onError?.(errorText);
        cleanupResources();
      }
    },
    [projectId, gatewayWsUrl, cleanupResources, scheduleAudioPlayback, flushScheduledPlayback, updateVisualizer, onVerifiedUpdate, onError]
  );

  // Toggle live voice session
  const toggleSession = useCallback(
    async (targetProjectId?: string) => {
      if (isLiveConnected || connectionState === 'connecting' || connectionState === 'handover' || connectionState === 'error') {
        stopSession();
      } else {
        await startSession(targetProjectId);
      }
    },
    [isLiveConnected, connectionState, startSession, stopSession]
  );

  const clearTranscript = useCallback(() => {
    setLiveTranscript([]);
    setVerifiedUpdates([]);
  }, []);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, [cleanupResources]);

  return {
    isLiveConnected,
    isListening,
    isSpeaking,
    connectionState,
    activeSlot,
    liveTranscript,
    verifiedUpdates,
    audioVolume,
    frequencyBars,
    error,
    startSession,
    stopSession,
    toggleSession,
    clearTranscript
  };
}
