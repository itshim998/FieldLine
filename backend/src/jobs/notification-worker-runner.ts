import {
  NotificationWorker,
  notificationWorker as defaultNotificationWorker
} from '../services/anomaly/notification.worker.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface NotificationWorkerRunnerOptions {
  pollingIntervalMs?: number;
}

export class NotificationWorkerRunner {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private worker: NotificationWorker;
  private pollingIntervalMs: number;

  constructor(
    worker: NotificationWorker = defaultNotificationWorker,
    options?: NotificationWorkerRunnerOptions
  ) {
    this.worker = worker;
    this.pollingIntervalMs =
      options?.pollingIntervalMs ?? env.NOTIFICATION_POLLING_INTERVAL_MS ?? 1000;
  }

  /**
   * Starts the background notification polling loop.
   */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.scheduleNextTick(0);
  }

  /**
   * Stops the background notification polling loop.
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Returns whether the notification runner loop is active.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Wakes the worker immediately to process new notifications without waiting for interval.
   */
  wake(): void {
    if (!this.running || this.isProcessing) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.scheduleNextTick(0);
  }

  /**
   * Waits for any active notification delivery to finish before shutdown.
   */
  async waitForCurrentProcessing(timeoutMs: number = 5000): Promise<void> {
    const startTime = Date.now();
    while (this.isProcessing) {
      if (Date.now() - startTime > timeoutMs) {
        logger.warn('NotificationWorkerRunner: Timeout waiting for active notification delivery to settle');
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Attempts to process the next eligible notification.
   */
  async processNext(): Promise<boolean> {
    if (this.isProcessing) {
      return false;
    }

    this.isProcessing = true;
    try {
      return await this.worker.processNextNotification();
    } catch (err) {
      logger.error('NotificationWorkerRunner: Unexpected error during notification processing iteration', err);
      return false;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Schedules the next polling tick using setTimeout.
   */
  private scheduleNextTick(delayMs: number): void {
    if (!this.running) {
      return;
    }

    this.timer = setTimeout(async () => {
      if (!this.running) {
        return;
      }

      try {
        const hadItem = await this.processNext();
        // If an item was processed, check immediately for another (10ms); otherwise wait polling interval
        const nextDelay = hadItem ? 10 : this.pollingIntervalMs;
        this.scheduleNextTick(nextDelay);
      } catch (err) {
        logger.error('NotificationWorkerRunner: Polling tick error', err);
        this.scheduleNextTick(this.pollingIntervalMs);
      }
    }, delayMs);
  }
}

export const notificationWorkerRunner = new NotificationWorkerRunner();
