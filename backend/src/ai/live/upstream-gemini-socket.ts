import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';

export interface LiveFunctionCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface LiveFunctionResponse {
  id: string;
  response: {
    output: Record<string, any>;
  };
}

export interface UpstreamGeminiSocketOptions {
  apiKey: string;
  slot?: string;
  keyIndex?: number;
  model?: string;
  endpointUrl?: string;
  systemInstruction?: string;
  wsFactory?: (url: string) => WebSocket;
}

export const DEFAULT_GEMINI_LIVE_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'get_project_intelligence',
        description:
          'Retrieve comprehensive real-time project intelligence from the SQLite database: overall schedule progress, variance, list of all delayed activities with root causes, at-risk activities, approaching milestones, and recent events.',
        parameters: {
          type: 'OBJECT',
          properties: {
            projectId: {
              type: 'STRING',
              description: 'The unique ID or code of the active project (UUID or code like REFINERY-U4).'
            }
          },
          required: ['projectId']
        }
      },
      {
        name: 'get_next_recommended_activities',
        description:
          'Retrieve the next prioritized recommended activities scheduled for the project, optionally filtered by site location.',
        parameters: {
          type: 'OBJECT',
          properties: {
            projectId: {
              type: 'STRING',
              description: 'The unique ID or code of the active project.'
            },
            location: {
              type: 'STRING',
              description: 'Optional site location, zone, or sector filter (e.g. "Pier 12", "Block B").'
            }
          },
          required: ['projectId']
        }
      },
      {
        name: 'lookup_activity_status',
        description:
          'Look up the verified planned/actual progress, variance state, and delays for a specific activity by its code or descriptive name.',
        parameters: {
          type: 'OBJECT',
          properties: {
            projectId: {
              type: 'STRING',
              description: 'The unique ID or code of the active project.'
            },
            query: {
              type: 'STRING',
              description: 'Activity code or descriptive name to search (e.g. "ACT-012" or "Pier 12 excavation").'
            }
          },
          required: ['projectId', 'query']
        }
      },
      {
        name: 'search_project_activities',
        description:
          'Search, filter, or list activities in the project database by keyword, status ("not_started", "in_progress", "completed", "all"), location, or overdue status.',
        parameters: {
          type: 'OBJECT',
          properties: {
            projectId: {
              type: 'STRING',
              description: 'The unique ID or code of the active project (UUID or code like REFINERY-U4).'
            },
            query: {
              type: 'STRING',
              description: 'Optional search keyword, activity code, or descriptive name.'
            },
            status: {
              type: 'STRING',
              description: 'Optional status filter: "not_started", "in_progress", "completed", or "all".'
            },
            location: {
              type: 'STRING',
              description: 'Optional location or sector filter.'
            },
            limit: {
              type: 'INTEGER',
              description: 'Maximum activities to return (default 10, max 25).'
            }
          },
          required: ['projectId']
        }
      },
      {
        name: 'record_field_progress',
        description:
          'Record a verbal progress report from a site worker for asynchronous parsing, extraction, schedule linking, and database commit.',
        parameters: {
          type: 'OBJECT',
          properties: {
            projectId: {
              type: 'STRING',
              description: 'The unique ID or code of the active project.'
            },
            rawStatement: {
              type: 'STRING',
              description: 'The worker\'s exact verbal statement describing work completed, quantities, or milestones.'
            }
          },
          required: ['projectId', 'rawStatement']
        }
      },
      {
        name: 'query_project_assistant',
        description:
          'Ask an analytical or schedule question about the project to query verified facts from the SQLite database.',
        parameters: {
          type: 'OBJECT',
          properties: {
            projectId: {
              type: 'STRING',
              description: 'The unique ID or code of the active project.'
            },
            question: {
              type: 'STRING',
              description: 'The question regarding the project schedule, delays, or metrics.'
            }
          },
          required: ['projectId', 'question']
        }
      }
    ]
  }
];

export const DEFAULT_LIVE_SYSTEM_INSTRUCTION = `You are FieldLine Voice Assistant, an intelligent speech-to-speech project management assistant for construction and civil infrastructure job sites.
You assist site engineers, foremen, and field workers who interact via hands-free headsets.

CORE OPERATIONAL RULES:
1. AUDIO-FIRST & CONCISE: Speak conversationally, clearly, and concisely. Keep spoken responses under 2-3 sentences unless detailed technical schedule data is requested.
2. ACCENT & SITE NOISE ("Pardon Me" Protocol): Construction environments are loud. If any activity code, pier/block number, or quantity is muffled, phonetically unclear, or ambiguous, ask politely for clarification (e.g., "Pardon me, did you mean Pier 12 or Pier 20?"). NEVER guess, hallucinate, or fabricate unconfirmed numbers.
3. PROGRESS REPORTING: When a worker reports completed or updated work, immediately invoke the 'record_field_progress' tool with their exact statement and acknowledge receipt verbally.
4. QUERIES & LOOKUPS: When a worker asks what to do next or queries task status, invoke 'get_next_recommended_activities' or 'lookup_activity_status' to query the project schedule database.
5. PROFESSIONAL INDUSTRIAL PERSONA: Be helpful, accurate, calm, and safety-conscious.`;

export class UpstreamGeminiSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly apiKey: string;
  public readonly slot: string;
  public readonly keyIndex: number;
  private readonly model: string;
  private readonly endpointUrl: string;
  private readonly systemInstructionText: string;
  private isConfigured: boolean = false;
  private isClosed: boolean = false;

  constructor(options: UpstreamGeminiSocketOptions) {
    super();
    this.apiKey = options.apiKey;
    this.slot = options.slot || '01';
    this.keyIndex = options.keyIndex ?? 0;
    this.model = options.model || env.GEMINI_LIVE_MODEL;

    const baseEndpoint =
      options.endpointUrl ||
      `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
    this.endpointUrl = baseEndpoint;

    this.systemInstructionText = options.systemInstruction || DEFAULT_LIVE_SYSTEM_INSTRUCTION;

    this.connect(options.wsFactory);
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  get isSetupComplete(): boolean {
    return this.isConfigured;
  }

  private connect(wsFactory?: (url: string) => WebSocket): void {
    try {
      if (wsFactory) {
        this.ws = wsFactory(this.endpointUrl);
      } else {
        this.ws = new WebSocket(this.endpointUrl);
      }

      this.ws.on('open', () => {
        logger.info(`UpstreamGeminiSocket [Slot ${this.slot}]: WebSocket opened. Sending setup frame...`);
        this.sendSetupFrame();
        this.emit('open');
      });

      this.ws.on('message', (data: WebSocket.RawData) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (err: Error) => {
        const msg = err.message || String(err);
        const isRateLimit = /429|RESOURCE_EXHAUSTED|quota/i.test(msg);
        logger.warn(`UpstreamGeminiSocket [Slot ${this.slot}]: Error: ${msg}`);
        this.emit('error', err, isRateLimit);
      });

      this.ws.on('close', (code: number, reason: Buffer | string) => {
        const reasonStr = typeof reason === 'string' ? reason : reason.toString();
        logger.info(`UpstreamGeminiSocket [Slot ${this.slot}]: Closed (code: ${code}, reason: "${reasonStr}")`);
        this.isConfigured = false;
        this.isClosed = true;
        this.emit('close', code, reasonStr);
      });
    } catch (err: any) {
      logger.error(`UpstreamGeminiSocket [Slot ${this.slot}]: Connection failed: ${err.message}`);
      this.emit('error', err, false);
    }
  }

  /**
   * Sends initial setup frame configuring Gemini Live session.
   */
  private sendSetupFrame(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const setupPayload = {
      setup: {
        model: `models/${this.model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Puck'
              }
            }
          }
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: {
          parts: [
            {
              text: this.systemInstructionText
            }
          ]
        },
        tools: DEFAULT_GEMINI_LIVE_TOOLS
      }
    };

    this.ws.send(JSON.stringify(setupPayload));
  }

  /**
   * Parses incoming frames from Google Gemini Multimodal Live API.
   */
  private handleMessage(raw: WebSocket.RawData): void {
    try {
      const text = raw.toString();
      const message = JSON.parse(text);

      // 1. Session Setup Acknowledgment
      if (message.setupComplete !== undefined) {
        this.isConfigured = true;
        logger.info(`UpstreamGeminiSocket [Slot ${this.slot}]: Setup complete acknowledged by Gemini Live.`);
        this.emit('setupComplete');
        return;
      }

      // 2. Server Content (Audio output, Transcriptions, Turn status)
      if (message.serverContent) {
        const sc = message.serverContent;

        // Model audio turn
        if (sc.modelTurn && Array.isArray(sc.modelTurn.parts)) {
          for (const part of sc.modelTurn.parts) {
            // 24kHz Base64 PCM audio chunk
            if (part.inlineData && part.inlineData.data) {
              this.emit('audio', part.inlineData.data);
            }
            // Model textual speech transcription
            if (part.text) {
              this.emit('outputTranscription', part.text);
            }
          }
        }

        // Worker speech transcription
        const inputTranscript =
          sc.inputAudioTranscription?.text ??
          sc.inputTranscription?.text ??
          (typeof sc.inputTranscription === 'string' ? sc.inputTranscription : undefined);
        if (inputTranscript) {
          this.emit('inputTranscription', inputTranscript);
        }

        // Gemini speech transcription
        const outputTranscript =
          sc.outputAudioTranscription?.text ??
          sc.outputTranscription?.text ??
          (typeof sc.outputTranscription === 'string' ? sc.outputTranscription : undefined);
        if (outputTranscript) {
          this.emit('outputTranscription', outputTranscript);
        }

        // Barge-in interruption detected
        if (sc.interrupted) {
          logger.debug(`UpstreamGeminiSocket [Slot ${this.slot}]: Interruption detected.`);
          this.emit('interrupted');
        }

        // Turn completed
        if (sc.turnComplete) {
          this.emit('turnComplete');
        }
      }

      // 3. Tool Calls (Function execution requested by Gemini Live)
      if (message.toolCall && Array.isArray(message.toolCall.functionCalls)) {
        const calls: LiveFunctionCall[] = message.toolCall.functionCalls.map((fc: any) => ({
          id: fc.id || fc.callId || `call-${Date.now()}`,
          name: fc.name,
          args: fc.args || {}
        }));
        logger.info(
          `UpstreamGeminiSocket [Slot ${this.slot}]: Received ${calls.length} tool call(s): ${calls.map((c) => c.name).join(', ')}`
        );
        this.emit('toolCall', calls);
      }

      // 4. Token Usage Metadata
      if (message.usageMetadata) {
        const total = message.usageMetadata.totalTokenCount;
        this.emit('usage', {
          totalTokenCount: total,
          promptTokenCount: message.usageMetadata.promptTokenCount,
          candidatesTokenCount: message.usageMetadata.candidatesTokenCount
        });
      }

      // 5. Error payload from Gemini
      if (message.error) {
        const isRateLimit = message.error.code === 429 || /RESOURCE_EXHAUSTED/i.test(message.error.message);
        const err = new Error(`Gemini Live Error (${message.error.code}): ${message.error.message}`);
        this.emit('error', err, isRateLimit);
      }
    } catch (parseErr: any) {
      logger.warn(`UpstreamGeminiSocket [Slot ${this.slot}]: Failed to parse upstream message: ${parseErr.message}`);
    }
  }

  /**
   * Streams 16kHz Base64 PCM audio chunk to upstream Gemini socket.
   */
  sendRealtimeAudio(base64Chunk: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const payload = {
      realtimeInput: {
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: base64Chunk
        }
      }
    };

    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Injects contextual text turns into the upstream session.
   */
  sendClientContent(turns: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>, turnComplete: boolean = true): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const payload = {
      clientContent: {
        turns,
        turnComplete
      }
    };

    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Sends tool execution results back to Gemini Live.
   */
  sendToolResponse(functionResponses: LiveFunctionResponse[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const payload = {
      toolResponse: {
        functionResponses
      }
    };

    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Closes the upstream socket.
   */
  close(code: number = 1000, reason: string = 'Normal Closure'): void {
    if (this.isClosed) return;
    this.isClosed = true;
    if (this.ws) {
      try {
        this.ws.close(code, reason);
      } catch {
        // Ignore close errors
      }
    }
  }
}
