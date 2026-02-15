import Database from "better-sqlite3";
import {
  AgentEvent,
  AgentName,
  AgentState,
  DashboardSnapshot,
  Deadline,
  DeadlineReminderState,
  DeadlineStatusConfirmation,
  JournalEntry,
  JournalSyncPayload,
  LectureEvent,
  Notification,
  NotificationPreferences,
  NotificationPreferencesPatch,
  PushDeliveryFailureRecord,
  PushDeliveryMetrics,
  PushSubscriptionRecord,
  ScheduledNotification,
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
  private readonly maxPushFailures = 100;
  private notificationListeners: Array<(notification: Notification) => void> = [];
  private db: Database.Database;

  constructor(dbPath: string = "companion.db") {
    this.db = new Database(dbPath);
    this.initializeSchema();
    this.loadOrInitializeDefaults();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_events (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        eventType TEXT NOT NULL,
        priority TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payload TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        priority TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        clientEntryId TEXT,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        version INTEGER NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS schedule_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        startTime TEXT NOT NULL,
        durationMinutes INTEGER NOT NULL,
        workload TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS deadlines (
        id TEXT PRIMARY KEY,
        course TEXT NOT NULL,
        task TEXT NOT NULL,
        dueDate TEXT NOT NULL,
        priority TEXT NOT NULL,
        completed INTEGER NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS deadline_reminder_state (
        deadlineId TEXT PRIMARY KEY,
        reminderCount INTEGER NOT NULL,
        lastReminderAt TEXT,
        lastConfirmationAt TEXT,
        lastConfirmedCompleted INTEGER
      );

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        expirationTime INTEGER,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS push_delivery_failures (
        id TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL,
        notificationId TEXT NOT NULL,
        notificationTitle TEXT NOT NULL,
        source TEXT NOT NULL,
        priority TEXT NOT NULL,
        statusCode INTEGER,
        error TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        failedAt TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS push_delivery_metrics (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        attempted INTEGER NOT NULL DEFAULT 0,
        delivered INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        droppedSubscriptions INTEGER NOT NULL DEFAULT 0,
        totalRetries INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS agent_states (
        name TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        lastRunAt TEXT,
        lastEventId TEXT,
        lastEventSource TEXT,
        lastEventType TEXT,
        lastEventPriority TEXT,
        lastEventTimestamp TEXT,
        lastEventPayload TEXT
      );

      CREATE TABLE IF NOT EXISTS user_context (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        stressLevel TEXT NOT NULL,
        energyLevel TEXT NOT NULL,
        mode TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notification_preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        quietHoursEnabled INTEGER NOT NULL,
        quietHoursStartHour INTEGER NOT NULL,
        quietHoursEndHour INTEGER NOT NULL,
        minimumPriority TEXT NOT NULL,
        allowCriticalInQuietHours INTEGER NOT NULL,
        categoryNotesEnabled INTEGER NOT NULL,
        categoryLecturePlanEnabled INTEGER NOT NULL,
        categoryAssignmentTrackerEnabled INTEGER NOT NULL,
        categoryOrchestratorEnabled INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scheduled_notifications (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        priority TEXT NOT NULL,
        scheduledFor TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        eventId TEXT,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );
    `);
  }

  private loadOrInitializeDefaults(): void {
    // Initialize agent states
    const agentStateStmt = this.db.prepare("SELECT name FROM agent_states WHERE name = ?");
    const insertAgentState = this.db.prepare(
      "INSERT OR IGNORE INTO agent_states (name, status, lastRunAt) VALUES (?, ?, ?)"
    );

    for (const name of agentNames) {
      if (!agentStateStmt.get(name)) {
        insertAgentState.run(name, "idle", null);
      }
    }

    // Initialize user context
    const userContextExists = this.db.prepare("SELECT id FROM user_context WHERE id = 1").get();
    if (!userContextExists) {
      this.db
        .prepare("INSERT INTO user_context (id, stressLevel, energyLevel, mode) VALUES (1, ?, ?, ?)")
        .run("medium", "medium", "balanced");
    }

    // Initialize notification preferences
    const prefsExists = this.db.prepare("SELECT id FROM notification_preferences WHERE id = 1").get();
    if (!prefsExists) {
      this.db
        .prepare(
          `INSERT INTO notification_preferences (
            id, quietHoursEnabled, quietHoursStartHour, quietHoursEndHour,
            minimumPriority, allowCriticalInQuietHours,
            categoryNotesEnabled, categoryLecturePlanEnabled,
            categoryAssignmentTrackerEnabled, categoryOrchestratorEnabled
          ) VALUES (1, 0, 22, 7, 'low', 1, 1, 1, 1, 1)`
        )
        .run();
    }

    // Initialize push delivery metrics
    const metricsExists = this.db.prepare("SELECT id FROM push_delivery_metrics WHERE id = 1").get();
    if (!metricsExists) {
      this.db
        .prepare(
          "INSERT INTO push_delivery_metrics (id, attempted, delivered, failed, droppedSubscriptions, totalRetries) VALUES (1, 0, 0, 0, 0, 0)"
        )
        .run();
    }
  }

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
    const insertStmt = this.db.prepare(
      "INSERT INTO agent_events (id, source, eventType, priority, timestamp, payload, insertOrder) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(insertOrder), 0) + 1 FROM agent_events))"
    );
    insertStmt.run(event.id, event.source, event.eventType, event.priority, event.timestamp, JSON.stringify(event.payload));

    // Trim to maxEvents
    const count = (this.db.prepare("SELECT COUNT(*) as count FROM agent_events").get() as { count: number }).count;
    if (count > this.maxEvents) {
      this.db
        .prepare(
          `DELETE FROM agent_events WHERE id IN (
            SELECT id FROM agent_events ORDER BY insertOrder ASC LIMIT ?
          )`
        )
        .run(count - this.maxEvents);
    }

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

    const insertStmt = this.db.prepare(
      "INSERT INTO notifications (id, source, title, message, priority, timestamp) VALUES (?, ?, ?, ?, ?, ?)"
    );
    insertStmt.run(full.id, full.source, full.title, full.message, full.priority, full.timestamp);

    // Trim to maxNotifications
    const count = (this.db.prepare("SELECT COUNT(*) as count FROM notifications").get() as { count: number }).count;
    if (count > this.maxNotifications) {
      this.db
        .prepare(
          `DELETE FROM notifications WHERE id IN (
            SELECT id FROM notifications ORDER BY insertOrder ASC LIMIT ?
          )`
        )
        .run(count - this.maxNotifications);
    }

    for (const listener of this.notificationListeners) {
      listener(full);
    }
  }

  setUserContext(next: Partial<UserContext>): UserContext {
    const current = this.getUserContext();
    const updated = { ...current, ...next };

    this.db
      .prepare("UPDATE user_context SET stressLevel = ?, energyLevel = ?, mode = ? WHERE id = 1")
      .run(updated.stressLevel, updated.energyLevel, updated.mode);

    return updated;
  }

  getUserContext(): UserContext {
    const row = this.db.prepare("SELECT stressLevel, energyLevel, mode FROM user_context WHERE id = 1").get() as {
      stressLevel: string;
      energyLevel: string;
      mode: string;
    };

    return {
      stressLevel: row.stressLevel as UserContext["stressLevel"],
      energyLevel: row.energyLevel as UserContext["energyLevel"],
      mode: row.mode as UserContext["mode"]
    };
  }

  getNotificationPreferences(): NotificationPreferences {
    const row = this.db
      .prepare(
        `SELECT quietHoursEnabled, quietHoursStartHour, quietHoursEndHour,
                minimumPriority, allowCriticalInQuietHours,
                categoryNotesEnabled, categoryLecturePlanEnabled,
                categoryAssignmentTrackerEnabled, categoryOrchestratorEnabled
         FROM notification_preferences WHERE id = 1`
      )
      .get() as {
      quietHoursEnabled: number;
      quietHoursStartHour: number;
      quietHoursEndHour: number;
      minimumPriority: string;
      allowCriticalInQuietHours: number;
      categoryNotesEnabled: number;
      categoryLecturePlanEnabled: number;
      categoryAssignmentTrackerEnabled: number;
      categoryOrchestratorEnabled: number;
    };

    return {
      quietHours: {
        enabled: Boolean(row.quietHoursEnabled),
        startHour: row.quietHoursStartHour,
        endHour: row.quietHoursEndHour
      },
      minimumPriority: row.minimumPriority as NotificationPreferences["minimumPriority"],
      allowCriticalInQuietHours: Boolean(row.allowCriticalInQuietHours),
      categoryToggles: {
        notes: Boolean(row.categoryNotesEnabled),
        "lecture-plan": Boolean(row.categoryLecturePlanEnabled),
        "assignment-tracker": Boolean(row.categoryAssignmentTrackerEnabled),
        orchestrator: Boolean(row.categoryOrchestratorEnabled)
      }
    };
  }

  setNotificationPreferences(next: NotificationPreferencesPatch): NotificationPreferences {
    const current = this.getNotificationPreferences();

    const updated: NotificationPreferences = {
      quietHours: {
        ...current.quietHours,
        ...(next.quietHours ?? {})
      },
      minimumPriority: next.minimumPriority ?? current.minimumPriority,
      allowCriticalInQuietHours: next.allowCriticalInQuietHours ?? current.allowCriticalInQuietHours,
      categoryToggles: {
        ...current.categoryToggles,
        ...(next.categoryToggles ?? {})
      }
    };

    this.db
      .prepare(
        `UPDATE notification_preferences SET
          quietHoursEnabled = ?, quietHoursStartHour = ?, quietHoursEndHour = ?,
          minimumPriority = ?, allowCriticalInQuietHours = ?,
          categoryNotesEnabled = ?, categoryLecturePlanEnabled = ?,
          categoryAssignmentTrackerEnabled = ?, categoryOrchestratorEnabled = ?
         WHERE id = 1`
      )
      .run(
        updated.quietHours.enabled ? 1 : 0,
        updated.quietHours.startHour,
        updated.quietHours.endHour,
        updated.minimumPriority,
        updated.allowCriticalInQuietHours ? 1 : 0,
        updated.categoryToggles.notes ? 1 : 0,
        updated.categoryToggles["lecture-plan"] ? 1 : 0,
        updated.categoryToggles["assignment-tracker"] ? 1 : 0,
        updated.categoryToggles.orchestrator ? 1 : 0
      );

    return updated;
  }

  shouldDispatchNotification(notification: Notification): boolean {
    const prefs = this.getNotificationPreferences();

    if (!prefs.categoryToggles[notification.source]) {
      return false;
    }

    if (priorityValue(notification.priority) < priorityValue(prefs.minimumPriority)) {
      return false;
    }

    if (prefs.quietHours.enabled && this.isInQuietHours(notification.timestamp)) {
      return prefs.allowCriticalInQuietHours && notification.priority === "critical";
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

    this.db
      .prepare(
        "INSERT INTO journal_entries (id, clientEntryId, content, timestamp, updatedAt, version) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(entry.id, null, entry.content, entry.timestamp, entry.updatedAt, entry.version);

    // Trim to maxJournalEntries
    const count = (this.db.prepare("SELECT COUNT(*) as count FROM journal_entries").get() as { count: number }).count;
    if (count > this.maxJournalEntries) {
      this.db
        .prepare(
          `DELETE FROM journal_entries WHERE id IN (
            SELECT id FROM journal_entries ORDER BY insertOrder ASC LIMIT ?
          )`
        )
        .run(count - this.maxJournalEntries);
    }

    return entry;
  }

  getWeeklySummary(referenceDate: string = nowIso()): WeeklySummary {
    const windowEnd = new Date(referenceDate);
    const windowStart = new Date(windowEnd);
    windowStart.setDate(windowStart.getDate() - 7);

    const deadlinesInWindow = this.db
      .prepare("SELECT * FROM deadlines WHERE dueDate >= ? AND dueDate <= ?")
      .all(windowStart.toISOString(), windowEnd.toISOString()) as Array<{
      id: string;
      course: string;
      task: string;
      dueDate: string;
      priority: string;
      completed: number;
    }>;

    const deadlinesCompleted = deadlinesInWindow.filter((d) => d.completed).length;
    const completionRate = deadlinesInWindow.length === 0 ? 0 : Math.round((deadlinesCompleted / deadlinesInWindow.length) * 100);

    const journalHighlights = (
      this.db
        .prepare("SELECT * FROM journal_entries WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT 3")
        .all(windowStart.toISOString(), windowEnd.toISOString()) as Array<{
        id: string;
        clientEntryId: string | null;
        content: string;
        timestamp: string;
        updatedAt: string;
        version: number;
      }>
    ).map((row) => ({
      id: row.id,
      clientEntryId: row.clientEntryId ?? undefined,
      content: row.content,
      timestamp: row.timestamp,
      updatedAt: row.updatedAt,
      version: row.version
    }));

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
      const existingRow = payload.id
        ? this.db.prepare("SELECT * FROM journal_entries WHERE id = ?").get(payload.id)
        : payload.clientEntryId
          ? this.db.prepare("SELECT * FROM journal_entries WHERE clientEntryId = ?").get(payload.clientEntryId)
          : null;

      const existing = existingRow
        ? ({
            id: (existingRow as { id: string }).id,
            clientEntryId: (existingRow as { clientEntryId: string | null }).clientEntryId ?? undefined,
            content: (existingRow as { content: string }).content,
            timestamp: (existingRow as { timestamp: string }).timestamp,
            updatedAt: (existingRow as { updatedAt: string }).updatedAt,
            version: (existingRow as { version: number }).version
          } as JournalEntry)
        : null;

      if (!existing) {
        const created: JournalEntry = {
          id: payload.id ?? makeId("journal"),
          clientEntryId: payload.clientEntryId,
          content: payload.content,
          timestamp: payload.timestamp,
          updatedAt: nowIso(),
          version: 1
        };

        this.db
          .prepare(
            "INSERT INTO journal_entries (id, clientEntryId, content, timestamp, updatedAt, version) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .run(created.id, created.clientEntryId ?? null, created.content, created.timestamp, created.updatedAt, created.version);

        // Trim to maxJournalEntries
        const count = (this.db.prepare("SELECT COUNT(*) as count FROM journal_entries").get() as { count: number }).count;
        if (count > this.maxJournalEntries) {
          this.db
            .prepare(
              `DELETE FROM journal_entries WHERE id IN (
                SELECT id FROM journal_entries ORDER BY insertOrder ASC LIMIT ?
              )`
            )
            .run(count - this.maxJournalEntries);
        }

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

      this.db
        .prepare("UPDATE journal_entries SET content = ?, timestamp = ?, updatedAt = ?, version = ?, clientEntryId = ? WHERE id = ?")
        .run(merged.content, merged.timestamp, merged.updatedAt, merged.version, merged.clientEntryId ?? null, merged.id);

      applied.push(merged);
    }

    return { applied, conflicts };
  }

  getJournalEntries(limit?: number): JournalEntry[] {
    const query = limit !== undefined && limit > 0
      ? "SELECT * FROM journal_entries ORDER BY timestamp DESC LIMIT ?"
      : "SELECT * FROM journal_entries ORDER BY timestamp DESC";

    const rows = (limit !== undefined && limit > 0
      ? this.db.prepare(query).all(limit)
      : this.db.prepare(query).all()) as Array<{
      id: string;
      clientEntryId: string | null;
      content: string;
      timestamp: string;
      updatedAt: string;
      version: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      clientEntryId: row.clientEntryId ?? undefined,
      content: row.content,
      timestamp: row.timestamp,
      updatedAt: row.updatedAt,
      version: row.version
    }));
  }

  createLectureEvent(entry: Omit<LectureEvent, "id">): LectureEvent {
    const lectureEvent: LectureEvent = {
      id: makeId("lecture"),
      ...entry
    };

    this.db
      .prepare("INSERT INTO schedule_events (id, title, startTime, durationMinutes, workload) VALUES (?, ?, ?, ?, ?)")
      .run(lectureEvent.id, lectureEvent.title, lectureEvent.startTime, lectureEvent.durationMinutes, lectureEvent.workload);

    // Trim to maxScheduleEvents
    const count = (this.db.prepare("SELECT COUNT(*) as count FROM schedule_events").get() as { count: number }).count;
    if (count > this.maxScheduleEvents) {
      this.db
        .prepare(
          `DELETE FROM schedule_events WHERE id IN (
            SELECT id FROM schedule_events ORDER BY insertOrder ASC LIMIT ?
          )`
        )
        .run(count - this.maxScheduleEvents);
    }

    return lectureEvent;
  }

  getScheduleEvents(): LectureEvent[] {
    const rows = this.db.prepare("SELECT * FROM schedule_events ORDER BY startTime DESC").all() as Array<{
      id: string;
      title: string;
      startTime: string;
      durationMinutes: number;
      workload: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      startTime: row.startTime,
      durationMinutes: row.durationMinutes,
      workload: row.workload as LectureEvent["workload"]
    }));
  }

  getScheduleEventById(id: string): LectureEvent | null {
    const row = this.db.prepare("SELECT * FROM schedule_events WHERE id = ?").get(id) as
      | {
          id: string;
          title: string;
          startTime: string;
          durationMinutes: number;
          workload: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      startTime: row.startTime,
      durationMinutes: row.durationMinutes,
      workload: row.workload as LectureEvent["workload"]
    };
  }

  updateScheduleEvent(id: string, patch: Partial<Omit<LectureEvent, "id">>): LectureEvent | null {
    const existing = this.getScheduleEventById(id);

    if (!existing) {
      return null;
    }

    const next: LectureEvent = {
      ...existing,
      ...patch
    };

    this.db
      .prepare("UPDATE schedule_events SET title = ?, startTime = ?, durationMinutes = ?, workload = ? WHERE id = ?")
      .run(next.title, next.startTime, next.durationMinutes, next.workload, id);

    return next;
  }

  deleteScheduleEvent(id: string): boolean {
    const result = this.db.prepare("DELETE FROM schedule_events WHERE id = ?").run(id);
    return result.changes > 0;
  }

  createDeadline(entry: Omit<Deadline, "id">): Deadline {
    const deadline: Deadline = {
      id: makeId("deadline"),
      ...entry
    };

    this.db
      .prepare("INSERT INTO deadlines (id, course, task, dueDate, priority, completed) VALUES (?, ?, ?, ?, ?, ?)")
      .run(deadline.id, deadline.course, deadline.task, deadline.dueDate, deadline.priority, deadline.completed ? 1 : 0);

    // Trim to maxDeadlines
    const count = (this.db.prepare("SELECT COUNT(*) as count FROM deadlines").get() as { count: number }).count;
    if (count > this.maxDeadlines) {
      this.db
        .prepare(
          `DELETE FROM deadlines WHERE id IN (
            SELECT id FROM deadlines ORDER BY insertOrder ASC LIMIT ?
          )`
        )
        .run(count - this.maxDeadlines);
    }

    return deadline;
  }

  getDeadlines(): Deadline[] {
    const rows = this.db.prepare("SELECT * FROM deadlines ORDER BY dueDate DESC").all() as Array<{
      id: string;
      course: string;
      task: string;
      dueDate: string;
      priority: string;
      completed: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      course: row.course,
      task: row.task,
      dueDate: row.dueDate,
      priority: row.priority as Deadline["priority"],
      completed: Boolean(row.completed)
    }));
  }

  getDeadlineById(id: string): Deadline | null {
    const row = this.db.prepare("SELECT * FROM deadlines WHERE id = ?").get(id) as
      | {
          id: string;
          course: string;
          task: string;
          dueDate: string;
          priority: string;
          completed: number;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      course: row.course,
      task: row.task,
      dueDate: row.dueDate,
      priority: row.priority as Deadline["priority"],
      completed: Boolean(row.completed)
    };
  }

  updateDeadline(id: string, patch: Partial<Omit<Deadline, "id">>): Deadline | null {
    const existing = this.getDeadlineById(id);

    if (!existing) {
      return null;
    }

    const next: Deadline = {
      ...existing,
      ...patch
    };

    this.db
      .prepare("UPDATE deadlines SET course = ?, task = ?, dueDate = ?, priority = ?, completed = ? WHERE id = ?")
      .run(next.course, next.task, next.dueDate, next.priority, next.completed ? 1 : 0, id);

    return next;
  }

  deleteDeadline(id: string): boolean {
    const result = this.db.prepare("DELETE FROM deadlines WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM deadline_reminder_state WHERE deadlineId = ?").run(id);
    return result.changes > 0;
  }

  getOverdueDeadlinesRequiringReminder(referenceDate: string = nowIso(), cooldownMinutes = 180): Deadline[] {
    const nowMs = new Date(referenceDate).getTime();

    if (Number.isNaN(nowMs)) {
      return [];
    }

    const cooldownMs = Math.max(0, cooldownMinutes) * 60_000;

    const deadlines = this.getDeadlines();

    return deadlines.filter((deadline) => {
      if (deadline.completed) {
        return false;
      }

      const dueMs = new Date(deadline.dueDate).getTime();
      if (Number.isNaN(dueMs) || dueMs > nowMs) {
        return false;
      }

      const reminderState = this.getDeadlineReminderState(deadline.id);
      if (!reminderState?.lastReminderAt) {
        return true;
      }

      const lastReminderMs = new Date(reminderState.lastReminderAt).getTime();
      if (Number.isNaN(lastReminderMs)) {
        return true;
      }

      return nowMs - lastReminderMs >= cooldownMs;
    });
  }

  recordDeadlineReminder(deadlineId: string, reminderAt: string = nowIso()): DeadlineReminderState | null {
    if (!this.getDeadlineById(deadlineId)) {
      return null;
    }

    const existing = this.getDeadlineReminderState(deadlineId);
    const next: DeadlineReminderState = {
      deadlineId,
      reminderCount: (existing?.reminderCount ?? 0) + 1,
      lastReminderAt: reminderAt,
      lastConfirmationAt: existing?.lastConfirmationAt ?? null,
      lastConfirmedCompleted: existing?.lastConfirmedCompleted ?? null
    };

    this.db
      .prepare(
        `INSERT OR REPLACE INTO deadline_reminder_state
         (deadlineId, reminderCount, lastReminderAt, lastConfirmationAt, lastConfirmedCompleted)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        next.deadlineId,
        next.reminderCount,
        next.lastReminderAt,
        next.lastConfirmationAt,
        next.lastConfirmedCompleted !== null ? (next.lastConfirmedCompleted ? 1 : 0) : null
      );

    return next;
  }

  confirmDeadlineStatus(deadlineId: string, completed: boolean): DeadlineStatusConfirmation | null {
    const deadline = this.updateDeadline(deadlineId, { completed });

    if (!deadline) {
      return null;
    }

    const confirmationAt = nowIso();
    const existing = this.getDeadlineReminderState(deadlineId);
    const reminder: DeadlineReminderState = {
      deadlineId,
      reminderCount: existing?.reminderCount ?? 0,
      lastReminderAt: existing?.lastReminderAt ?? confirmationAt,
      lastConfirmationAt: confirmationAt,
      lastConfirmedCompleted: completed
    };

    this.db
      .prepare(
        `INSERT OR REPLACE INTO deadline_reminder_state
         (deadlineId, reminderCount, lastReminderAt, lastConfirmationAt, lastConfirmedCompleted)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(reminder.deadlineId, reminder.reminderCount, reminder.lastReminderAt, reminder.lastConfirmationAt, completed ? 1 : 0);

    return {
      deadline,
      reminder
    };
  }

  getDeadlineReminderState(deadlineId: string): DeadlineReminderState | null {
    const row = this.db.prepare("SELECT * FROM deadline_reminder_state WHERE deadlineId = ?").get(deadlineId) as
      | {
          deadlineId: string;
          reminderCount: number;
          lastReminderAt: string | null;
          lastConfirmationAt: string | null;
          lastConfirmedCompleted: number | null;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      deadlineId: row.deadlineId,
      reminderCount: row.reminderCount,
      lastReminderAt: row.lastReminderAt ?? "",
      lastConfirmationAt: row.lastConfirmationAt,
      lastConfirmedCompleted: row.lastConfirmedCompleted !== null ? Boolean(row.lastConfirmedCompleted) : null
    };
  }

  addPushSubscription(subscription: PushSubscriptionRecord): PushSubscriptionRecord {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO push_subscriptions (endpoint, expirationTime, p256dh, auth) VALUES (?, ?, ?, ?)`
      )
      .run(subscription.endpoint, subscription.expirationTime, subscription.keys.p256dh, subscription.keys.auth);

    // Trim to maxPushSubscriptions
    const count = (this.db.prepare("SELECT COUNT(*) as count FROM push_subscriptions").get() as { count: number }).count;
    if (count > this.maxPushSubscriptions) {
      this.db
        .prepare(
          `DELETE FROM push_subscriptions WHERE endpoint IN (
            SELECT endpoint FROM push_subscriptions LIMIT ?
          )`
        )
        .run(count - this.maxPushSubscriptions);
    }

    return subscription;
  }

  getPushSubscriptions(): PushSubscriptionRecord[] {
    const rows = this.db.prepare("SELECT * FROM push_subscriptions").all() as Array<{
      endpoint: string;
      expirationTime: number | null;
      p256dh: string;
      auth: string;
    }>;

    return rows.map((row) => ({
      endpoint: row.endpoint,
      expirationTime: row.expirationTime,
      keys: {
        p256dh: row.p256dh,
        auth: row.auth
      }
    }));
  }

  removePushSubscription(endpoint: string): boolean {
    const result = this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
    return result.changes > 0;
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
    // Update metrics
    this.db
      .prepare("UPDATE push_delivery_metrics SET attempted = attempted + 1, totalRetries = totalRetries + ? WHERE id = 1")
      .run(result.retries ?? 0);

    if (result.delivered) {
      this.db.prepare("UPDATE push_delivery_metrics SET delivered = delivered + 1 WHERE id = 1").run();
      return;
    }

    this.db.prepare("UPDATE push_delivery_metrics SET failed = failed + 1 WHERE id = 1").run();

    if (result.shouldDropSubscription) {
      this.db.prepare("UPDATE push_delivery_metrics SET droppedSubscriptions = droppedSubscriptions + 1 WHERE id = 1").run();
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

    this.db
      .prepare(
        `INSERT INTO push_delivery_failures
         (id, endpoint, notificationId, notificationTitle, source, priority, statusCode, error, attempts, failedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        failure.id,
        failure.endpoint,
        failure.notificationId,
        failure.notificationTitle,
        failure.source,
        failure.priority,
        failure.statusCode ?? null,
        failure.error,
        failure.attempts,
        failure.failedAt
      );

    // Trim to maxPushFailures
    const count = (this.db.prepare("SELECT COUNT(*) as count FROM push_delivery_failures").get() as { count: number }).count;
    if (count > this.maxPushFailures) {
      this.db
        .prepare(
          `DELETE FROM push_delivery_failures WHERE id IN (
            SELECT id FROM push_delivery_failures ORDER BY insertOrder ASC LIMIT ?
          )`
        )
        .run(count - this.maxPushFailures);
    }
  }

  getPushDeliveryMetrics(): PushDeliveryMetrics {
    const metricsRow = this.db
      .prepare("SELECT attempted, delivered, failed, droppedSubscriptions, totalRetries FROM push_delivery_metrics WHERE id = 1")
      .get() as {
      attempted: number;
      delivered: number;
      failed: number;
      droppedSubscriptions: number;
      totalRetries: number;
    };

    const failureRows = this.db.prepare("SELECT * FROM push_delivery_failures ORDER BY failedAt DESC").all() as Array<{
      id: string;
      endpoint: string;
      notificationId: string;
      notificationTitle: string;
      source: string;
      priority: string;
      statusCode: number | null;
      error: string;
      attempts: number;
      failedAt: string;
    }>;

    const recentFailures: PushDeliveryFailureRecord[] = failureRows.map((row) => ({
      id: row.id,
      endpoint: row.endpoint,
      notificationId: row.notificationId,
      notificationTitle: row.notificationTitle,
      source: row.source as PushDeliveryFailureRecord["source"],
      priority: row.priority as PushDeliveryFailureRecord["priority"],
      statusCode: row.statusCode ?? undefined,
      error: row.error,
      attempts: row.attempts,
      failedAt: row.failedAt
    }));

    return {
      attempted: metricsRow.attempted,
      delivered: metricsRow.delivered,
      failed: metricsRow.failed,
      droppedSubscriptions: metricsRow.droppedSubscriptions,
      totalRetries: metricsRow.totalRetries,
      recentFailures
    };
  }

  onNotification(listener: (notification: Notification) => void): () => void {
    this.notificationListeners = [...this.notificationListeners, listener];
    return () => {
      this.notificationListeners = this.notificationListeners.filter((existing) => existing !== listener);
    };
  }

  getSnapshot(): DashboardSnapshot {
    const deadlines = this.getDeadlines();
    const trackedPendingDeadlines = deadlines.filter((deadline) => !deadline.completed).length;

    const events = this.db.prepare("SELECT * FROM agent_events ORDER BY insertOrder DESC").all() as Array<{
      id: string;
      source: string;
      eventType: string;
      priority: string;
      timestamp: string;
      payload: string;
    }>;

    const fallbackEventDeadlines = events.filter((evt) => evt.eventType === "assignment.deadline").length;
    const pendingDeadlines = trackedPendingDeadlines > 0 ? trackedPendingDeadlines : fallbackEventDeadlines;

    const agentStates = this.getAgentStates();
    const activeAgents = agentStates.filter((a) => a.status === "running").length;

    const notifications = this.db.prepare("SELECT * FROM notifications ORDER BY insertOrder DESC").all() as Array<{
      id: string;
      source: string;
      title: string;
      message: string;
      priority: string;
      timestamp: string;
    }>;

    return {
      generatedAt: nowIso(),
      summary: {
        todayFocus: this.computeFocus(),
        pendingDeadlines,
        activeAgents,
        journalStreak: 0
      },
      agentStates,
      notifications: notifications.map((row) => ({
        id: row.id,
        source: row.source as Notification["source"],
        title: row.title,
        message: row.message,
        priority: row.priority as Notification["priority"],
        timestamp: row.timestamp
      })),
      events: events.map((row) => ({
        id: row.id,
        source: row.source as AgentEvent["source"],
        eventType: row.eventType,
        priority: row.priority as AgentEvent["priority"],
        timestamp: row.timestamp,
        payload: JSON.parse(row.payload)
      }))
    };
  }

  private getAgentStates(): AgentState[] {
    const rows = this.db.prepare("SELECT * FROM agent_states").all() as Array<{
      name: string;
      status: string;
      lastRunAt: string | null;
      lastEventId: string | null;
      lastEventSource: string | null;
      lastEventType: string | null;
      lastEventPriority: string | null;
      lastEventTimestamp: string | null;
      lastEventPayload: string | null;
    }>;

    return rows.map((row) => ({
      name: row.name as AgentName,
      status: row.status as AgentState["status"],
      lastRunAt: row.lastRunAt,
      lastEvent: row.lastEventId
        ? {
            id: row.lastEventId,
            source: row.lastEventSource as AgentEvent["source"],
            eventType: row.lastEventType!,
            priority: row.lastEventPriority as AgentEvent["priority"],
            timestamp: row.lastEventTimestamp!,
            payload: JSON.parse(row.lastEventPayload!)
          }
        : undefined
    }));
  }

  private computeFocus(): string {
    const context = this.getUserContext();

    if (context.mode === "focus") {
      return "Deep work + assignment completion";
    }

    if (context.mode === "recovery") {
      return "Light planning + recovery tasks";
    }

    return "Balanced schedule with deadlines first";
  }

  private updateAgent(name: AgentName, patch: Partial<AgentState>): void {
    const current = this.db.prepare("SELECT * FROM agent_states WHERE name = ?").get(name) as
      | {
          name: string;
          status: string;
          lastRunAt: string | null;
        }
      | undefined;

    if (!current) {
      return;
    }

    const next = {
      status: patch.status ?? current.status,
      lastRunAt: patch.lastRunAt ?? current.lastRunAt
    };

    if (patch.lastEvent) {
      this.db
        .prepare(
          `UPDATE agent_states SET status = ?, lastRunAt = ?,
           lastEventId = ?, lastEventSource = ?, lastEventType = ?,
           lastEventPriority = ?, lastEventTimestamp = ?, lastEventPayload = ?
           WHERE name = ?`
        )
        .run(
          next.status,
          next.lastRunAt,
          patch.lastEvent.id,
          patch.lastEvent.source,
          patch.lastEvent.eventType,
          patch.lastEvent.priority,
          patch.lastEvent.timestamp,
          JSON.stringify(patch.lastEvent.payload),
          name
        );
    } else {
      this.db.prepare("UPDATE agent_states SET status = ?, lastRunAt = ? WHERE name = ?").run(next.status, next.lastRunAt, name);
    }
  }

  private isInQuietHours(timestamp: string): boolean {
    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
      return false;
    }

    const hour = date.getHours();
    const prefs = this.getNotificationPreferences();
    const { startHour, endHour } = prefs.quietHours;

    if (startHour === endHour) {
      return true;
    }

    if (startHour < endHour) {
      return hour >= startHour && hour < endHour;
    }

    return hour >= startHour || hour < endHour;
  }

  /**
   * Schedule a notification for future delivery at optimal time
   */
  scheduleNotification(
    notification: Omit<Notification, "id" | "timestamp">,
    scheduledFor: Date,
    eventId?: string
  ): ScheduledNotification {
    const scheduled: ScheduledNotification = {
      id: makeId("sched-notif"),
      notification,
      scheduledFor: scheduledFor.toISOString(),
      createdAt: nowIso(),
      eventId
    };

    this.db
      .prepare(
        `INSERT INTO scheduled_notifications (id, source, title, message, priority, scheduledFor, createdAt, eventId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        scheduled.id,
        notification.source,
        notification.title,
        notification.message,
        notification.priority,
        scheduled.scheduledFor,
        scheduled.createdAt,
        eventId ?? null
      );

    return scheduled;
  }

  /**
   * Get all scheduled notifications that are due for delivery
   */
  getDueScheduledNotifications(currentTime: Date = new Date()): ScheduledNotification[] {
    const rows = this.db
      .prepare("SELECT * FROM scheduled_notifications WHERE scheduledFor <= ? ORDER BY scheduledFor ASC")
      .all(currentTime.toISOString()) as Array<{
      id: string;
      source: string;
      title: string;
      message: string;
      priority: string;
      scheduledFor: string;
      createdAt: string;
      eventId: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      notification: {
        source: row.source as Notification["source"],
        title: row.title,
        message: row.message,
        priority: row.priority as Notification["priority"]
      },
      scheduledFor: row.scheduledFor,
      createdAt: row.createdAt,
      eventId: row.eventId ?? undefined
    }));
  }

  /**
   * Remove a scheduled notification (e.g., after delivery)
   */
  removeScheduledNotification(id: string): boolean {
    const result = this.db.prepare("DELETE FROM scheduled_notifications WHERE id = ?").run(id);
    return result.changes > 0;
  }

  /**
   * Get all deadline reminder states (for historical pattern analysis)
   */
  getAllDeadlineReminderStates(): DeadlineReminderState[] {
    const rows = this.db.prepare("SELECT * FROM deadline_reminder_state").all() as Array<{
      deadlineId: string;
      reminderCount: number;
      lastReminderAt: string | null;
      lastConfirmationAt: string | null;
      lastConfirmedCompleted: number | null;
    }>;

    return rows.map((row) => ({
      deadlineId: row.deadlineId,
      reminderCount: row.reminderCount,
      lastReminderAt: row.lastReminderAt ?? "",
      lastConfirmationAt: row.lastConfirmationAt ?? null,
      lastConfirmedCompleted: row.lastConfirmedCompleted === null ? null : Boolean(row.lastConfirmedCompleted)
    }));
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
