import { RuntimeStore } from "./store.js";
import { fetchTPSchedule, diffScheduleEvents } from "./tp-sync.js";
import { SyncAutoHealingPolicy, SyncAutoHealingState } from "./sync-auto-healing.js";

/**
 * Service that automatically syncs TP EduCloud schedule weekly
 */
export class TPSyncService {
  private readonly store: RuntimeStore;
  private readonly userId: string;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private isSyncing = false;
  private autoSyncInProgress = false;
  private autoSyncIntervalMs = 7 * 24 * 60 * 60 * 1000;
  private readonly autoHealing = new SyncAutoHealingPolicy({
    integration: "tp",
    baseBackoffMs: 60_000,
    maxBackoffMs: 6 * 60 * 60 * 1000,
    circuitFailureThreshold: 4,
    circuitOpenMs: 30 * 60 * 1000
  });

  constructor(store: RuntimeStore, userId: string) {
    this.store = store;
    this.userId = userId;
  }

  /**
   * Start the TP sync service with weekly automatic sync
   */
  start(intervalMs: number = 7 * 24 * 60 * 60 * 1000): void {
    if (this.syncInterval) {
      return;
    }

    this.autoSyncIntervalMs = intervalMs;

    // Sync immediately on start
    void this.runAutoSync();

    // Then sync weekly
    this.syncInterval = setInterval(() => {
      void this.runAutoSync();
    }, intervalMs);
  }

  /**
   * Stop the TP sync service
   */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  /**
   * Sync TP EduCloud schedule
   */
  async sync(): Promise<{ success: boolean; eventsProcessed: number; lecturesCreated: number; lecturesUpdated: number; lecturesDeleted: number; error?: string }> {
    if (this.isSyncing) {
      return {
        success: false,
        error: "Sync already in progress",
        eventsProcessed: 0,
        lecturesCreated: 0,
        lecturesUpdated: 0,
        lecturesDeleted: 0
      };
    }

    this.isSyncing = true;

    try {
      const tpEvents = await fetchTPSchedule();
      const existingEvents = this.store.getScheduleEvents(this.userId);
      const diff = diffScheduleEvents(existingEvents, tpEvents);
      const result = this.store.upsertScheduleEvents(this.userId, diff.toCreate, diff.toUpdate, diff.toDelete);

      return {
        success: true,
        eventsProcessed: tpEvents.length,
        lecturesCreated: result.created,
        lecturesUpdated: result.updated,
        lecturesDeleted: result.deleted
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        eventsProcessed: 0,
        lecturesCreated: 0,
        lecturesUpdated: 0,
        lecturesDeleted: 0
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Check if sync is currently in progress
   */
  isCurrentlySyncing(): boolean {
    return this.isSyncing;
  }

  getAutoHealingStatus(): SyncAutoHealingState {
    return this.autoHealing.getState();
  }

  private scheduleAutoRetry(): void {
    if (!this.syncInterval || this.retryTimeout) {
      return;
    }

    const nextAttemptAt = this.autoHealing.getState().nextAttemptAt;
    if (!nextAttemptAt) {
      return;
    }

    const delay = Date.parse(nextAttemptAt) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0 || delay >= this.autoSyncIntervalMs) {
      return;
    }

    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      void this.runAutoSync();
    }, delay);
  }

  private async runAutoSync(): Promise<void> {
    if (this.autoSyncInProgress) {
      return;
    }

    const decision = this.autoHealing.canAttempt();
    if (!decision.allowed) {
      this.autoHealing.recordSkip(decision.reason ?? "backoff");
      return;
    }

    this.autoSyncInProgress = true;
    try {
      const result = await this.sync();
      if (result.success) {
        this.autoHealing.recordSuccess();
      } else {
        this.autoHealing.recordFailure(result.error);
        this.scheduleAutoRetry();
      }
    } finally {
      this.autoSyncInProgress = false;
    }
  }
}
