import { RuntimeStore } from "./store.js";
import { CanvasClient } from "./canvas-client.js";
import { filterCanvasAssignmentsByDateWindow } from "./integration-date-window.js";
import { CanvasData } from "./types.js";
import { CanvasDeadlineBridge, CanvasDeadlineBridgeResult } from "./canvas-deadline-bridge.js";
import { SyncAutoHealingPolicy, SyncAutoHealingState } from "./sync-auto-healing.js";

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
  courseIds?: number[];
  pastDays?: number;
  futureDays?: number;
}

function filterAnnouncementsByCourseScope(
  announcements: CanvasData["announcements"],
  courseIds?: number[]
): CanvasData["announcements"] {
  if (!courseIds || courseIds.length === 0) {
    return announcements;
  }

  const allowedCourseIds = new Set(courseIds);
  return announcements.filter((announcement) => {
    const match = /course_(\d+)/.exec(announcement.context_code);
    if (!match) {
      return false;
    }

    return allowedCourseIds.has(Number(match[1]));
  });
}

export class CanvasSyncService {
  private readonly store: RuntimeStore;
  private readonly client: CanvasClient;
  private readonly deadlineBridge: CanvasDeadlineBridge;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private autoSyncInProgress = false;
  private autoSyncIntervalMs = 30 * 60 * 1000;
  private readonly autoHealing = new SyncAutoHealingPolicy({
    integration: "canvas",
    baseBackoffMs: 30_000,
    maxBackoffMs: 60 * 60 * 1000,
    circuitFailureThreshold: 4,
    circuitOpenMs: 20 * 60 * 1000
  });

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

    this.autoSyncIntervalMs = intervalMs;

    // Sync immediately on start
    void this.runAutoSync();

    // Then sync periodically
    this.syncInterval = setInterval(() => {
      void this.runAutoSync();
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
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  /**
   * Perform a Canvas sync
   */
  async sync(options?: CanvasSyncOptions): Promise<CanvasSyncResult> {
    const shouldUseOverrideClient = Boolean(options?.baseUrl || options?.token);
    const client = shouldUseOverrideClient ? new CanvasClient(options?.baseUrl, options?.token) : this.client;

    try {
      const courses = await client.getCourses();
      const scopedCourses =
        options?.courseIds && options.courseIds.length > 0
          ? courses.filter((course) => options.courseIds?.includes(course.id))
          : courses;

      const scopedCourseIds = new Set(scopedCourses.map((course) => course.id));
      const assignments = await client.getAllAssignments(scopedCourses);
      const filteredAssignments = filterCanvasAssignmentsByDateWindow(assignments, {
        pastDays: options?.pastDays,
        futureDays: options?.futureDays
      }).filter((assignment) => scopedCourseIds.has(assignment.course_id));
      const modules = await client.getAllModules(scopedCourses);
      const announcements = filterAnnouncementsByCourseScope(await client.getAnnouncements(), options?.courseIds);

      const canvasData: CanvasData = {
        courses: scopedCourses,
        assignments: filteredAssignments,
        modules,
        announcements,
        lastSyncedAt: new Date().toISOString()
      };

      this.store.setCanvasData(canvasData);

      // Bridge Canvas assignments to deadlines
      const deadlineBridge = this.deadlineBridge.syncAssignments(scopedCourses, filteredAssignments);

      return {
        success: true,
        coursesCount: scopedCourses.length,
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
