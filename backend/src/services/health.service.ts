import { SystemRepository, systemRepository as defaultSystemRepo } from '../repositories/system.repository.js';
import { EnvConfig, env as defaultEnv } from '../config/env.js';
import { HealthResponse } from '../validation/health.schema.js';

export interface HealthService {
  getHealthStatus(): Promise<HealthResponse>;
}

export class DefaultHealthService implements HealthService {
  private systemRepo: SystemRepository;
  private config: EnvConfig;

  constructor(
    systemRepo: SystemRepository = defaultSystemRepo,
    config: EnvConfig = defaultEnv
  ) {
    this.systemRepo = systemRepo;
    this.config = config;
  }

  async getHealthStatus(): Promise<HealthResponse> {
    if (this.config.DATABASE_PROVIDER === 'postgres') {
      let isDbHealthy = false;
      let metadata: Record<string, string> = {};
      try {
        isDbHealthy = await this.systemRepo.isHealthy();
        if (isDbHealthy) {
          metadata = await this.systemRepo.getAllMetadata();
        }
      } catch {
        isDbHealthy = false;
      }

      return {
        status: isDbHealthy ? 'ok' : 'degraded',
        service: 'FieldLine Backend',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: this.config.NODE_ENV,
        database: {
          status: isDbHealthy ? 'connected' : 'disconnected',
          type: 'postgres',
          provider: 'postgres'
        },
        metadata
      };
    }

    const isDbHealthy = Boolean(await this.systemRepo.isHealthy());
    const metadata = isDbHealthy ? (await this.systemRepo.getAllMetadata()) : {};

    return {
      status: isDbHealthy ? 'ok' : 'degraded',
      service: 'FieldLine Backend',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: this.config.NODE_ENV,
      database: {
        status: isDbHealthy ? 'connected' : 'disconnected',
        type: 'sqlite',
        path: this.config.DATABASE_PATH
      },
      metadata
    };
  }
}

export const healthService: HealthService = new DefaultHealthService();
