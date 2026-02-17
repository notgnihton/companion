import { RuntimeStore } from "./store.js";
import { CanvasClient } from "./canvas-client.js";
import { filterCanvasAssignmentsByDateWindow } from "./integration-date-window.js";
import { CanvasData } from "./types.js";
import { CanvasDeadlineBridge, CanvasDeadlineBridgeResult } from "./canvas-deadline-bridge.js";

export interface CanvasSyncResult {
  success: boolean;
  coursesCount: number;
  assignmentsCount: number;
  modulesCount: number;
  announcementsCount: number;
  deadlineBridge?: CanvasDeadlineBridgeResult;
  error?: string;
}

export interface CanvasSyncOptions {
  baseUrl?: string;
  token?: string;
}

export class CanvasSyncService {
  private readonly store: RuntimeStore;
  private readonly client: CanvasClient;
  private readonly deadlineBridge: CanvasDeadlineBridge;
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  constructor(store: RuntimeStore, client?: CanvasClient) {
    this.store = store;
    this.client = client ?? new CanvasClient();
    this.deadlineBridge = new CanvasDeadlineBridge(store);
  }

  /**
   * Start the Canvas sync service with periodic syncing every 30 minutes
   */
  start(intervalMs: number = 30 * 60 * 1000): void {
    if (this.syncInterval) {
      return;
    }

    // Sync immediately on start
    void this.sync();

    // Then sync periodically
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
   * Perform a Canvas sync
   */
  async sync(options?: CanvasSyncOptions): Promise<CanvasSyncResult> {
    const client = options ? new CanvasClient(options.baseUrl, options.token) : this.client;

    try {
      const courses = await client.getCourses();
      const assignments = await client.getAllAssignments(courses);
      const filteredAssignments = filterCanvasAssignmentsByDateWindow(assignments);
      const modules = await client.getAllModules(courses);
      const announcements = await client.getAnnouncements();

      const canvasData: CanvasData = {
        courses,
        assignments: filteredAssignments,
        modules,
        announcements,
        lastSyncedAt: new Date().toISOString()
      };

      this.store.setCanvasData(canvasData);

      // Bridge Canvas assignments to deadlines
      const deadlineBridge = this.deadlineBridge.syncAssignments(courses, filteredAssignments);

      return {
        success: true,
        coursesCount: courses.length,
        assignmentsCount: filteredAssignments.length,
        modulesCount: modules.length,
        announcementsCount: announcements.length,
        deadlineBridge
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      return {
        success: false,
        coursesCount: 0,
        assignmentsCount: 0,
        modulesCount: 0,
        announcementsCount: 0,
        error: errorMessage
      };
    }
  }

  /**
   * Manually trigger a sync
   */
  async triggerSync(): Promise<CanvasSyncResult> {
    return this.sync();
  }
}
