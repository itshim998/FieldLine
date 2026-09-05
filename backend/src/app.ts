import express, { Express } from 'express';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { apiRouter } from './routes/index.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { NotFoundError } from './errors/AppError.js';
import { GeminiLiveGateway, GeminiLiveGatewayOptions } from './ai/live/gemini-live-gateway.js';
import { createLiveToolExecutor } from './ai/live/live-tool-handlers.js';

import { projectRepository } from './repositories/project.repository.js';

export interface LiveSessionServerOptions extends GeminiLiveGatewayOptions {
  path?: string;
}

export interface LiveSessionServerAttachment {
  wss: WebSocketServer;
  gateway: GeminiLiveGateway;
}

/**
 * Attaches the Gemini Live WebSocket server to an existing HTTP server.
 * Listens on the path `/ws/live-session` (or custom path).
 */
export function attachLiveSessionWebSocket(
  server: http.Server,
  options: LiveSessionServerOptions = {}
): LiveSessionServerAttachment {
  const wsPath = options.path || '/ws/live-session';
  const projectResolver = options.projectResolver || projectRepository;
  const gateway = new GeminiLiveGateway({ ...options, projectResolver });
  const wss = new WebSocketServer({ server, path: wsPath });

  wss.on('connection', (clientWs, req) => {
    gateway.handleClientConnection(clientWs, req);
  });

  return { wss, gateway };
}

export function createApp(): Express {
  const app = express();

  // Standard middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);

  // Mount API endpoints
  app.use('/api', apiRouter);

  // Fallback 404 handler for unknown API routes
  app.use('/api/*', (_req, _res, next) => {
    next(new NotFoundError('Endpoint Not Found'));
  });

  // Centralized error handler
  app.use(errorHandler);

  return app;
}

