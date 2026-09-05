import http from 'node:http';
import { URL } from 'node:url';
import WebSocket from 'ws';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { GeminiKeyRouter, ActiveSessionKey } from '../providers/gemini-key-router.js';
import { Project } from '../../models/domain.types.js';
import { UpstreamGeminiSocket, LiveFunctionCall, LiveFunctionResponse } from './upstream-gemini-socket.js';
import { RollingConversationBuffer } from './rolling-conversation-buffer.js';
import { buildLiveSystemInstruction } from './live-context-builder.js';
import { createLiveToolExecutor, LiveToolExecutionContext } from './live-tool-handlers.js';

export interface ProjectResolver {
  getById(id: string): Project | null;
  getByCode(code: string): Project | null;
}

export type LiveToolExecutor = (
  projectId: string,
  call: LiveFunctionCall,
  context?: LiveToolExecutionContext
) => Promise<Record<string, any>>;

export interface GeminiLiveGatewayOptions {
  keyRouter?: GeminiKeyRouter;
  projectResolver?: ProjectResolver;
  upstreamEndpointUrl?: string;
  upstreamWsFactory?: (url: string) => WebSocket;
  toolExecutor?: LiveToolExecutor;
}

export class LiveGatewaySession {
  public readonly sessionId: string;
  public readonly clientWs: WebSocket;
  public readonly project: Project;
  private readonly keyRouter: GeminiKeyRouter;
  private readonly rollingBuffer: RollingConversationBuffer;
  private readonly upstreamEndpointUrl?: string;
  private readonly upstreamWsFactory?: (url: string) => WebSocket;
  private readonly toolExecutor?: LiveToolExecutor;

  private currentUpstream: UpstreamGeminiSocket | null = null;
  private activeKey: ActiveSessionKey;
  private lastRecordedTokenCount: number = 0;
  private isHandoverInProgress: boolean = false;
  private isSessionClosed: boolean = false;
  private consecutiveHandoverFailures: number = 0;

  constructor(
    sessionId: string,
    clientWs: WebSocket,
    project: Project,
    keyRouter: GeminiKeyRouter,
    options: {
      upstreamEndpointUrl?: string;
      upstreamWsFactory?: (url: string) => WebSocket;
      toolExecutor?: LiveToolExecutor;
    } = {}
  ) {
    this.sessionId = sessionId;
    this.clientWs = clientWs;
    this.project = project;
    this.keyRouter = keyRouter;
    this.upstreamEndpointUrl = options.upstreamEndpointUrl;
    this.upstreamWsFactory = options.upstreamWsFactory;
    this.toolExecutor = options.toolExecutor;

    const projectSummary = `Project Code: ${project.code}\nProject Name: ${project.name}\nStatus: ${project.status}${project.description ? `\nDescription: ${project.description}` : ''}`;
    this.rollingBuffer = new RollingConversationBuffer({ projectSummary });

    this.activeKey = this.keyRouter.acquireLiveSessionKey();
    this.initSession();
  }

  getActiveKey(): ActiveSessionKey {
    return this.activeKey;
  }

  getCurrentUpstream(): UpstreamGeminiSocket | null {
    return this.currentUpstream;
  }

  getRollingBuffer(): RollingConversationBuffer {
    return this.rollingBuffer;
  }

  private initSession(): void {
    logger.info(
      `LiveGatewaySession [${this.sessionId}]: Booting session for project [${this.project.code}] using Key Slot [${this.activeKey.slot}]`
    );

    this.bootUpstreamSocket(this.activeKey, false);
    this.setupClientListeners();
  }

  private bootUpstreamSocket(sessionKey: ActiveSessionKey, isHandover: boolean = false): UpstreamGeminiSocket {
    const baseInstruction = buildLiveSystemInstruction(this.project);
    const systemInstruction = isHandover
      ? `${baseInstruction}\n\n[SESSION RESUMPTION SUMMARY]\n${this.rollingBuffer.generateHandoverSummary()}\n\nSpeak naturally and maintain conversational flow.`
      : baseInstruction;

    const upstream = new UpstreamGeminiSocket({
      apiKey: sessionKey.apiKey,
      slot: sessionKey.slot,
      keyIndex: sessionKey.index,
      endpointUrl: this.upstreamEndpointUrl,
      wsFactory: this.upstreamWsFactory,
      systemInstruction
    });

    this.attachUpstreamListeners(upstream);
    return upstream;
  }

  private attachUpstreamListeners(upstream: UpstreamGeminiSocket): void {
    upstream.on('open', () => {
      logger.info(
        `LiveGatewaySession [${this.sessionId}]: Upstream connected on Slot [${upstream.slot}].`
      );
      this.sendToClient({
        type: 'status',
        state: 'connected',
        activeSlot: upstream.slot,
        message: `Connected to Gemini Live via Slot ${upstream.slot}`
      });
    });

    upstream.on('setupComplete', () => {
      this.consecutiveHandoverFailures = 0;
      this.keyRouter.recordSuccess(upstream.keyIndex);
      logger.info(`LiveGatewaySession [${this.sessionId}]: Upstream setup completed on Slot [${upstream.slot}].`);
      this.sendToClient({
        type: 'status',
        state: 'ready',
        activeSlot: upstream.slot
      });
    });

    upstream.on('audio', (base64Chunk: string) => {
      if (this.currentUpstream === upstream && !this.isSessionClosed) {
        this.sendToClient({
          type: 'audio_chunk',
          data: base64Chunk
        });
      }
    });

    upstream.on('inputTranscription', (text: string) => {
      if (this.currentUpstream === upstream) {
        this.rollingBuffer.addUserTurn(text);
        this.sendToClient({
          type: 'input_transcription',
          text
        });
      }
    });

    upstream.on('outputTranscription', (text: string) => {
      if (this.currentUpstream === upstream) {
        this.rollingBuffer.addModelTurn(text);
        this.sendToClient({
          type: 'output_transcription',
          text
        });
      }
    });

    upstream.on('interrupted', () => {
      if (this.currentUpstream === upstream) {
        this.sendToClient({
          type: 'interrupted'
        });
      }
    });

    upstream.on('turnComplete', () => {
      if (this.currentUpstream === upstream) {
        this.sendToClient({
          type: 'turn_complete'
        });
      }
    });

    upstream.on('toolCall', async (calls: LiveFunctionCall[]) => {
      if (this.currentUpstream !== upstream) return;
      await this.handleToolCalls(upstream, calls);
    });

    upstream.on('usage', (usage: { totalTokenCount?: number }) => {
      if (typeof usage.totalTokenCount === 'number') {
        const delta = Math.max(0, usage.totalTokenCount - this.lastRecordedTokenCount);
        this.lastRecordedTokenCount = usage.totalTokenCount;

        const usageRecord = this.keyRouter.recordTokenUsage(upstream.keyIndex, delta);
        if (usageRecord.limitExceeded && !this.isHandoverInProgress && !this.isSessionClosed) {
          logger.warn(
            `LiveGatewaySession [${this.sessionId}]: Key slot [${upstream.slot}] reached safety threshold (${usageRecord.totalTokens} tokens). Initiating proactive handover.`
          );
          this.triggerHandover('proactive_token_limit');
        }
      }
    });

    upstream.on('error', (err: Error, isRateLimit: boolean) => {
      logger.warn(
        `LiveGatewaySession [${this.sessionId}]: Upstream error on slot [${upstream.slot}]: ${err.message}`
      );

      this.keyRouter.recordFailure(upstream.keyIndex, err);

      // ONLY trigger handover on 429 rate limit if session is already established
      if (
        (isRateLimit || /429|RESOURCE_EXHAUSTED/i.test(err.message)) &&
        upstream.isSetupComplete &&
        !this.isHandoverInProgress &&
        !this.isSessionClosed
      ) {
        logger.info(
          `LiveGatewaySession [${this.sessionId}]: Rate limit encountered on slot [${upstream.slot}]. Initiating reactive handover.`
        );
        this.triggerHandover('rate_limit_429');
      } else if (!upstream.isSetupComplete && !this.isHandoverInProgress && !this.isSessionClosed) {
        // Initial connection failure: report error and close cleanly without triggering handover
        this.sendToClient({
          type: 'error',
          message: `Failed to initialize Gemini Live on slot [${upstream.slot}]: ${err.message}`
        });
        this.close();
      }
    });

    upstream.on('close', (code: number, reason: string) => {
      // Clean, intentional closure (code 1000) is normal and must not be treated as a failure or handover
      if (code === 1000) {
        logger.info(`LiveGatewaySession [${this.sessionId}]: Upstream on slot [${upstream.slot}] closed normally.`);
        return;
      }

      this.keyRouter.recordFailure(upstream.keyIndex, new Error(`Upstream WebSocket closed (code ${code}): ${reason}`));

      // Non-1000 closure: report disconnection error and close cleanly (no handover unless 429/token ceiling)
      if (this.currentUpstream === upstream && !this.isHandoverInProgress && !this.isSessionClosed) {
        logger.warn(
          `LiveGatewaySession [${this.sessionId}]: Upstream closed unexpectedly (code: ${code}, reason: ${reason}).`
        );
        this.sendToClient({
          type: 'error',
          message: `Gemini Live connection closed on slot [${upstream.slot}] (${reason || `code ${code}`}).`
        });
        this.close();
      }
    });

    this.currentUpstream = upstream;
  }

  private async handleToolCalls(upstream: UpstreamGeminiSocket, calls: LiveFunctionCall[]): Promise<void> {
    const responses: LiveFunctionResponse[] = [];

    for (const call of calls) {
      let output: Record<string, any>;
      try {
        if (this.toolExecutor) {
          output = await this.toolExecutor(this.project.id, call, { session: this });
        } else {
          output = {
            status: 'received',
            callId: call.id,
            tool: call.name,
            message: `Tool ${call.name} executed successfully in live session.`
          };
        }
      } catch (toolErr: any) {
        output = {
          status: 'error',
          callId: call.id,
          message: toolErr.message || 'Tool execution failed'
        };
      }

      responses.push({
        id: call.id,
        response: { output }
      });
    }

    upstream.sendToolResponse(responses);
  }

  private setupClientListeners(): void {
    this.clientWs.on('message', (data: WebSocket.RawData) => {
      this.handleClientMessage(data);
    });

    this.clientWs.on('close', (code: number, reason: Buffer | string) => {
      const reasonStr = typeof reason === 'string' ? reason : reason.toString();
      logger.info(`LiveGatewaySession [${this.sessionId}]: Client disconnected (${code}: "${reasonStr}")`);
      this.close();
    });

    this.clientWs.on('error', (err: Error) => {
      logger.warn(`LiveGatewaySession [${this.sessionId}]: Client socket error: ${err.message}`);
      this.close();
    });
  }

  private handleClientMessage(raw: WebSocket.RawData): void {
    try {
      const text = raw.toString();
      const message = JSON.parse(text);

      switch (message.type) {
        case 'audio_chunk':
          if (message.data && this.currentUpstream && this.currentUpstream.isConnected) {
            this.currentUpstream.sendRealtimeAudio(message.data);
          }
          break;

        case 'text_turn':
          if (message.text && this.currentUpstream && this.currentUpstream.isConnected) {
            this.rollingBuffer.addUserTurn(message.text);
            this.currentUpstream.sendClientContent([
              {
                role: 'user',
                parts: [{ text: message.text }]
              }
            ]);
          }
          break;

        case 'ping':
          this.sendToClient({ type: 'pong', timestamp: Date.now() });
          break;

        default:
          logger.debug(`LiveGatewaySession [${this.sessionId}]: Unknown client message type: ${message.type}`);
      }
    } catch {
      // If raw binary/buffer is sent, assume raw audio
      if (Buffer.isBuffer(raw) && this.currentUpstream && this.currentUpstream.isConnected) {
        this.currentUpstream.sendRealtimeAudio(raw.toString('base64'));
      }
    }
  }

  /**
   * Executes seamless key handover to Key N+1 without dropping the client connection.
   */
  async triggerHandover(reason: string = 'token_or_rate_limit'): Promise<void> {
    if (this.isHandoverInProgress || this.isSessionClosed) return;

    const totalSlots = this.keyRouter.getKeyHealthSnapshots().length;
    if (this.consecutiveHandoverFailures >= totalSlots) {
      logger.error(
        `LiveGatewaySession [${this.sessionId}]: All ${totalSlots} key slots failed or lacked permissions. Aborting handover loop.`
      );
      this.sendToClient({
        type: 'error',
        message: 'All configured Gemini API keys failed or lack Live API permissions. Please verify API keys.'
      });
      return;
    }

    this.isHandoverInProgress = true;

    const previousKeyIndex = this.activeKey.index;
    const previousSlot = this.activeKey.slot;

    logger.info(
      `LiveGatewaySession [${this.sessionId}]: Executing seamless handover from Slot [${previousSlot}] (Reason: ${reason})...`
    );

    this.sendToClient({
      type: 'status',
      state: 'handover',
      message: `Seamless session handover in progress (from Slot ${previousSlot})...`
    });

    try {
      // 1. Atomically rotate to next healthy key
      this.activeKey = this.keyRouter.rotateToNextKey(previousKeyIndex, reason);
      this.lastRecordedTokenCount = 0;

      // 2. Boot new upstream socket with Key N+1 hydrated with context summary
      const oldUpstream = this.currentUpstream;
      const newUpstream = this.bootUpstreamSocket(this.activeKey, true);

      // 3. Wait for new upstream socket to open and confirm setup
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Upstream setup timed out on slot [${this.activeKey.slot}]`));
        }, 6000);

        newUpstream.once('setupComplete', () => {
          clearTimeout(timeout);
          resolve();
        });

        newUpstream.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        newUpstream.once('close', (code, reason) => {
          clearTimeout(timeout);
          reject(new Error(`Upstream closed before setup completed: code=${code}, reason=${reason}`));
        });
      });

      // 4. Ingest recent conversation history as initial turns
      const handoverSummary = this.rollingBuffer.generateHandoverSummary();
      newUpstream.sendClientContent(
        [
          {
            role: 'user',
            parts: [{ text: `[Context Hydration]\n${handoverSummary}` }]
          },
          {
            role: 'model',
            parts: [{ text: 'Understood. Continuing active field session.' }]
          }
        ],
        true
      );

      // 5. Swap active pointer and gracefully close old upstream socket
      this.currentUpstream = newUpstream;
      if (oldUpstream && oldUpstream !== newUpstream) {
        try {
          oldUpstream.close(1000, 'Handover complete');
        } catch {}
      }

      this.isHandoverInProgress = false;

      logger.info(
        `LiveGatewaySession [${this.sessionId}]: Seamless handover complete! Active key is now Slot [${this.activeKey.slot}].`
      );

      this.sendToClient({
        type: 'status',
        state: 'ready',
        activeSlot: this.activeKey.slot,
        message: `Session handover complete. Active slot: ${this.activeKey.slot}`
      });
    } catch (handoverErr: any) {
      this.isHandoverInProgress = false;
      this.consecutiveHandoverFailures++;
      logger.error(
        `LiveGatewaySession [${this.sessionId}]: Handover failed: ${handoverErr.message}`
      );
      this.keyRouter.recordFailure(this.activeKey.index, handoverErr);

      this.sendToClient({
        type: 'error',
        message: `Handover to slot [${this.activeKey.slot}] failed: ${handoverErr.message}`
      });
      this.close();
    }
  }

  /**
   * Dispatches a verbal confirmation prompt or high-priority system turn to Gemini Live.
   * Prompts Gemini Live to speak the verbal verification announcement to the worker.
   */
  dispatchVerbalConfirmation(systemEventText: string): void {
    this.rollingBuffer.addSystemEvent(systemEventText);
    if (this.currentUpstream && this.currentUpstream.isConnected) {
      this.currentUpstream.sendClientContent(
        [
          {
            role: 'user',
            parts: [{ text: systemEventText }]
          }
        ],
        true
      );
    }
  }

  sendToClient(payload: Record<string, any>): void {
    if (this.clientWs.readyState === WebSocket.OPEN) {
      try {
        this.clientWs.send(JSON.stringify(payload));
      } catch (err: any) {
        logger.warn(`LiveGatewaySession [${this.sessionId}]: Failed to send to client: ${err.message}`);
      }
    }
  }

  close(): void {
    if (this.isSessionClosed) return;
    this.isSessionClosed = true;

    if (this.currentUpstream) {
      this.currentUpstream.close(1000, 'Session terminated');
      this.currentUpstream = null;
    }

    if (this.clientWs.readyState === WebSocket.OPEN) {
      try {
        this.clientWs.close(1000, 'Session closed');
      } catch {
        // Ignore close errors
      }
    }

    this.rollingBuffer.clear();
  }
}


export class GeminiLiveGateway {
  private readonly keyRouter: GeminiKeyRouter;
  private readonly projectResolver?: ProjectResolver;
  private readonly toolExecutor?: LiveToolExecutor;
  private readonly options: GeminiLiveGatewayOptions;
  private readonly activeSessions: Map<string, LiveGatewaySession> = new Map();

  constructor(options: GeminiLiveGatewayOptions = {}) {
    this.options = options;
    this.projectResolver = options.projectResolver;
    this.toolExecutor = options.toolExecutor;

    if (options.keyRouter) {
      this.keyRouter = options.keyRouter;
    } else {
      const keys =
        env.geminiApiKeys && env.geminiApiKeys.length > 0
          ? env.geminiApiKeys
          : [env.GEMINI_API_KEY || 'mock-fallback-key-01'];
      this.keyRouter = new GeminiKeyRouter({
        apiKeys: keys,
        defaultModel: env.GEMINI_LIVE_MODEL,
        tokenLimitPerKey: env.GEMINI_LIVE_TOKEN_LIMIT_PER_KEY
      });
    }
  }

  getKeyRouter(): GeminiKeyRouter {
    return this.keyRouter;
  }

  getActiveSessionsCount(): number {
    return this.activeSessions.size;
  }

  getSession(sessionId: string): LiveGatewaySession | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Returns all active live sessions for a given project (by ID or code).
   */
  getSessionsForProject(projectIdOrCode: string): LiveGatewaySession[] {
    const matched: LiveGatewaySession[] = [];
    for (const session of this.activeSessions.values()) {
      if (session.project.id === projectIdOrCode || session.project.code === projectIdOrCode) {
        matched.push(session);
      }
    }
    return matched;
  }


  /**
   * Handles incoming client WebSocket connection.
   * Validates `projectId` query parameter and verifies project existence in database.
   */
  handleClientConnection(clientWs: WebSocket, req: http.IncomingMessage): void {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const projectIdParam = parsedUrl.searchParams.get('projectId');

    if (!projectIdParam || projectIdParam.trim().length === 0) {
      logger.warn('GeminiLiveGateway: Client connection rejected: Missing required "projectId" query parameter.');
      clientWs.send(
        JSON.stringify({
          type: 'error',
          message: 'Connection rejected: Missing required "projectId" query parameter in WebSocket URL.'
        })
      );
      clientWs.close(4400, 'Missing projectId');
      return;
    }

    const trimmedParam = projectIdParam.trim();
    let project: Project | null = null;
    if (this.projectResolver) {
      try {
        project = this.projectResolver.getById(trimmedParam) || this.projectResolver.getByCode(trimmedParam);
      } catch (dbErr: any) {
        logger.error(`GeminiLiveGateway: Project lookup failed for project [${trimmedParam}]: ${dbErr.message}`);
      }
    }

    if (!project) {
      logger.warn(`GeminiLiveGateway: Client connection rejected: Project [${trimmedParam}] not found.`);
      clientWs.send(
        JSON.stringify({
          type: 'error',
          message: `Connection rejected: Project "${trimmedParam}" does not exist.`
        })
      );
      clientWs.close(4404, 'Project not found');
      return;
    }

    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const session = new LiveGatewaySession(sessionId, clientWs, project, this.keyRouter, {
      upstreamEndpointUrl: this.options.upstreamEndpointUrl,
      upstreamWsFactory: this.options.upstreamWsFactory,
      toolExecutor: this.toolExecutor
    });

    this.activeSessions.set(sessionId, session);

    clientWs.on('close', () => {
      this.activeSessions.delete(sessionId);
    });
  }

  closeAllSessions(): void {
    for (const session of this.activeSessions.values()) {
      session.close();
    }
    this.activeSessions.clear();
  }
}
