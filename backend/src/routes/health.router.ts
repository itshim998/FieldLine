import { Router, Request, Response } from 'express';
import { env } from '../config/env.js';
import { getDatabase, isDatabaseHealthy } from '../database/db.js';
import { healthResponseSchema, HealthResponse } from '../validation/health.schema.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req: Request, res: Response) => {
  const dbHealthy = isDatabaseHealthy();

  let metadata: Record<string, string> = {};
  if (dbHealthy) {
    try {
      const db = getDatabase();
      const rows = db.prepare('SELECT key, value FROM system_metadata').all() as Array<{ key: string; value: string }>;
      metadata = rows.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {} as Record<string, string>);
    } catch {
      // In case metadata read fails
    }
  }

  const payload: HealthResponse = {
    status: dbHealthy ? 'ok' : 'degraded',
    service: 'FieldLine Backend',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
    database: {
      status: dbHealthy ? 'connected' : 'disconnected',
      type: 'sqlite',
      path: env.DATABASE_PATH
    },
    metadata
  };

  // Validate output payload with Zod schema
  const parsed = healthResponseSchema.safeParse(payload);
  if (!parsed.success) {
    res.status(500).json({
      error: 'Health check response failed schema validation',
      issues: parsed.error.issues
    });
    return;
  }

  const statusCode = dbHealthy ? 200 : 503;
  res.status(statusCode).json(parsed.data);
});
