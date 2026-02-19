import { RuntimeStore } from "./store.js";
import { SyncQueueItem, SyncOperationType } from "./types.js";

/**
 * Background sync service that processes queued operations
 * when connectivity is restored or the app reopens
 */
export class BackgroundSyncService {
  private readonly store: RuntimeStore;
  private readonly maxRetries = 5;
  private readonly baseRetryDelayMs = 1000;
  private processingInterval: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor(store: RuntimeStore) {
    this.store = store;
  }

  /**
   * Start the background sync service with periodic processing
   */
  start(intervalMs: number = 30000): void {
    if (this.processingInterval) {
      return;
    }

    // Process immediately on start
    void this.processQueue();

    // Then process periodically
    this.processingInterval = setInterval(() => {
      void this.processQueue();
    }, intervalMs);
  }

  /**
   * Stop the background sync service
   */
  stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }

  /**
   * Process all pending items in the sync queue
   */
  async processQueue(): Promise<{ processed: number; failed: number }> {
    if (this.isProcessing) {
      return { processed: 0, failed: 0 };
    }

    this.isProcessing = true;
    let processed = 0;
    let failed = 0;

    try {
      const pendingItems = this.store.getPendingSyncItems(50);

      for (const item of pendingItems) {
        // Skip items that have exceeded max retries
        if (item.attempts >= this.maxRetries) {
          continue;
        }

        // Calculate exponential backoff delay
        if (item.attempts > 0 && item.lastAttemptAt) {
          const backoffDelayMs = this.baseRetryDelayMs * Math.pow(2, item.attempts - 1);
          const nextRetryTime = new Date(item.lastAttemptAt).getTime() + backoffDelayMs;
          
          if (Date.now() < nextRetryTime) {
            // Not yet time to retry this item
            continue;
          }
        }

        const success = await this.processItem(item);
        
        if (success) {
          processed += 1;
        } else {
          failed += 1;
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return { processed, failed };
  }

  /**
   * Process a single sync queue item
   */
  private async processItem(item: SyncQueueItem): Promise<boolean> {
    try {
      switch (item.operationType) {
        case "deadline":
          await this.processDeadlineSync(item);
          break;
        case "context":
          await this.processContextSync(item);
          break;
        case "habit-checkin":
          await this.processHabitCheckInSync(item);
          break;
        case "goal-checkin":
          await this.processGoalCheckInSync(item);
          break;
        case "schedule-update":
          await this.processScheduleUpdateSync(item);
          break;
        default:
          throw new Error(`Unknown operation type: ${item.operationType}`);
      }

      this.store.updateSyncItemStatus(item.id, "completed");
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      // Mark as failed if we've exceeded max retries
      if (item.attempts + 1 >= this.maxRetries) {
        this.store.updateSyncItemStatus(item.id, "failed", errorMessage);
      } else {
        this.store.updateSyncItemStatus(item.id, "pending", errorMessage);
      }
      
      return false;
    }
  }

  /**
   * Process a deadline update sync operation
   */
  private async processDeadlineSync(item: SyncQueueItem): Promise<void> {
    const { deadlineId, updates } = item.payload;

    if (typeof deadlineId !== "string") {
      throw new Error("Invalid deadline sync payload - missing deadlineId");
    }

    // Check if this is a new deadline or an update
    if (deadlineId.startsWith("temp-") && updates && typeof updates === "object") {
      // Create new deadline
      const { course, task, dueDate, priority, completed } = updates as Record<string, unknown>;
      
      if (typeof course !== "string" || typeof task !== "string" || typeof dueDate !== "string") {
        throw new Error("Invalid deadline creation payload");
      }

      this.store.createDeadline({
        course,
        task,
        dueDate,
        priority: (priority as "low" | "medium" | "high" | "critical") ?? "medium",
        completed: (completed as boolean) ?? false
      });
    } else {
      // Update existing deadline
      const deadline = this.store.getDeadlineById(deadlineId);
      
      if (!deadline) {
        throw new Error(`Deadline not found: ${deadlineId}`);
      }

      if (updates && typeof updates === "object") {
        this.store.updateDeadline(deadlineId, updates as Partial<{
          course: string;
          task: string;
          dueDate: string;
          priority: "low" | "medium" | "high" | "critical";
          completed: boolean;
        }>);
      }
    }
  }

  /**
   * Process a context update sync operation
   */
  private async processContextSync(item: SyncQueueItem): Promise<void> {
    const { stressLevel, energyLevel, mode } = item.payload;

    // Validate the payload
    const validStressLevels = ["low", "medium", "high"];
    const validEnergyLevels = ["low", "medium", "high"];
    const validModes = ["focus", "balanced", "recovery"];

    if (stressLevel && !validStressLevels.includes(stressLevel as string)) {
      throw new Error(`Invalid stress level: ${stressLevel}`);
    }

    if (energyLevel && !validEnergyLevels.includes(energyLevel as string)) {
      throw new Error(`Invalid energy level: ${energyLevel}`);
    }

    if (mode && !validModes.includes(mode as string)) {
      throw new Error(`Invalid mode: ${mode}`);
    }

    // Update the context
    this.store.setUserContext({
      stressLevel: stressLevel as "low" | "medium" | "high" | undefined,
      energyLevel: energyLevel as "low" | "medium" | "high" | undefined,
      mode: mode as "focus" | "balanced" | "recovery" | undefined
    });
  }

  private async processHabitCheckInSync(item: SyncQueueItem): Promise<void> {
    const { habitId, completed } = item.payload;

    if (typeof habitId !== "string") {
      throw new Error("Invalid habit check-in payload - missing habitId");
    }

    if (typeof completed !== "boolean") {
      throw new Error("Invalid habit check-in payload - completed must be boolean");
    }

    const updated = this.store.toggleHabitCheckIn(habitId, { completed });
    if (!updated) {
      throw new Error(`Habit not found: ${habitId}`);
    }
  }

  private async processGoalCheckInSync(item: SyncQueueItem): Promise<void> {
    const { goalId, completed } = item.payload;

    if (typeof goalId !== "string") {
      throw new Error("Invalid goal check-in payload - missing goalId");
    }

    if (typeof completed !== "boolean") {
      throw new Error("Invalid goal check-in payload - completed must be boolean");
    }

    const updated = this.store.toggleGoalCheckIn(goalId, { completed });
    if (!updated) {
      throw new Error(`Goal not found: ${goalId}`);
    }
  }

  private async processScheduleUpdateSync(item: SyncQueueItem): Promise<void> {
    const { scheduleId, patch } = item.payload;

    if (typeof scheduleId !== "string") {
      throw new Error("Invalid schedule update payload - missing scheduleId");
    }

    if (!patch || typeof patch !== "object") {
      throw new Error("Invalid schedule update payload - missing patch object");
    }

    const rawPatch = patch as Record<string, unknown>;
    const nextPatch: Partial<{
      title: string;
      location?: string;
      startTime: string;
      durationMinutes: number;
      workload: "low" | "medium" | "high";
    }> = {};

    if (typeof rawPatch.title === "string") {
      nextPatch.title = rawPatch.title;
    }
    if (Object.prototype.hasOwnProperty.call(rawPatch, "location")) {
      if (typeof rawPatch.location === "string") {
        nextPatch.location = rawPatch.location;
      } else if (rawPatch.location === null) {
        nextPatch.location = undefined;
      }
    }
    if (typeof rawPatch.startTime === "string") {
      const parsed = new Date(rawPatch.startTime);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error("Invalid schedule update payload - startTime must be ISO datetime");
      }
      nextPatch.startTime = parsed.toISOString();
    }
    if (typeof rawPatch.durationMinutes === "number" && Number.isFinite(rawPatch.durationMinutes)) {
      nextPatch.durationMinutes = Math.max(15, Math.round(rawPatch.durationMinutes));
    }
    if (rawPatch.workload === "low" || rawPatch.workload === "medium" || rawPatch.workload === "high") {
      nextPatch.workload = rawPatch.workload;
    }

    if (Object.keys(nextPatch).length === 0) {
      throw new Error("Invalid schedule update payload - no valid fields in patch");
    }

    const updated = this.store.updateScheduleEvent(scheduleId, nextPatch);
    if (!updated) {
      throw new Error(`Schedule block not found: ${scheduleId}`);
    }
  }

  /**
   * Manually trigger queue processing (useful for "sync now" button)
   */
  async triggerSync(): Promise<{ processed: number; failed: number }> {
    return this.processQueue();
  }

  /**
   * Check if the service is currently processing
   */
  isCurrentlyProcessing(): boolean {
    return this.isProcessing;
  }
}
