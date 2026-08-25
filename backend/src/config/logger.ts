export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, error?: unknown, meta?: unknown): void;
}

export class SimpleLogger implements Logger {
  private isTest: boolean;

  constructor(nodeEnv: string = process.env.NODE_ENV || 'development') {
    this.isTest = nodeEnv === 'test';
  }

  private formatMessage(level: LogLevel, message: string, meta?: unknown): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta !== undefined ? ` | ${typeof meta === 'object' ? JSON.stringify(meta) : String(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  debug(message: string, meta?: unknown): void {
    if (!this.isTest) {
      console.debug(this.formatMessage('debug', message, meta));
    }
  }

  info(message: string, meta?: unknown): void {
    if (!this.isTest) {
      console.info(this.formatMessage('info', message, meta));
    }
  }

  warn(message: string, meta?: unknown): void {
    if (!this.isTest) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  error(message: string, error?: unknown, meta?: unknown): void {
    if (!this.isTest) {
      console.error(this.formatMessage('error', message, meta), error ?? '');
    }
  }
}

export const logger: Logger = new SimpleLogger();
