import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import Database, { Database as DatabaseType } from 'better-sqlite3';

import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteProjectEventRepository } from '../src/repositories/project-event.repository.js';
import { createApp, attachLiveSessionWebSocket } from '../src/app.js';
import { GeminiKeyRouter } from '../src/ai/providers/gemini-key-router.js';
import { createLiveToolExecutor } from '../src/ai/live/live-tool-handlers.js';
import { DeterministicActivityResolver } from '../src/services/assistant/activity-resolver.js';
import { DefaultProgressSnapshotService } from '../src/services/snapshot/progress-snapshot.service.js';
import { DefaultProjectIntelligenceService } from '../src/services/intelligence/project-intelligence.service.js';
import { DefaultProgressUpdateService } from '../src/services/progress-update.service.js';
import { ActivityMatchingService } from '../src/services/matching/activity-matching.service.js';
import { DefaultProgressService } from '../src/services/progress/progress.service.js';
import { FieldProgressExtractionService } from '../src/ai/services/field-progress-extraction.service.js';
import { Project, Schedule } from '../src/models/domain.types.js';

describe('Pass 5: End-to-End Gemini Live Smoke & Multi-Key Failover Evaluation', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let activityMatchRepo: SqliteActivityMatchRepository;
  let activityProgressRepo: SqliteActivityProgressRepository;
  let progressUpdateRepo: SqliteProgressUpdateRepository;
  let projectEventRepo: SqliteProjectEventRepository;

  let testProject: Project;
  let testSchedule: Schedule;
  let keyRouter: GeminiKeyRouter;

  let mockGeminiServer: WebSocketServer;
  let mockGeminiPort: number;
  let upstreamSockets: WebSocket[] = [];
  let upstreamMessages: any[][] = [];

  let httpServer: http.Server;
  let httpPort: number;
  let liveWss: WebSocketServer;

  beforeEach(async () => {
    // 1. Isolated DB
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    activityMatchRepo = new SqliteActivityMatchRepository(() => db);
    activityProgressRepo = new SqliteActivityProgressRepository(() => db);
    progressUpdateRepo = new SqliteProgressUpdateRepository(() => db);
    projectEventRepo = new SqliteProjectEventRepository(() => db);

    testProject = projectRepo.create({
      code: 'PRJ-E2E-SMOKE',
      name: 'Mumbai Marine Drive Tunnel Pier Section',
      description: 'Underground tunnel and coastal road pier construction',
      status: 'active'
    });

    testSchedule = scheduleRepo.create({
      projectId: testProject.id,
      name: 'Baseline Master Schedule',
      version: '1.0',
      sourceType: 'manual',
      isBaseline: true
    });

    activityRepo.create({
      scheduleId: testSchedule.id,
      projectId: testProject.id,
      externalId: 'ACT-PIER-12',
      name: 'Pier 12 excavation and soil stabilization',
      wbsCode: '1.2.1',
      location: 'Pier 12',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-15'
    });

    // 2. Setup 20-slot KeyRouter
    const testKeys = Array.from({ length: 20 }, (_, i) => `AIzaSyE2ETestKey_${String(i + 1).padStart(2, '0')}`);
    keyRouter = new GeminiKeyRouter({
      apiKeys: testKeys,
      defaultModel: 'gemini-3.1-flash-live-preview',
      baseCooldownMs: 150,
      tokenLimitPerKey: 55000
    });

    // 3. Mock Upstream Gemini Live Server
    upstreamSockets = [];
    upstreamMessages = [];

    await new Promise<void>((resolve) => {
      mockGeminiServer = new WebSocketServer({ port: 0 }, () => {
        mockGeminiPort = (mockGeminiServer.address() as any).port;
        resolve();
      });
    });

    mockGeminiServer.on('connection', (socket) => {
      const connIndex = upstreamSockets.length;
      upstreamSockets.push(socket);
      upstreamMessages[connIndex] = [];

      socket.on('message', (raw) => {
        try {
          const parsed = JSON.parse(raw.toString());
          upstreamMessages[connIndex].push(parsed);

          if (parsed.setup) {
            socket.send(JSON.stringify({ setupComplete: {} }));
          }

          if (parsed.realtimeInput?.mediaChunks || parsed.realtimeInput?.audio) {
            socket.send(
              JSON.stringify({
                toolCall: {
                  functionCalls: [
                    {
                      id: 'call_e2e_rec_01',
                      name: 'record_field_progress',
                      args: {
                        projectId: testProject.id,
                        rawStatement:
                          'We finished Pier 12 excavation and soil stabilization, 100% complete.'
                      }
                    }
                  ]
                }
              })
            );
          }

          if (parsed.clientContent?.turns) {
            const text = parsed.clientContent.turns[0]?.parts?.[0]?.text || '';
            if (text.includes('System Event: Progress update committed successfully')) {
              const mockAudio = Buffer.from('mock-24khz-verbal-frame').toString('base64');
              socket.send(
                JSON.stringify({
                  serverContent: {
                    modelTurn: {
                      parts: [
                        {
                          inlineData: {
                            mimeType: 'audio/pcm;rate=24000',
                            data: mockAudio
                          }
                        },
                        {
                          text: 'Update verified: Pier 12 excavation and soil stabilization is saved at 100%.'
                        }
                      ]
                    },
                    outputAudioTranscription: {
                      text: 'Update verified: Pier 12 excavation and soil stabilization is saved at 100%.'
                    },
                    turnComplete: true
                  }
                })
              );
            }
          }
        } catch {
          // ignore
        }
      });
    });

    // 4. Mock extraction service deterministic output
    const mockExtraction: FieldProgressExtractionService = {
      extractFromReport: async () => ({
        items: [
          {
            reference: 'Pier 12 excavation and soil stabilization',
            location: 'Pier 12',
            progress_percent: 100,
            status: 'completed'
          }
        ]
      })
    } as unknown as FieldProgressExtractionService;

    const activityResolver = new DeterministicActivityResolver(activityRepo);
    const snapshotService = new DefaultProgressSnapshotService({
      projectRepo,
      activityRepo,
      activityProgressRepo
    });
    const intelligenceService = new DefaultProjectIntelligenceService({
      projectRepo,
      activityRepo,
      activityProgressRepo,
      progressSnapshotService: snapshotService
    });
    const progressUpdateService = new DefaultProgressUpdateService(
      progressUpdateRepo,
      projectRepo
    );
    const matchingService = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo,
      activityRepo,
      activityMatchRepo,
      projectEventRepo
    });
    const progressService = new DefaultProgressService({
      projectRepo,
      progressUpdateRepo,
      activityRepo,
      activityMatchRepo,
      activityProgressRepo
    });

    const toolExecutor = createLiveToolExecutor({
      activityRepo,
      projectRepo,
      activityMatchRepo,
      activityResolver,
      snapshotService,
      intelligenceService,
      extractionService: mockExtraction,
      progressUpdateService,
      matchingService,
      progressService
    });

    // 5. Start Backend Server
    const app = createApp();
    httpServer = http.createServer(app);

    const attachment = attachLiveSessionWebSocket(httpServer, {
      keyRouter,
      projectResolver: projectRepo,
      upstreamEndpointUrl: `ws://127.0.0.1:${mockGeminiPort}`,
      toolExecutor
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
    for (const s of upstreamSockets) {
      if (s.readyState === WebSocket.OPEN) s.close(1000);
    }
    await new Promise<void>((res) => mockGeminiServer.close(() => res()));
    await new Promise<void>((res) => liveWss.close(() => res()));
    await new Promise<void>((res) => httpServer.close(() => res()));
    db.close();
  });

  function connectClient(): Promise<{
    ws: WebSocket;
    messages: any[];
    waitForMessage: (predicate: (msg: any) => boolean, timeoutMs?: number) => Promise<any>;
  }> {
    return new Promise((resolve) => {
      const url = `ws://127.0.0.1:${httpPort}/ws/live-session?projectId=${testProject.id}`;
      const ws = new WebSocket(url);
      const messages: any[] = [];

      const waitForMessage = (predicate: (msg: any) => boolean, timeoutMs: number = 4000): Promise<any> => {
        return new Promise((res, rej) => {
          for (const m of messages) {
            if (predicate(m)) return res(m);
          }
          const timer = setTimeout(() => {
            rej(new Error(`Timed out waiting for message predicate.`));
          }, timeoutMs);

          const listener = (raw: WebSocket.RawData) => {
            try {
              const parsed = JSON.parse(raw.toString());
              if (predicate(parsed)) {
                clearTimeout(timer);
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

      ws.on('message', (raw) => {
        try {
          messages.push(JSON.parse(raw.toString()));
        } catch {
          messages.push(raw.toString());
        }
      });

      ws.on('open', () => resolve({ ws, messages, waitForMessage }));
    });
  }

  it('verifies the full end-to-end speech-to-speech loop with tool invocation, SQLite update and verbal confirmation', async () => {
    const client = await connectClient();

    // 1. Initial status frames
    await client.waitForMessage((m) => m.type === 'status' && m.state === 'ready');
    expect(keyRouter.getCurrentSlot()).toBe('01');

    // 2. Client sends 16kHz PCM audio chunk
    const pcmChunk = Buffer.from('mock-worker-speech-chunk').toString('base64');
    client.ws.send(JSON.stringify({ type: 'audio_chunk', data: pcmChunk }));

    // 3. Client receives verified update notification
    const verifiedEvent = await client.waitForMessage((m) => m.type === 'progress_verified');
    expect(verifiedEvent.activityCode).toBe('ACT-PIER-12');
    expect(verifiedEvent.progressPercent).toBe(100);

    // 4. Client receives 24kHz verbal confirmation audio chunk
    const audioChunk = await client.waitForMessage((m) => m.type === 'audio_chunk' && m.data);
    expect(audioChunk.data).toBe(Buffer.from('mock-24khz-verbal-frame').toString('base64'));

    // 5. Database verification
    const targetActivity = activityRepo.listByProjectId(testProject.id).find((a) => a.externalId === 'ACT-PIER-12')!;
    const latestProgress = activityProgressRepo.getLatestByActivityId(targetActivity.id);
    expect(latestProgress).toBeDefined();
    expect(latestProgress!.actualPercent).toBe(100);
    expect(latestProgress!.status).toBe('completed');

    const updates = progressUpdateRepo.listByProjectId(testProject.id);
    const voiceUpdate = updates.find((u) => u.sourceType === 'voice');
    expect(voiceUpdate).toBeDefined();

    client.ws.close(1000);
  });

  it('verifies multi-key failover stress test: seamless transition to Key 02 with context preservation and zero socket disconnect', async () => {
    const client = await connectClient();
    await client.waitForMessage((m) => m.type === 'status' && m.state === 'ready');

    expect(keyRouter.getCurrentSlot()).toBe('01');
    const upstream0 = upstreamSockets[0];

    // Simulate speech turns so rolling buffer has prior history
    upstream0.send(
      JSON.stringify({
        serverContent: {
          inputAudioTranscription: { text: 'Worker: Pier 12 excavation 100%' },
          outputAudioTranscription: { text: 'Assistant: Recording Pier 12 excavation at 100%.' }
        }
      })
    );
    await client.waitForMessage((m) => m.type === 'output_transcription');

    // Trigger proactive handover via token ceiling (56,000 tokens)
    upstream0.send(
      JSON.stringify({
        usageMetadata: {
          totalTokenCount: 56000,
          promptTokenCount: 6000,
          candidatesTokenCount: 50000
        }
      })
    );

    // 1. Client receives handover status and subsequent ready status on slot 02
    await client.waitForMessage((m) => m.type === 'status' && m.state === 'handover');
    const readySlot02 = await client.waitForMessage((m) => m.type === 'status' && m.state === 'ready' && m.activeSlot === '02');
    expect(readySlot02.activeSlot).toBe('02');

    // 2. CRITICAL INVARIANT: Client socket was NEVER disconnected
    expect(client.ws.readyState).toBe(WebSocket.OPEN);

    // 3. Router advanced atomically to Key 02
    expect(keyRouter.getCurrentSlot()).toBe('02');

    // 4. Upstream socket #2 received context hydration
    expect(upstreamSockets.length).toBe(2);
    const upstream1Msgs = upstreamMessages[1];
    let hydrationTurn: any;
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        hydrationTurn = upstreamMessages[1]?.find((m) => m.clientContent !== undefined);
        if (hydrationTurn) {
          clearInterval(interval);
          resolve();
        }
      }, 20);
    });
    expect(hydrationTurn).toBeDefined();
    const hydrationText = hydrationTurn.clientContent.turns[0].parts[0].text;
    expect(hydrationText).toContain('[Context Hydration]');
    expect(hydrationText).toContain('Pier 12 excavation');

    // 5. Client can continue streaming audio on slot 02 without interruption
    const postHandoverChunk = Buffer.from('post-handover-audio-stream').toString('base64');
    client.ws.send(JSON.stringify({ type: 'audio_chunk', data: postHandoverChunk }));

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Audio not received on upstream 2')), 3000);
      const check = setInterval(() => {
        const received = upstream1Msgs.find(
          (m) => m.realtimeInput && (m.realtimeInput.audio?.data === postHandoverChunk || m.realtimeInput.mediaChunks?.[0]?.data === postHandoverChunk)
        );
        if (received) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 30);
    });

    client.ws.close(1000);
  });
});
