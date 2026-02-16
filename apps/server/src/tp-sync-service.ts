import { RuntimeStore } from "./store.js";
import { fetchTPSchedule, diffScheduleEvents } from "./tp-sync.js";

/**
 * Service that automatically syncs TP EduCloud schedule weekly
 */
export class TPSyncService {
  private readonly store: RuntimeStore;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;

  constructor(store: RuntimeStore) {
    this.store = store;
  }

  /**
   * Start the TP sync service with weekly automatic sync
   */
  start(intervalMs: number = 7 * 24 * 60 * 60 * 1000): void {
    if (this.syncInterval) {
      return;
    }

    // Sync immediately on start
    void this.sync();

    // Then sync weekly
    this.syncInterval = setInterval(() => {
      void this.sync();
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
      const existingEvents = this.store.getScheduleEvents();
      const diff = diffScheduleEvents(existingEvents, tpEvents);
      const result = this.store.upsertScheduleEvents(diff.toCreate, diff.toUpdate, diff.toDelete);

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
}
