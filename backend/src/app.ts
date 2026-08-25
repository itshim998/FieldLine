import express, { Express } from 'express';
import cors from 'cors';
import { apiRouter } from './routes/index.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';

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
  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Endpoint Not Found' });
  });

  // Centralized error handler
  app.use(errorHandler);

  return app;
}
