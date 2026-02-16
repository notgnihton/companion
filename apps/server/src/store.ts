import {
  AgentEvent,
  AgentName,
  AgentState,
  CanvasData,
  DashboardSnapshot,
  Deadline,
  JournalEntry,
  JournalSyncPayload,
  LectureEvent,
  Notification,
  NotificationPreferences,
  NotificationPreferencesPatch,
  PushDeliveryFailureRecord,
  PushDeliveryMetrics,
  PushSubscriptionRecord,
  UserContext,
  WeeklySummary
} from "./types.js";
import { makeId, nowIso } from "./utils.js";

const agentNames: AgentName[] = [
  "notes",
  "lecture-plan",
  "assignment-tracker",
  "orchestrator"
];

export class RuntimeStore {
  private readonly maxEvents = 100;
  private readonly maxNotifications = 40;
  private readonly maxJournalEntries = 100;
  private readonly maxScheduleEvents = 200;
  private readonly maxDeadlines = 200;
  private readonly maxPushSubscriptions = 50;
  private events: AgentEvent[] = [];
  private notifications: Notification[] = [];
  private journalEntries: JournalEntry[] = [];
  private scheduleEvents: LectureEvent[] = [];
  private deadlines: Deadline[] = [];
  private pushSubscriptions: PushSubscriptionRecord[] = [];
  private readonly maxPushFailures = 100;
  private pushDeliveryMetricsBase = {
    attempted: 0,
    delivered: 0,
    failed: 0,
    droppedSubscriptions: 0,
    totalRetries: 0
  };
  private pushDeliveryFailures: PushDeliveryFailureRecord[] = [];
  private notificationListeners: Array<(notification: Notification) => void> = [];
  private agentStates: AgentState[] = agentNames.map((name) => ({
    name,
    status: "idle",
    lastRunAt: null
  }));

  private userContext: UserContext = {
    stressLevel: "medium",
    energyLevel: "medium",
    mode: "balanced"
  };

  private notificationPreferences: NotificationPreferences = {
    quietHours: {
      enabled: false,
      startHour: 22,
      endHour: 7
    },
    minimumPriority: "low",
    allowCriticalInQuietHours: true,
    categoryToggles: {
      notes: true,
      "lecture-plan": true,
      "assignment-tracker": true,
      orchestrator: true
    }
  };

  private canvasData: CanvasData = {
    courses: [],
    assignments: [],
    modules: [],
    announcements: [],
    lastSync: null
  };

  markAgentRunning(name: AgentName): void {
    this.updateAgent(name, {
      status: "running",
      lastRunAt: nowIso()
    });
  }

  markAgentError(name: AgentName): void {
    this.updateAgent(name, {
      status: "error",
      lastRunAt: nowIso()
    });
  }

  recordEvent(event: AgentEvent): void {
    this.events = [event, ...this.events].slice(0, this.maxEvents);
    this.updateAgent(event.source, {
      status: "idle",
      lastRunAt: event.timestamp,
      lastEvent: event
    });
  }

  pushNotification(notification: Omit<Notification, "id" | "timestamp">): void {
    const full: Notification = {
      ...notification,
      id: makeId("notif"),
      timestamp: nowIso()
    };
    this.notifications = [full, ...this.notifications].slice(0, this.maxNotifications);
    for (const listener of this.notificationListeners) {
      listener(full);
    }
  }

  setUserContext(next: Partial<UserContext>): UserContext {
    this.userContext = {
      ...this.userContext,
      ...next
    };
    return this.userContext;
  }

  getUserContext(): UserContext {
    return this.userContext;
  }

  getNotificationPreferences(): NotificationPreferences {
    return this.notificationPreferences;
  }

  setNotificationPreferences(next: NotificationPreferencesPatch): NotificationPreferences {
    this.notificationPreferences = {
      ...this.notificationPreferences,
      ...next,
      quietHours: {
        ...this.notificationPreferences.quietHours,
        ...(next.quietHours ?? {})
      },
      categoryToggles: {
        ...this.notificationPreferences.categoryToggles,
        ...(next.categoryToggles ?? {})
      }
    };

    return this.notificationPreferences;
  }

  shouldDispatchNotification(notification: Notification): boolean {
    if (!this.notificationPreferences.categoryToggles[notification.source]) {
      return false;
    }

    if (priorityValue(notification.priority) < priorityValue(this.notificationPreferences.minimumPriority)) {
      return false;
    }

    if (this.notificationPreferences.quietHours.enabled && this.isInQuietHours(notification.timestamp)) {
      return this.notificationPreferences.allowCriticalInQuietHours && notification.priority === "critical";
    }

    return true;
  }

  recordJournalEntry(content: string): JournalEntry {
    const timestamp = nowIso();
    const entry: JournalEntry = {
      id: makeId("journal"),
      content,
      timestamp,
      updatedAt: timestamp,
      version: 1
    };
    this.journalEntries = [entry, ...this.journalEntries].slice(0, this.maxJournalEntries);
    return entry;
  }

  getWeeklySummary(referenceDate: string = nowIso()): WeeklySummary {
    const windowEnd = new Date(referenceDate);
    const windowStart = new Date(windowEnd);
    windowStart.setDate(windowStart.getDate() - 7);

    const isWithinWindow = (value: string): boolean => {
      const date = new Date(value);
      return !Number.isNaN(date.getTime()) && date >= windowStart && date <= windowEnd;
    };

    const deadlinesInWindow = this.deadlines.filter((deadline) => isWithinWindow(deadline.dueDate));
    const deadlinesCompleted = deadlinesInWindow.filter((deadline) => deadline.completed).length;
    const completionRate =
      deadlinesInWindow.length === 0 ? 0 : Math.round((deadlinesCompleted / deadlinesInWindow.length) * 100);

    const journalHighlights = this.journalEntries
      .filter((entry) => isWithinWindow(entry.timestamp))
      .slice(0, 3)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      deadlinesDue: deadlinesInWindow.length,
      deadlinesCompleted,
      completionRate,
      journalHighlights
    };
  }

  syncJournalEntries(payloads: JournalSyncPayload[]): { applied: JournalEntry[]; conflicts: JournalEntry[] } {
    const applied: JournalEntry[] = [];
    const conflicts: JournalEntry[] = [];

    for (const payload of payloads) {
      const existing = this.journalEntries.find(
        (entry) => (payload.id && entry.id === payload.id) || entry.clientEntryId === payload.clientEntryId
      );

      if (!existing) {
        const created: JournalEntry = {
          id: payload.id ?? makeId("journal"),
          clientEntryId: payload.clientEntryId,
          content: payload.content,
          timestamp: payload.timestamp,
          updatedAt: nowIso(),
          version: 1
        };
        this.journalEntries = [created, ...this.journalEntries].slice(0, this.maxJournalEntries);
        applied.push(created);
        continue;
      }

      if (payload.baseVersion !== undefined && payload.baseVersion !== existing.version) {
        conflicts.push(existing);
        continue;
      }

      const merged: JournalEntry = {
        ...existing,
        content: payload.content,
        timestamp: payload.timestamp,
        updatedAt: nowIso(),
        version: existing.version + 1,
        clientEntryId: payload.clientEntryId
      };

      this.journalEntries = this.journalEntries.map((entry) => (entry.id === existing.id ? merged : entry));
      applied.push(merged);
    }

    return { applied, conflicts };
  }

  getJournalEntries(limit?: number): JournalEntry[] {
    if (limit !== undefined && limit > 0) {
      return this.journalEntries.slice(0, limit);
    }
    return this.journalEntries;
  }

  createLectureEvent(entry: Omit<LectureEvent, "id">): LectureEvent {
    const lectureEvent: LectureEvent = {
      id: makeId("lecture"),
      ...entry
    };
    this.scheduleEvents = [lectureEvent, ...this.scheduleEvents].slice(0, this.maxScheduleEvents);
    return lectureEvent;
  }

  getScheduleEvents(): LectureEvent[] {
    return this.scheduleEvents;
  }

  getScheduleEventById(id: string): LectureEvent | null {
    return this.scheduleEvents.find((event) => event.id === id) ?? null;
  }

  updateScheduleEvent(id: string, patch: Partial<Omit<LectureEvent, "id">>): LectureEvent | null {
    const index = this.scheduleEvents.findIndex((event) => event.id === id);

    if (index === -1) {
      return null;
    }

    const next: LectureEvent = {
      ...this.scheduleEvents[index],
      ...patch
    };

    this.scheduleEvents = this.scheduleEvents.map((event, eventIndex) => (eventIndex === index ? next : event));
    return next;
  }

  deleteScheduleEvent(id: string): boolean {
    const before = this.scheduleEvents.length;
    this.scheduleEvents = this.scheduleEvents.filter((event) => event.id !== id);
    return this.scheduleEvents.length < before;
  }

  createDeadline(entry: Omit<Deadline, "id">): Deadline {
    const deadline: Deadline = {
      id: makeId("deadline"),
      ...entry
    };
    this.deadlines = [deadline, ...this.deadlines].slice(0, this.maxDeadlines);
    return deadline;
  }

  getDeadlines(): Deadline[] {
    return this.deadlines;
  }

  getDeadlineById(id: string): Deadline | null {
    return this.deadlines.find((deadline) => deadline.id === id) ?? null;
  }

  updateDeadline(id: string, patch: Partial<Omit<Deadline, "id">>): Deadline | null {
    const index = this.deadlines.findIndex((deadline) => deadline.id === id);

    if (index === -1) {
      return null;
    }

    const next: Deadline = {
      ...this.deadlines[index],
      ...patch
    };

    this.deadlines = this.deadlines.map((deadline, deadlineIndex) => (deadlineIndex === index ? next : deadline));
    return next;
  }

  deleteDeadline(id: string): boolean {
    const before = this.deadlines.length;
    this.deadlines = this.deadlines.filter((deadline) => deadline.id !== id);
    return this.deadlines.length < before;
  }

  addPushSubscription(subscription: PushSubscriptionRecord): PushSubscriptionRecord {
    this.pushSubscriptions = [
      subscription,
      ...this.pushSubscriptions.filter((existing) => existing.endpoint !== subscription.endpoint)
    ].slice(0, this.maxPushSubscriptions);

    return subscription;
  }

  getPushSubscriptions(): PushSubscriptionRecord[] {
    return this.pushSubscriptions;
  }

  removePushSubscription(endpoint: string): boolean {
    const before = this.pushSubscriptions.length;
    this.pushSubscriptions = this.pushSubscriptions.filter((subscription) => subscription.endpoint !== endpoint);
    return this.pushSubscriptions.length < before;
  }


  recordPushDeliveryResult(
    endpoint: string,
    notification: Notification,
    result: {
      delivered: boolean;
      shouldDropSubscription: boolean;
      statusCode?: number;
      error?: string;
      retries?: number;
      attempts?: number;
    }
  ): void {
    this.pushDeliveryMetricsBase.attempted += 1;
    this.pushDeliveryMetricsBase.totalRetries += result.retries ?? 0;

    if (result.delivered) {
      this.pushDeliveryMetricsBase.delivered += 1;
      return;
    }

    this.pushDeliveryMetricsBase.failed += 1;

    if (result.shouldDropSubscription) {
      this.pushDeliveryMetricsBase.droppedSubscriptions += 1;
    }

    const failure: PushDeliveryFailureRecord = {
      id: makeId("push-failure"),
      endpoint,
      notificationId: notification.id,
      notificationTitle: notification.title,
      source: notification.source,
      priority: notification.priority,
      statusCode: result.statusCode,
      error: result.error ?? "Unknown push delivery error",
      attempts: result.attempts ?? (result.retries ?? 0) + 1,
      failedAt: nowIso()
    };

    this.pushDeliveryFailures = [failure, ...this.pushDeliveryFailures].slice(0, this.maxPushFailures);
  }

  getPushDeliveryMetrics(): PushDeliveryMetrics {
    return {
      attempted: this.pushDeliveryMetricsBase.attempted,
      delivered: this.pushDeliveryMetricsBase.delivered,
      failed: this.pushDeliveryMetricsBase.failed,
      droppedSubscriptions: this.pushDeliveryMetricsBase.droppedSubscriptions,
      totalRetries: this.pushDeliveryMetricsBase.totalRetries,
      recentFailures: this.pushDeliveryFailures
    };
  }

  onNotification(listener: (notification: Notification) => void): () => void {
    this.notificationListeners = [...this.notificationListeners, listener];
    return () => {
      this.notificationListeners = this.notificationListeners.filter((existing) => existing !== listener);
    };
  }

  getSnapshot(): DashboardSnapshot {
    const trackedPendingDeadlines = this.deadlines.filter((deadline) => !deadline.completed).length;
    const fallbackEventDeadlines = this.events.filter((evt) => evt.eventType === "assignment.deadline").length;
    const pendingDeadlines = trackedPendingDeadlines > 0 ? trackedPendingDeadlines : fallbackEventDeadlines;
    const activeAgents = this.agentStates.filter((a) => a.status === "running").length;

    return {
      generatedAt: nowIso(),
      summary: {
        todayFocus: this.computeFocus(),
        pendingDeadlines,
        activeAgents,
        journalStreak: 0
      },
      agentStates: this.agentStates,
      notifications: this.notifications,
      events: this.events
    };
  }

  private computeFocus(): string {
    if (this.userContext.mode === "focus") {
      return "Deep work + assignment completion";
    }

    if (this.userContext.mode === "recovery") {
      return "Light planning + recovery tasks";
    }

    return "Balanced schedule with deadlines first";
  }

  updateCanvasData(data: CanvasData): void {
    this.canvasData = data;
  }

  getCanvasData(): CanvasData {
    return this.canvasData;
  }

  private updateAgent(name: AgentName, patch: Partial<AgentState>): void {
    this.agentStates = this.agentStates.map((agent) => (agent.name === name ? { ...agent, ...patch } : agent));
  }

  private isInQuietHours(timestamp: string): boolean {
    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
      return false;
    }

    const hour = date.getHours();
    const { startHour, endHour } = this.notificationPreferences.quietHours;

    if (startHour === endHour) {
      return true;
    }

    if (startHour < endHour) {
      return hour >= startHour && hour < endHour;
    }

    return hour >= startHour || hour < endHour;
  }
}

function priorityValue(priority: Notification["priority"]): number {
  switch (priority) {
    case "low":
      return 0;
    case "medium":
      return 1;
    case "high":
      return 2;
    case "critical":
      return 3;
  }
}
