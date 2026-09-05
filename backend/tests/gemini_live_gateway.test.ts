import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { createApp, attachLiveSessionWebSocket } from '../src/app.js';
import { GeminiKeyRouter } from '../src/ai/providers/gemini-key-router.js';
import { Project } from '../src/models/domain.types.js';

describe('Gemini Live Gateway & Upstream Bidi Engine (Pass 2)', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let testProject: Project;
  let keyRouter: GeminiKeyRouter;

  // Mock upstream Google Gemini server
  let mockGeminiServer: WebSocketServer;
  let mockGeminiPort: number;
  let upstreamConnections: WebSocket[] = [];
  let upstreamReceivedMessages: any[][] = [];

  // Main HTTP server + Live Gateway
  let httpServer: http.Server;
  let httpPort: number;
  let liveWss: WebSocketServer;

  beforeEach(async () => {
    // 1. Setup in-memory database and test project
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    projectRepo = new SqliteProjectRepository(() => db);

    testProject = projectRepo.create({
      code: 'PRJ-LIVE-01',
      name: 'Delhi-Mumbai Expressway Pier Segment',
      description: 'Major precast segmental construction',
      status: 'active'
    });

    // 2. Setup 20-slot GeminiKeyRouter for testing
    const testKeys = Array.from({ length: 5 }, (_, i) => `AIzaSyTestGeminiKey_${String(i + 1).padStart(2, '0')}`);
    keyRouter = new GeminiKeyRouter({
      apiKeys: testKeys,
      defaultModel: 'gemini-3.1-flash-live-preview',
      baseCooldownMs: 100,
      tokenLimitPerKey: 50000
    });

    // 3. Start Mock Upstream Gemini Live WebSocket Server
    upstreamConnections = [];
    upstreamReceivedMessages = [];

    await new Promise<void>((resolve) => {
      mockGeminiServer = new WebSocketServer({ port: 0 }, () => {
        mockGeminiPort = (mockGeminiServer.address() as any).port;
        resolve();
      });
    });

    mockGeminiServer.on('connection', (socket) => {
      const connIndex = upstreamConnections.length;
      upstreamConnections.push(socket);
      upstreamReceivedMessages[connIndex] = [];

      socket.on('message', (raw) => {
        try {
          const parsed = JSON.parse(raw.toString());
          upstreamReceivedMessages[connIndex].push(parsed);

          // Automatically respond to setup frame with setupComplete
          if (parsed.setup) {
            socket.send(JSON.stringify({ setupComplete: {} }));
          }
        } catch {
          // ignore
        }
      });
    });

    // 4. Start HTTP Server with Gemini Live Gateway attached
    const app = createApp();
    httpServer = http.createServer(app);

    const attachment = attachLiveSessionWebSocket(httpServer, {
      keyRouter,
      projectResolver: projectRepo,
      upstreamEndpointUrl: `ws://127.0.0.1:${mockGeminiPort}`
    });
    liveWss = attachment.wss;

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        httpPort = (httpServer.address() as any).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    // Close mock upstream connections
    for (const ws of upstreamConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    await new Promise<void>((resolve) => mockGeminiServer.close(() => resolve()));

    // Close HTTP and gateway server
    await new Promise<void>((resolve) => liveWss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));

    // Close in-memory DB
    if (db) {
      db.close();
    }
  });

  // Helper to connect a client WebSocket and collect events
  function connectClient(projectId?: string): Promise<{
    ws: WebSocket;
    messages: any[];
    closeEvent: { code: number; reason: string } | null;
    waitForMessage: (predicate: (msg: any) => boolean, timeoutMs?: number) => Promise<any>;
  }> {
    return new Promise((resolve) => {
      const query = projectId !== undefined ? `?projectId=${projectId}` : '';
      const url = `ws://127.0.0.1:${httpPort}/ws/live-session${query}`;
      const ws = new WebSocket(url);
      const messages: any[] = [];
      let closeEvent: { code: number; reason: string } | null = null;

      const waitForMessage = (predicate: (msg: any) => boolean, timeoutMs: number = 3000): Promise<any> => {
        return new Promise((res, rej) => {
          // Check existing messages first
          for (const m of messages) {
            if (predicate(m)) return res(m);
          }

          const timeout = setTimeout(() => {
            rej(new Error(`Timed out after ${timeoutMs}ms waiting for matching message.`));
          }, timeoutMs);

          const listener = (data: WebSocket.RawData) => {
            try {
              const parsed = JSON.parse(data.toString());
              if (predicate(parsed)) {
                clearTimeout(timeout);
                ws.off('message', listener);
                res(parsed);
              }
            } catch {
              // ignore
            }
          };

          ws.on('message', listener);
        });
      };

      ws.on('message', (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          messages.push(data.toString());
        }
      });

      ws.on('close', (code, reason) => {
        closeEvent = { code, reason: reason.toString() };
      });

      ws.on('open', () => {
        resolve({ ws, messages, closeEvent, waitForMessage });
      });

      // Handle cases where socket closes during handshake (e.g. 4400/4404)
      ws.on('error', () => {
        resolve({ ws, messages, closeEvent, waitForMessage });
      });
    });
  }

  describe('1. Gateway Client Connection & Query Parameter Validation', () => {
    it('should reject client connection if projectId is missing', async () => {
      const client = await connectClient(undefined);

      const err = await client.waitForMessage((m) => m.type === 'error');
      expect(err.message).toContain('Missing required "projectId" query parameter');

      await new Promise((r) => setTimeout(r, 100));
      expect(client.ws.readyState).toBe(WebSocket.CLOSED);
    });

    it('should reject client connection if projectId does not exist in database', async () => {
      const client = await connectClient('NON_EXISTENT_PROJECT_999');

      const err = await client.waitForMessage((m) => m.type === 'error');
      expect(err.message).toContain('does not exist');

      await new Promise((r) => setTimeout(r, 100));
      expect(client.ws.readyState).toBe(WebSocket.CLOSED);
    });

    it('should accept client connection with valid project code and send initial status frames', async () => {
      const client = await connectClient(testProject.code);

      const connectedStatus = await client.waitForMessage((m) => m.type === 'status' && m.state === 'connected');
      expect(connectedStatus.activeSlot).toBe('01');

      const readyStatus = await client.waitForMessage((m) => m.type === 'status' && m.state === 'ready');
      expect(readyStatus.activeSlot).toBe('01');

      client.ws.close();
    });

    it('should accept client connection using project ID instead of code', async () => {
      const client = await connectClient(testProject.id);

      const readyStatus = await client.waitForMessage((m) => m.type === 'status' && m.state === 'ready');
      expect(readyStatus.activeSlot).toBe('01');

      client.ws.close();
    });
  });

  describe('2. Upstream Gemini Setup & Initial Frame Verification', () => {
    it('should send correctly structured Gemini Multimodal Live setup frame to upstream socket', async () => {
      const client = await connectClient(testProject.code);
      await client.waitForMessage((m) => m.type === 'status' && m.state === 'ready');

      expect(upstreamConnections.length).toBe(1);
      const firstConnectionMessages = upstreamReceivedMessages[0];
      const setupMessage = firstConnectionMessages.find((m) => m.setup !== undefined);

      expect(setupMessage).toBeDefined();
      expect(setupMessage.setup.model).toBe('models/gemini-3.1-flash-live-preview');
      expect(setupMessage.setup.generationConfig.responseModalities).toEqual(['AUDIO']);
      expect(setupMessage.setup.inputAudioTranscription).toBeDefined();
      expect(setupMessage.setup.outputAudioTranscription).toBeDefined();

      // System instruction includes persona and "Pardon Me" protocol
      const systemInstruction = setupMessage.setup.systemInstruction.parts[0].text;
      expect(systemInstruction).toContain('Pardon Me');
      expect(systemInstruction).toContain('FieldLine');

      // Tools declarations include the three required functions
      const toolDeclarations = setupMessage.setup.tools[0].functionDeclarations;
      const toolNames = toolDeclarations.map((t: any) => t.name);
      expect(toolNames).toContain('get_next_recommended_activities');
      expect(toolNames).toContain('lookup_activity_status');
      expect(toolNames).toContain('record_field_progress');

      client.ws.close();
    });
  });

  describe('3. Bidirectional Protocol Message Routing', () => {
    it('should forward client audio chunks (16kHz Base64) to upstream as realtimeInput.mediaChunks', async () => {
      const client = await connectClient(testProject.code);
      await client.waitForMessage((m) => m.type === 'status' && m.state === 'ready');

      const mockAudioBase64 = Buffer.from('mock-16k-audio-pcm-data').toString('base64');
      client.ws.send(JSON.stringify({ type: 'audio_chunk', data: mockAudioBase64 }));

      // Wait for upstream to receive realtimeInput
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          const received = upstreamReceivedMessages[0].find((m) => m.realtimeInput !== undefined);
          if (received) {
            clearInterval(interval);
            const audioPayload = received.realtimeInput.audio || received.realtimeInput.mediaChunks?.[0];
            expect(audioPayload.mimeType).toBe('audio/pcm;rate=16000');
            expect(audioPayload.data).toBe(mockAudioBase64);
            resolve();
          }
        }, 20);
      });

      client.ws.close();
    });

    it('should forward upstream audio chunks (24kHz Base64) to client as audio_chunk', async () => {
      const client = await connectClient(testProject.code);
      await client.waitForMessage((m) => m.type === 'status' && m.state === 'ready');

      const mockOutputAudioBase64 = Buffer.from('mock-24k-gemini-speech').toString('base64');
      const upstreamSocket = upstreamConnections[0];

      // Simulate Gemini Live sending audio turn
      upstreamSocket.send(
        JSON.stringify({
          serverContent: {
            modelTurn: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/pcm;rate=24000',
                    data: mockOutputAudioBase64
                  }
                }
              ]
            }
          }
        })
      );

      const clientAudio = await client.waitForMessage((m) => m.type === 'audio_chunk');
      expect(clientAudio.data).toBe(mockOutputAudioBase64);

      client.ws.close();
    });

    it('should route worker transcription and model speech transcription to client and rolling buffer', async () => {
      const client = await connectClient(testProject.code);
      await client.waitForMessage((m) => m.type === 'status' && m.state === 'ready');

      const upstreamSocket = upstreamConnections[0];

      // 1. Simulate worker speech transcript
      upstreamSocket.send(
        JSON.stringify({
          serverContent: {
            inputAudioTranscription: { text: 'We finished casting Pier 12' }
          }
        })
      );

      const inputMsg = await client.waitForMessage((m) => m.type === 'input_transcription');
      expect(inputMsg.text).toBe('We finished casting Pier 12');

      // 2. Simulate Gemini speech transcript
      upstreamSocket.send(
        JSON.stringify({
          serverContent: {
            outputAudioTranscription: { text: 'Understood, logging Pier 12 progress.' }
          }
        })
      );

      const outputMsg = await client.waitForMessage((m) => m.type === 'output_transcription');
      expect(outputMsg.text).toBe('Understood, logging Pier 12 progress.');

      client.ws.close();
    });

    it('should route turnComplete and interrupted events to client', async () => {
      const client = await connectClient(testProject.code);
      await client.waitForMessage((m) => m.type === 'status' && m.state === 'ready');

      const upstreamSocket = upstreamConnections[0];

      // Send interrupted (barge-in)
      upstreamSocket.send(JSON.stringify({ serverContent: { interrupted: true } }));
      const interruptedMsg = await client.waitForMessage((m) => m.type === 'interrupted');
      expect(interruptedMsg).toBeDefined();

      // Send turnComplete
      upstreamSocket.send(JSON.stringify({ serverContent: { turnComplete: true } }));
      const turnCompleteMsg = await client.waitForMessage((m) => m.type === 'turn_complete');
      expect(turnCompleteMsg).toBeDefined();

      client.ws.close();
    });

    it('should respond to client ping with pong', async () => {
      const client = await connectClient(testProject.code);
      await client.waitForMessage((m) => m.type === 'status' && m.state === 'ready');

      client.ws.send(JSON.stringify({ type: 'ping' }));
      const pongMsg = await client.waitForMessage((m) => m.type === 'pong');
      expect(pongMsg.timestamp).toBeDefined();

      client.ws.close();
    });
  });

  describe('4. Tool Call Execution & Response Loop', () => {
    it('should receive upstream toolCall, execute default handler, and return toolResponse', async () => {
      const client = await connectClient(testProject.code);
      await client.waitForMessage((m) => m.type === 'status' && m.state === 'ready');

      const upstreamSocket = upstreamConnections[0];

      // Upstream sends function call
      upstreamSocket.send(
        JSON.stringify({
          toolCall: {
            functionCalls: [
              {
                id: 'call_test_001',
                name: 'record_field_progress',
                args: {
                  projectId: testProject.id,
                  rawStatement: 'Excavation done on Pier 12'
                }
              }
            ]
          }
        })
      );

      // Verify that gateway replies with toolResponse
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          const resp = upstreamReceivedMessages[0].find((m) => m.toolResponse !== undefined);
          if (resp) {
            clearInterval(interval);
            expect(resp.toolResponse.functionResponses[0].id).toBe('call_test_001');
            expect(resp.toolResponse.functionResponses[0].response.output.status).toBe('received');
            resolve();
          }
        }, 20);
      });

      client.ws.close();
    });
  });

  describe('5. Seamless Multi-Key Handover Engine', () => {
    it('should execute seamless handover on 429 rate limit without disconnecting browser client', async () => {
      const client = await connectClient(testProject.code);
      await client.waitForMessage((m) => m.type === 'status' && m.state === 'ready');

      expect(keyRouter.getCurrentSlot()).toBe('01');
      const initialUpstream = upstreamConnections[0];

      // Simulate speech history so rolling buffer has context
      initialUpstream.send(
        JSON.stringify({
          serverContent: {
            inputAudioTranscription: { text: 'Worker: Pier 12 is at 80%' },
            outputAudioTranscription: { text: 'Assistant: Got it, logging 80%.' }
          }
        })
      );
      await client.waitForMessage((m) => m.type === 'output_transcription');

      // Now simulate 429 RESOURCE_EXHAUSTED error from upstream Key 01
      initialUpstream.send(
        JSON.stringify({
          error: {
            code: 429,
            message: 'RESOURCE_EXHAUSTED: Rate limit exceeded for default project.'
          }
        })
      );

      // Client should receive handover status notification
      const handoverStatus = await client.waitForMessage((m) => m.type === 'status' && m.state === 'handover');
      expect(handoverStatus).toBeDefined();

      // Client should subsequently receive ready status on Slot 02
      const postHandoverReady = await client.waitForMessage((m) => m.type === 'status' && m.state === 'ready' && m.activeSlot === '02');
      expect(postHandoverReady.activeSlot).toBe('02');

      // Verify KeyRouter advanced to Slot 02
      expect(keyRouter.getCurrentSlot()).toBe('02');

      // CRITICAL INVARIANT: The browser client socket remained OPEN throughout handover!
      expect(client.ws.readyState).toBe(WebSocket.OPEN);

      // Verify a new upstream connection (Key 02) was opened
      expect(upstreamConnections.length).toBe(2);

      // Verify context summary was injected into the new upstream session
      let contextInjection: any;
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          contextInjection = upstreamReceivedMessages[1]?.find((m) => m.clientContent !== undefined);
          if (contextInjection) {
            clearInterval(interval);
            resolve();
          }
        }, 20);
      });
      expect(contextInjection).toBeDefined();
      expect(contextInjection.clientContent.turns[0].parts[0].text).toContain('Context Hydration');
      expect(contextInjection.clientContent.turns[0].parts[0].text).toContain('Pier 12 is at 80%');

      // Verify client can still send audio to the new connection
      const newAudioBase64 = Buffer.from('audio-after-handover').toString('base64');
      client.ws.send(JSON.stringify({ type: 'audio_chunk', data: newAudioBase64 }));

      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          const received = upstreamReceivedMessages[1].find(
            (m) => m.realtimeInput && (m.realtimeInput.audio?.data === newAudioBase64 || m.realtimeInput.mediaChunks?.[0]?.data === newAudioBase64)
          );
          if (received) {
            clearInterval(interval);
            resolve();
          }
        }, 20);
      });

      client.ws.close();
    });

    it('should proactively trigger seamless handover when token usage reaches safety threshold', async () => {
      const client = await connectClient(testProject.code);
      await client.waitForMessage((m) => m.type === 'status' && m.state === 'ready');

      const initialUpstream = upstreamConnections[0];

      // Simulate upstream sending usageMetadata that exceeds the 50,000 threshold
      initialUpstream.send(
        JSON.stringify({
          usageMetadata: {
            totalTokenCount: 52000,
            promptTokenCount: 2000,
            candidatesTokenCount: 50000
          }
        })
      );

      // Client should receive handover status and then ready status on next slot
      await client.waitForMessage((m) => m.type === 'status' && m.state === 'handover');
      const postHandover = await client.waitForMessage((m) => m.type === 'status' && m.state === 'ready' && m.activeSlot === '02');
      expect(postHandover.activeSlot).toBe('02');

      // Client socket remains uninterrupted
      expect(client.ws.readyState).toBe(WebSocket.OPEN);

      client.ws.close();
    });
  });
});
