import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  service: z.string(),
  version: z.string(),
  timestamp: z.string().datetime(),
  uptime: z.number().nonnegative(),
  environment: z.string(),
  database: z.object({
    status: z.enum(['connected', 'disconnected', 'error']),
    type: z.literal('sqlite'),
    path: z.string()
  }),
  metadata: z.record(z.string()).optional()
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
