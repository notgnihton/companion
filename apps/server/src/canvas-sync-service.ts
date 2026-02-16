import { RuntimeStore } from "./store.js";
import { fetchAllCanvasData, CanvasSyncResult } from "./canvas-sync.js";

/**
 * Service that automatically syncs Canvas LMS data every 30 minutes
 */
export class CanvasSyncService {
  private readonly store: RuntimeStore;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;

  constructor(store: RuntimeStore) {
    this.store = store;
  }

  /**
   * Start the Canvas sync service with automatic sync every 30 minutes
   */
  start(intervalMs: number = 30 * 60 * 1000): void {
    if (this.syncInterval) {
      return;
    }

    // Sync immediately on start
    void this.sync();

    // Then sync every 30 minutes
    this.syncInterval = setInterval(() => {
      void this.sync();
    }, intervalMs);
  }

  /**
   * Stop the Canvas sync service
   */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Sync Canvas LMS data
   */
  async sync(): Promise<CanvasSyncResult> {
    if (this.isSyncing) {
      return {
        success: false,
        error: "Sync already in progress",
        coursesProcessed: 0,
        assignmentsProcessed: 0,
        modulesProcessed: 0,
        announcementsProcessed: 0,
      };
    }

    this.isSyncing = true;

    try {
      const canvasData = await fetchAllCanvasData();

      // Store courses
      this.store.upsertCanvasCourses(canvasData.courses);

      // Store assignments
      this.store.upsertCanvasAssignments(canvasData.assignments);

      // Store modules
      this.store.upsertCanvasModules(canvasData.modules);

      // Store announcements
      this.store.upsertCanvasAnnouncements(canvasData.announcements);

      return {
        success: true,
        coursesProcessed: canvasData.courses.length,
        assignmentsProcessed: canvasData.assignments.length,
        modulesProcessed: canvasData.modules.length,
        announcementsProcessed: canvasData.announcements.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        coursesProcessed: 0,
        assignmentsProcessed: 0,
        modulesProcessed: 0,
        announcementsProcessed: 0,
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
