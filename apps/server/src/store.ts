import Database from "better-sqlite3";
import {
  AgentEvent,
  AgentName,
  AgentState,
  DashboardSnapshot,
  Deadline,
  DeadlineReminderState,
  DeadlineStatusConfirmation,
  ContextTrends,
  ExportData,
  ImportData,
  ImportResult,
  JournalEntry,
  JournalPhoto,
  JournalSyncPayload,
  LectureEvent,
  Notification,
  EmailDigest,
  EmailDigestReason,
  NotificationPreferences,
  NotificationPreferencesPatch,
  NotificationInteraction,
  NotificationInteractionMetrics,
  NotificationInteractionType,
  PushDeliveryFailureRecord,
  PushDeliveryMetrics,
  PushSubscriptionRecord,
  ScheduledNotification,
  UserContext,
  WeeklySummary,
  Cadence,
  Habit,
  HabitCheckIn,
  HabitWithStatus,
  Goal,
  GoalCheckIn,
  GoalWithStatus,
  Tag,
  Location,
  LocationHistory,
  SyncQueueItem,
  SyncQueueStatus,
  SyncOperationType,
  ChatMessage,
  ChatMessageMetadata,
  ChatHistoryPage
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
  private readonly maxChatMessages = 500;
  private readonly maxJournalEntries = 100;
  private readonly maxScheduleEvents = 200;
  private readonly maxDeadlines = 200;
  private readonly maxHabits = 100;
  private readonly maxGoals = 100;
  private readonly maxContextHistory = 500;
  private readonly maxCheckInsPerItem = 400;
  private readonly maxPushSubscriptions = 50;
  private readonly maxPushFailures = 100;
  private readonly maxEmailDigests = 50;
  private readonly maxLocations = 1000;
  private readonly maxLocationHistory = 5000;
  private notificationListeners: Array<(notification: Notification) => void> = [];
  private db: Database.Database;

  constructor(dbPath: string = "companion.db") {
    this.db = new Database(dbPath);
    this.db.pragma("foreign_keys = ON");
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

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        metadata TEXT,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS email_digests (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        reason TEXT NOT NULL,
        recipient TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        timeframeStart TEXT NOT NULL,
        timeframeEnd TEXT NOT NULL,
        generatedAt TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        clientEntryId TEXT,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        version INTEGER NOT NULL,
        photos TEXT NOT NULL DEFAULT '[]',
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS journal_entry_tags (
        entryId TEXT NOT NULL,
        tagId TEXT NOT NULL,
        PRIMARY KEY (entryId, tagId),
        FOREIGN KEY (entryId) REFERENCES journal_entries(id) ON DELETE CASCADE,
        FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS schedule_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        startTime TEXT NOT NULL,
        durationMinutes INTEGER NOT NULL,
        workload TEXT NOT NULL,
        recurrence TEXT,
        recurrenceParentId TEXT,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS deadlines (
        id TEXT PRIMARY KEY,
        course TEXT NOT NULL,
        task TEXT NOT NULL,
        dueDate TEXT NOT NULL,
        priority TEXT NOT NULL,
        completed INTEGER NOT NULL,
        canvasAssignmentId TEXT,
        canvasCourseId TEXT,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS habits (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cadence TEXT NOT NULL,
        targetPerWeek INTEGER NOT NULL,
        motivation TEXT,
        createdAt TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS habit_check_ins (
        id TEXT PRIMARY KEY,
        habitId TEXT NOT NULL,
        checkInDate TEXT NOT NULL,
        completed INTEGER NOT NULL,
        note TEXT,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000),
        UNIQUE(habitId, checkInDate)
      );

      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        cadence TEXT NOT NULL,
        targetCount INTEGER NOT NULL,
        dueDate TEXT,
        motivation TEXT,
        createdAt TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS goal_check_ins (
        id TEXT PRIMARY KEY,
        goalId TEXT NOT NULL,
        checkInDate TEXT NOT NULL,
        completed INTEGER NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000),
        UNIQUE(goalId, checkInDate)
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

      CREATE TABLE IF NOT EXISTS context_history (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        stressLevel TEXT NOT NULL,
        energyLevel TEXT NOT NULL,
        mode TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
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

      CREATE TABLE IF NOT EXISTS notification_interactions (
        id TEXT PRIMARY KEY,
        notificationId TEXT NOT NULL,
        notificationTitle TEXT NOT NULL,
        notificationSource TEXT NOT NULL,
        notificationPriority TEXT NOT NULL,
        interactionType TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        actionType TEXT,
        timeToInteractionMs INTEGER,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE INDEX IF NOT EXISTS idx_notification_interactions_timestamp
        ON notification_interactions(timestamp);
      CREATE INDEX IF NOT EXISTS idx_notification_interactions_type
        ON notification_interactions(interactionType);
      CREATE INDEX IF NOT EXISTS idx_notification_interactions_source
        ON notification_interactions(notificationSource);

      CREATE TABLE IF NOT EXISTS locations (
        id TEXT PRIMARY KEY,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL,
        timestamp TEXT NOT NULL,
        label TEXT,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS location_history (
        id TEXT PRIMARY KEY,
        locationId TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        stressLevel TEXT,
        energyLevel TEXT,
        context TEXT,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000),
        FOREIGN KEY (locationId) REFERENCES locations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_locations_timestamp ON locations(timestamp);
      CREATE INDEX IF NOT EXISTS idx_locations_label ON locations(label);
      CREATE INDEX IF NOT EXISTS idx_location_history_timestamp ON location_history(timestamp);
      CREATE INDEX IF NOT EXISTS idx_location_history_locationId ON location_history(locationId);

      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        operationType TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        lastAttemptAt TEXT,
        createdAt TEXT NOT NULL,
        completedAt TEXT,
        error TEXT,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
      CREATE INDEX IF NOT EXISTS idx_sync_queue_createdAt ON sync_queue(createdAt);
    `);

    const journalColumns = this.db.prepare("PRAGMA table_info(journal_entries)").all() as Array<{ name: string }>;
    const hasPhotosColumn = journalColumns.some((col) => col.name === "photos");
    if (!hasPhotosColumn) {
      this.db.prepare("ALTER TABLE journal_entries ADD COLUMN photos TEXT NOT NULL DEFAULT '[]'").run();
    }
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

    // Seed starter habits/goals for a fresh database
    const dateKey = (offsetDays: number): string => {
      const date = new Date();
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - offsetDays);
      return date.toISOString().slice(0, 10);
    };

    const habitCount = (this.db.prepare("SELECT COUNT(*) as count FROM habits").get() as { count: number }).count;
    if (habitCount === 0) {
      const habits: Array<Omit<Habit, "id">> = [
        {
          name: "Morning run",
          cadence: "daily",
          targetPerWeek: 5,
          motivation: "Energy before class",
          createdAt: nowIso()
        },
        {
          name: "Study sprint",
          cadence: "daily",
          targetPerWeek: 6,
          motivation: "Keep assignments moving",
          createdAt: nowIso()
        },
        {
          name: "Wind-down reading",
          cadence: "weekly",
          targetPerWeek: 4,
          motivation: "Better sleep and focus",
          createdAt: nowIso()
        }
      ];

      const insertHabit = this.db.prepare(
        "INSERT INTO habits (id, name, cadence, targetPerWeek, motivation, createdAt) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const insertHabitCheckIn = this.db.prepare(
        "INSERT INTO habit_check_ins (id, habitId, checkInDate, completed, note) VALUES (?, ?, ?, ?, ?)"
      );

      habits.forEach((habit, index) => {
        const habitId = makeId("habit");
        insertHabit.run(habitId, habit.name, habit.cadence, habit.targetPerWeek, habit.motivation ?? null, habit.createdAt);

        const completions = index === 0 ? [0, 1, 2, 4] : index === 1 ? [0, 1, 3] : [1, 3, 5];
        for (const offset of completions) {
          insertHabitCheckIn.run(makeId("habit-check"), habitId, dateKey(offset), 1, null);
        }
      });
    }

    const goalCount = (this.db.prepare("SELECT COUNT(*) as count FROM goals").get() as { count: number }).count;
    if (goalCount === 0) {
      const goals: Array<Omit<Goal, "id">> = [
        {
          title: "Publish portfolio draft",
          cadence: "daily",
          targetCount: 10,
          dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
          motivation: "Finish before internship interviews",
          createdAt: nowIso()
        },
        {
          title: "Finish algorithms PSET",
          cadence: "daily",
          targetCount: 6,
          dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
          motivation: "Stay ahead of class pace",
          createdAt: nowIso()
        }
      ];

      const insertGoal = this.db.prepare(
        "INSERT INTO goals (id, title, cadence, targetCount, dueDate, motivation, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      const insertGoalCheckIn = this.db.prepare(
        "INSERT INTO goal_check_ins (id, goalId, checkInDate, completed) VALUES (?, ?, ?, ?)"
      );

      goals.forEach((goal, index) => {
        const goalId = makeId("goal");
        insertGoal.run(goalId, goal.title, goal.cadence, goal.targetCount, goal.dueDate, goal.motivation ?? null, goal.createdAt);

        const completions = index === 0 ? [0, 1, 2, 3] : [0, 2, 4];
        for (const offset of completions) {
          insertGoalCheckIn.run(makeId("goal-check"), goalId, dateKey(offset), 1);
        }
      });
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

  private parseChatMetadata(raw: string | null): ChatMessageMetadata | undefined {
    if (!raw) {
      return undefined;
    }

    try {
      return JSON.parse(raw) as ChatMessageMetadata;
    } catch {
      return undefined;
    }
  }

  recordChatMessage(role: ChatMessage["role"], content: string, metadata?: ChatMessageMetadata): ChatMessage {
    const message: ChatMessage = {
      id: makeId("chat"),
      role,
      content,
      timestamp: nowIso(),
      ...(metadata ? { metadata } : {})
    };

    this.db
      .prepare(
        "INSERT INTO chat_messages (id, role, content, timestamp, metadata, insertOrder) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(insertOrder), 0) + 1 FROM chat_messages))"
      )
      .run(message.id, message.role, message.content, message.timestamp, metadata ? JSON.stringify(metadata) : null);

    const count = (this.db.prepare("SELECT COUNT(*) as count FROM chat_messages").get() as { count: number }).count;
    if (count > this.maxChatMessages) {
      this.db
        .prepare(
          `DELETE FROM chat_messages WHERE id IN (
            SELECT id FROM chat_messages ORDER BY insertOrder ASC LIMIT ?
          )`
        )
        .run(count - this.maxChatMessages);
    }

    return message;
  }

  getRecentChatMessages(limit: number): ChatMessage[] {
    if (limit <= 0) {
      return [];
    }

    const rows = this.db
      .prepare("SELECT id, role, content, timestamp, metadata FROM chat_messages ORDER BY insertOrder DESC LIMIT ?")
      .all(limit) as Array<{
      id: string;
      role: string;
      content: string;
      timestamp: string;
      metadata: string | null;
    }>;

    return rows
      .map((row) => ({
        id: row.id,
        role: row.role as ChatMessage["role"],
        content: row.content,
        timestamp: row.timestamp,
        metadata: this.parseChatMetadata(row.metadata)
      }))
      .reverse();
  }

  getChatHistory(options: { page?: number; pageSize?: number } = {}): ChatHistoryPage {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.max(1, Math.min(options.pageSize ?? 20, 50));
    const total = (this.db.prepare("SELECT COUNT(*) as count FROM chat_messages").get() as { count: number }).count;
    const offset = (page - 1) * pageSize;

    const rows = this.db
      .prepare("SELECT id, role, content, timestamp, metadata FROM chat_messages ORDER BY insertOrder DESC LIMIT ? OFFSET ?")
      .all(pageSize, offset) as Array<{
      id: string;
      role: string;
      content: string;
      timestamp: string;
      metadata: string | null;
    }>;

    const messages: ChatMessage[] = rows.map((row) => ({
      id: row.id,
      role: row.role as ChatMessage["role"],
      content: row.content,
      timestamp: row.timestamp,
      metadata: this.parseChatMetadata(row.metadata)
    }));

    const hasMore = offset + messages.length < total;

    return {
      messages,
      page,
      pageSize,
      total,
      hasMore
    };
  }

  private recordContextHistory(context: UserContext, timestamp: string): void {
    this.db
      .prepare("INSERT INTO context_history (id, timestamp, stressLevel, energyLevel, mode) VALUES (?, ?, ?, ?, ?)")
      .run(makeId("ctx"), timestamp, context.stressLevel, context.energyLevel, context.mode);

    const count = (this.db.prepare("SELECT COUNT(*) as count FROM context_history").get() as { count: number }).count;
    if (count > this.maxContextHistory) {
      this.db
        .prepare(
          `DELETE FROM context_history WHERE id IN (
            SELECT id FROM context_history ORDER BY insertOrder ASC LIMIT ?
          )`
        )
        .run(count - this.maxContextHistory);
    }
  }

  setUserContext(next: Partial<UserContext>): UserContext {
    const current = this.getUserContext();
    const updated = { ...current, ...next };
    const timestamp = nowIso();

    this.db
      .prepare("UPDATE user_context SET stressLevel = ?, energyLevel = ?, mode = ? WHERE id = 1")
      .run(updated.stressLevel, updated.energyLevel, updated.mode);

    this.recordContextHistory(updated, timestamp);

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

  getContextTrends(): ContextTrends {
    const history = this.db
      .prepare("SELECT timestamp, stressLevel, energyLevel, mode FROM context_history ORDER BY insertOrder DESC")
      .all() as Array<{
      timestamp: string;
      stressLevel: UserContext["stressLevel"];
      energyLevel: UserContext["energyLevel"];
      mode: UserContext["mode"];
    }>;

    const latestContext = this.getUserContext();

    if (history.length === 0) {
      return {
        sampleSize: 0,
        byHour: [],
        byDayOfWeek: [],
        recommendations: {
          bestNotificationHours: [],
          cautionHours: [],
          bestDays: []
        },
        latestContext
      };
    }

    const createBucket = () => ({
      total: 0,
      energyLevels: {
        low: 0,
        medium: 0,
        high: 0
      } as Record<UserContext["energyLevel"], number>,
      stressLevels: {
        low: 0,
        medium: 0,
        high: 0
      } as Record<UserContext["stressLevel"], number>
    });

    const hourBuckets: Record<number, ReturnType<typeof createBucket>> = {};
    const dayBuckets: Record<number, ReturnType<typeof createBucket>> = {};

    for (const entry of history) {
      const date = new Date(entry.timestamp);
      const hour = date.getUTCHours();
      const day = date.getUTCDay();

      if (!hourBuckets[hour]) {
        hourBuckets[hour] = createBucket();
      }
      if (!dayBuckets[day]) {
        dayBuckets[day] = createBucket();
      }

      hourBuckets[hour].total += 1;
      hourBuckets[hour].energyLevels[entry.energyLevel] += 1;
      hourBuckets[hour].stressLevels[entry.stressLevel] += 1;

      dayBuckets[day].total += 1;
      dayBuckets[day].energyLevels[entry.energyLevel] += 1;
      dayBuckets[day].stressLevels[entry.stressLevel] += 1;
    }

    const pickDominant = <T extends string>(counts: Record<T, number>, fallback: T): T => {
      const sorted = Object.entries(counts) as Array<[T, number]>;
      sorted.sort((a, b) => b[1] - a[1]);
      return sorted[0]?.[0] ?? fallback;
    };

    const byHour = Object.entries(hourBuckets)
      .map(([hour, bucket]) => ({
        hour: Number(hour),
        total: bucket.total,
        energyLevels: bucket.energyLevels,
        stressLevels: bucket.stressLevels,
        dominantEnergy: pickDominant(bucket.energyLevels, "medium"),
        dominantStress: pickDominant(bucket.stressLevels, "medium")
      }))
      .sort((a, b) => a.hour - b.hour);

    const byDayOfWeek = Object.entries(dayBuckets)
      .map(([day, bucket]) => ({
        dayOfWeek: Number(day),
        total: bucket.total,
        energyLevels: bucket.energyLevels,
        stressLevels: bucket.stressLevels,
        dominantEnergy: pickDominant(bucket.energyLevels, "medium"),
        dominantStress: pickDominant(bucket.stressLevels, "medium")
      }))
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek);

    const scoredHours = byHour.map((bucket) => ({
      hour: bucket.hour,
      score: bucket.energyLevels.high * 2 + bucket.energyLevels.medium - (bucket.stressLevels.high * 2 + bucket.stressLevels.medium)
    }));

    const bestNotificationHours = scoredHours
      .slice()
      .sort((a, b) => b.score - a.score || a.hour - b.hour)
      .filter((entry) => entry.score > 0)
      .slice(0, 5)
      .map((entry) => entry.hour);

    const fallbackHours = scoredHours
      .slice()
      .sort((a, b) => b.score - a.score || a.hour - b.hour)
      .slice(0, 3)
      .map((entry) => entry.hour);

    const cautionHours = byHour
      .slice()
      .sort(
        (a, b) =>
          b.stressLevels.high + b.stressLevels.medium - (a.stressLevels.high + a.stressLevels.medium) ||
          b.total - a.total
      )
      .filter((bucket) => bucket.stressLevels.high > 0 || bucket.stressLevels.medium > bucket.stressLevels.low)
      .slice(0, 3)
      .map((bucket) => bucket.hour);

    const bestDays = byDayOfWeek
      .map((bucket) => ({
        dayOfWeek: bucket.dayOfWeek,
        score: bucket.energyLevels.high * 2 + bucket.energyLevels.medium - (bucket.stressLevels.high * 2 + bucket.stressLevels.medium)
      }))
      .sort((a, b) => b.score - a.score || a.dayOfWeek - b.dayOfWeek)
      .filter((entry) => entry.score > 0)
      .slice(0, 3)
      .map((entry) => entry.dayOfWeek);

    return {
      sampleSize: history.length,
      byHour,
      byDayOfWeek,
      recommendations: {
        bestNotificationHours: bestNotificationHours.length > 0 ? bestNotificationHours : fallbackHours,
        cautionHours,
        bestDays
      },
      latestContext
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

  getTags(): Tag[] {
    const rows = this.db.prepare("SELECT id, name FROM tags ORDER BY insertOrder DESC").all() as Array<{ id: string; name: string }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name
    }));
  }

  createTag(name: string): Tag {
    const trimmed = name.trim();

    if (!trimmed) {
      throw new Error("Tag name is required");
    }

    const tag: Tag = {
      id: makeId("tag"),
      name: trimmed
    };

    this.db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").run(tag.id, tag.name);

    return tag;
  }

  updateTag(id: string, name: string): Tag | null {
    const trimmed = name.trim();

    if (!trimmed) {
      throw new Error("Tag name is required");
    }

    const exists = this.db.prepare("SELECT id FROM tags WHERE id = ?").get(id) as { id: string } | undefined;
    if (!exists) {
      return null;
    }

    this.db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(trimmed, id);
    return { id, name: trimmed };
  }

  deleteTag(id: string): boolean {
    const result = this.db.prepare("DELETE FROM tags WHERE id = ?").run(id);
    return result.changes > 0;
  }

  areValidTagIds(tagIds: string[]): boolean {
    if (tagIds.length === 0) {
      return true;
    }

    const uniqueIds = Array.from(new Set(tagIds));
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const rows = this.db.prepare(`SELECT id FROM tags WHERE id IN (${placeholders})`).all(...uniqueIds) as Array<{ id: string }>;

    return rows.length === uniqueIds.length;
  }

  private resolveTags(tagIds: string[]): Tag[] {
    if (tagIds.length === 0) {
      return [];
    }

    const uniqueIds = Array.from(new Set(tagIds));
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT id, name FROM tags WHERE id IN (${placeholders})`)
      .all(...uniqueIds) as Array<{ id: string; name: string }>;

    if (rows.length !== uniqueIds.length) {
      throw new Error("Invalid tag ids");
    }

    return uniqueIds.map((id) => {
      const tag = rows.find((row) => row.id === id)!;
      return { id: tag.id, name: tag.name };
    });
  }

  private getTagsForEntry(entryId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT tags.id as id, tags.name as name
         FROM journal_entry_tags jet
         JOIN tags ON tags.id = jet.tagId
         WHERE jet.entryId = ?
         ORDER BY tags.insertOrder DESC`
      )
      .all(entryId) as Array<{ id: string; name: string }>;

    return rows.map((row) => row.name);
  }

  private setEntryTags(entryId: string, tagIds: string[]): string[] {
    const tags = this.resolveTags(tagIds);

    this.db.prepare("DELETE FROM journal_entry_tags WHERE entryId = ?").run(entryId);

    if (tags.length > 0) {
      const insert = this.db.prepare("INSERT INTO journal_entry_tags (entryId, tagId) VALUES (?, ?)");
      const insertMany = this.db.transaction((ids: string[]) => {
        ids.forEach((id) => insert.run(entryId, id));
      });

      insertMany(Array.from(new Set(tagIds)));
    }

    return tags.map(tag => tag.name);
  }

  private normalizePhotos(photos?: JournalPhoto[]): JournalPhoto[] {
    if (!photos || photos.length === 0) {
      return [];
    }

    return photos
      .filter((photo) => Boolean(photo?.dataUrl))
      .map((photo) => ({
        id: photo.id ?? makeId("photo"),
        dataUrl: photo.dataUrl,
        fileName: photo.fileName
      }));
  }

  private parsePhotos(raw: string | null | undefined): JournalPhoto[] {
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      const photos: JournalPhoto[] = [];
      parsed.forEach((photo) => {
        if (typeof photo !== "object" || photo === null) return;
        const candidate = photo as { id?: string; dataUrl?: string; fileName?: string };
        if (!candidate.dataUrl || typeof candidate.dataUrl !== "string") return;
        photos.push({
          id: candidate.id ?? makeId("photo"),
          dataUrl: candidate.dataUrl,
          fileName: typeof candidate.fileName === "string" ? candidate.fileName : undefined
        });
      });

      return photos;
    } catch {
      return [];
    }
  }

  private trimJournalEntriesIfNeeded(): void {
    const count = (this.db.prepare("SELECT COUNT(*) as count FROM journal_entries").get() as { count: number }).count;
    if (count > this.maxJournalEntries) {
      const removeIds = this.db
        .prepare("SELECT id FROM journal_entries ORDER BY insertOrder ASC LIMIT ?")
        .all(count - this.maxJournalEntries) as Array<{ id: string }>;

      const deleteTagsStmt = this.db.prepare("DELETE FROM journal_entry_tags WHERE entryId = ?");
      const deleteEntryStmt = this.db.prepare("DELETE FROM journal_entries WHERE id = ?");
      const transaction = this.db.transaction((ids: string[]) => {
        ids.forEach((id) => {
          deleteTagsStmt.run(id);
          deleteEntryStmt.run(id);
        });
      });

      transaction(removeIds.map((row) => row.id));
    }
  }

  recordJournalEntry(content: string, tagIds: string[] = [], photos?: JournalPhoto[]): JournalEntry {
    const timestamp = nowIso();
    const entry: Omit<JournalEntry, "tags"> = {
      id: makeId("journal"),
      content,
      timestamp,
      updatedAt: timestamp,
      version: 1
    };

    const normalizedPhotos = this.normalizePhotos(photos);
    this.resolveTags(tagIds);

    this.db
      .prepare(
        "INSERT INTO journal_entries (id, clientEntryId, content, timestamp, updatedAt, version, photos) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(entry.id, null, entry.content, entry.timestamp, entry.updatedAt, entry.version, JSON.stringify(normalizedPhotos));

    const tags = this.setEntryTags(entry.id, tagIds);

    this.trimJournalEntriesIfNeeded();

    return {
      ...entry,
      tags,
      photos: normalizedPhotos
    };
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
      version: row.version,
      tags: this.getTagsForEntry(row.id),
      photos: this.parsePhotos((row as { photos?: string | null }).photos)
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
            version: (existingRow as { version: number }).version,
            tags: this.getTagsForEntry((existingRow as { id: string }).id),
            photos: this.parsePhotos((existingRow as { photos?: string | null }).photos)
          } as JournalEntry)
        : null;

      if (!existing) {
        const newTags = payload.tags ? this.resolveTags(payload.tags).map(tag => tag.name) : [];
        const newPhotos = this.normalizePhotos(payload.photos);

        const createdBase: Omit<JournalEntry, "tags"> = {
          id: payload.id ?? makeId("journal"),
          clientEntryId: payload.clientEntryId,
          content: payload.content,
          timestamp: payload.timestamp,
          updatedAt: nowIso(),
          version: 1,
          photos: newPhotos
        };

        this.db
          .prepare(
            "INSERT INTO journal_entries (id, clientEntryId, content, timestamp, updatedAt, version, photos) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .run(
            createdBase.id,
            createdBase.clientEntryId ?? null,
            createdBase.content,
            createdBase.timestamp,
            createdBase.updatedAt,
            createdBase.version,
            JSON.stringify(newPhotos)
          );

        this.setEntryTags(createdBase.id, payload.tags ?? []);

        // Trim to maxJournalEntries
        this.trimJournalEntriesIfNeeded();

        applied.push({
          ...createdBase,
          tags: newTags
        });
        continue;
      }

      if (payload.baseVersion !== undefined && payload.baseVersion !== existing.version) {
        conflicts.push(existing);
        continue;
      }

      const mergedBase: Omit<JournalEntry, "tags"> = {
        ...existing,
        content: payload.content,
        timestamp: payload.timestamp,
        updatedAt: nowIso(),
        version: existing.version + 1,
        clientEntryId: payload.clientEntryId,
        photos: payload.photos !== undefined ? this.normalizePhotos(payload.photos) : existing.photos
      };

      const nextTags = payload.tags !== undefined ? this.resolveTags(payload.tags).map(tag => tag.name) : existing.tags;

      this.db
        .prepare("UPDATE journal_entries SET content = ?, timestamp = ?, updatedAt = ?, version = ?, clientEntryId = ?, photos = ? WHERE id = ?")
        .run(
          mergedBase.content,
          mergedBase.timestamp,
          mergedBase.updatedAt,
          mergedBase.version,
          mergedBase.clientEntryId ?? null,
          JSON.stringify(mergedBase.photos ?? []),
          mergedBase.id
        );

      if (payload.tags !== undefined) {
        this.setEntryTags(mergedBase.id, payload.tags);
      }

      applied.push({
        ...mergedBase,
        tags: nextTags
      });
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
      version: row.version,
      tags: this.getTagsForEntry(row.id),
      photos: this.parsePhotos((row as { photos?: string | null }).photos)
    }));
  }

  searchJournalEntries(options: {
    query?: string;
    startDate?: string;
    endDate?: string;
    tagIds?: string[];
    limit?: number;
  }): JournalEntry[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.query && options.query.trim()) {
      conditions.push("content LIKE ?");
      params.push(`%${options.query.trim()}%`);
    }

    if (options.startDate) {
      conditions.push("timestamp >= ?");
      params.push(options.startDate);
    }

    if (options.endDate) {
      conditions.push("timestamp <= ?");
      params.push(options.endDate);
    }

    if (options.tagIds && options.tagIds.length > 0) {
      const uniqueTagIds = Array.from(new Set(options.tagIds));
      const placeholders = uniqueTagIds.map(() => "?").join(", ");
      conditions.push(
        `id IN (
          SELECT entryId FROM journal_entry_tags
          WHERE tagId IN (${placeholders})
          GROUP BY entryId
          HAVING COUNT(DISTINCT tagId) = ?
        )`
      );
      params.push(...uniqueTagIds, uniqueTagIds.length);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitClause = options.limit !== undefined && options.limit > 0 ? "LIMIT ?" : "";

    if (limitClause) {
      params.push(options.limit!);
    }

    const query = `SELECT * FROM journal_entries ${whereClause} ORDER BY timestamp DESC ${limitClause}`.trim();

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string;
      clientEntryId: string | null;
      content: string;
      timestamp: string;
      updatedAt: string;
      version: number;
      photos?: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      clientEntryId: row.clientEntryId ?? undefined,
      content: row.content,
      timestamp: row.timestamp,
      updatedAt: row.updatedAt,
      version: row.version,
      tags: this.getTagsForEntry(row.id),
      photos: this.parsePhotos(row.photos)
    }));
  }

  createLectureEvent(entry: Omit<LectureEvent, "id">): LectureEvent {
    const lectureEvent: LectureEvent = {
      id: makeId("lecture"),
      ...entry
    };

    const recurrenceJson = lectureEvent.recurrence ? JSON.stringify(lectureEvent.recurrence) : null;

    this.db
      .prepare("INSERT INTO schedule_events (id, title, startTime, durationMinutes, workload, recurrence, recurrenceParentId) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(lectureEvent.id, lectureEvent.title, lectureEvent.startTime, lectureEvent.durationMinutes, lectureEvent.workload, recurrenceJson, lectureEvent.recurrenceParentId ?? null);

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
      recurrence: string | null;
      recurrenceParentId: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      startTime: row.startTime,
      durationMinutes: row.durationMinutes,
      workload: row.workload as LectureEvent["workload"],
      ...(row.recurrence ? { recurrence: JSON.parse(row.recurrence) } : {}),
      ...(row.recurrenceParentId ? { recurrenceParentId: row.recurrenceParentId } : {})
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
          recurrence: string | null;
          recurrenceParentId: string | null;
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
      workload: row.workload as LectureEvent["workload"],
      ...(row.recurrence ? { recurrence: JSON.parse(row.recurrence) } : {}),
      ...(row.recurrenceParentId ? { recurrenceParentId: row.recurrenceParentId } : {})
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

    const recurrenceJson = next.recurrence ? JSON.stringify(next.recurrence) : null;

    this.db
      .prepare("UPDATE schedule_events SET title = ?, startTime = ?, durationMinutes = ?, workload = ?, recurrence = ?, recurrenceParentId = ? WHERE id = ?")
      .run(next.title, next.startTime, next.durationMinutes, next.workload, recurrenceJson, next.recurrenceParentId ?? null, id);

    return next;
  }

  deleteScheduleEvent(id: string): boolean {
    const result = this.db.prepare("DELETE FROM schedule_events WHERE id = ?").run(id);
    return result.changes > 0;
  }

  upsertScheduleEvents(
    toCreate: Array<Omit<LectureEvent, "id">>,
    toUpdate: Array<{ id: string; event: Partial<Omit<LectureEvent, "id">> }>,
    toDelete: string[]
  ): { created: number; updated: number; deleted: number } {
    let created = 0;
    let updated = 0;
    let deleted = 0;

    // Delete events
    for (const id of toDelete) {
      if (this.deleteScheduleEvent(id)) {
        deleted += 1;
      }
    }

    // Update events
    for (const { id, event } of toUpdate) {
      if (this.updateScheduleEvent(id, event)) {
        updated += 1;
      }
    }

    // Create events
    for (const event of toCreate) {
      this.createLectureEvent(event);
      created += 1;
    }

    return { created, updated, deleted };
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

  private applyDeadlinePriorityEscalation(deadline: Deadline, referenceDate: Date): Deadline {
    if (deadline.completed) {
      return deadline;
    }

    const dueMs = new Date(deadline.dueDate).getTime();
    if (Number.isNaN(dueMs)) {
      return deadline;
    }

    const hoursUntilDue = (dueMs - referenceDate.getTime()) / 3_600_000;
    let priority = deadline.priority;

    if (hoursUntilDue <= 0) {
      priority = "critical";
    } else if (hoursUntilDue <= 24) {
      if (priority === "high") {
        priority = "critical";
      } else if (priority === "medium") {
        priority = "high";
      } else if (priority === "low") {
        priority = "medium";
      }
    } else if (hoursUntilDue <= 48) {
      if (priority === "medium") {
        priority = "high";
      } else if (priority === "low") {
        priority = "medium";
      }
    } else if (hoursUntilDue <= 72 && priority === "low") {
      priority = "medium";
    }

    if (priority === deadline.priority) {
      return deadline;
    }

    return {
      ...deadline,
      priority
    };
  }

  getDeadlines(referenceDate: Date = new Date(), applyEscalation = true): Deadline[] {
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
    })).map((deadline) => (applyEscalation ? this.applyDeadlinePriorityEscalation(deadline, referenceDate) : deadline));
  }

  getDeadlineById(id: string, applyEscalation = true, referenceDate: Date = new Date()): Deadline | null {
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

    const deadline: Deadline = {
      id: row.id,
      course: row.course,
      task: row.task,
      dueDate: row.dueDate,
      priority: row.priority as Deadline["priority"],
      completed: Boolean(row.completed)
    };

    return applyEscalation ? this.applyDeadlinePriorityEscalation(deadline, referenceDate) : deadline;
  }

  updateDeadline(id: string, patch: Partial<Omit<Deadline, "id">>): Deadline | null {
    const existing = this.getDeadlineById(id, false);

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

    return this.applyDeadlinePriorityEscalation(next, new Date());
  }

  deleteDeadline(id: string): boolean {
    const result = this.db.prepare("DELETE FROM deadlines WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM deadline_reminder_state WHERE deadlineId = ?").run(id);
    return result.changes > 0;
  }

  createHabit(entry: Omit<Habit, "id" | "createdAt"> & { createdAt?: string }): HabitWithStatus {
    const habit: Habit = {
      id: makeId("habit"),
      createdAt: entry.createdAt ?? nowIso(),
      ...entry
    };

    this.db
      .prepare("INSERT INTO habits (id, name, cadence, targetPerWeek, motivation, createdAt) VALUES (?, ?, ?, ?, ?, ?)")
      .run(habit.id, habit.name, habit.cadence, habit.targetPerWeek, habit.motivation ?? null, habit.createdAt);

    const count = (this.db.prepare("SELECT COUNT(*) as count FROM habits").get() as { count: number }).count;
    if (count > this.maxHabits) {
      const removeIds = this.db
        .prepare("SELECT id FROM habits ORDER BY insertOrder ASC LIMIT ?")
        .all(count - this.maxHabits) as Array<{ id: string }>;
      const ids = removeIds.map((row) => row.id);
      const deleteStmt = this.db.prepare("DELETE FROM habits WHERE id = ?");
      const deleteCheckIns = this.db.prepare("DELETE FROM habit_check_ins WHERE habitId = ?");
      ids.forEach((id) => {
        deleteStmt.run(id);
        deleteCheckIns.run(id);
      });
    }

    return this.getHabitWithStatus(habit.id)!;
  }

  getHabits(): Habit[] {
    const rows = this.db.prepare("SELECT * FROM habits ORDER BY insertOrder DESC").all() as Array<{
      id: string;
      name: string;
      cadence: string;
      targetPerWeek: number;
      motivation: string | null;
      createdAt: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      cadence: row.cadence as Cadence,
      targetPerWeek: row.targetPerWeek,
      motivation: row.motivation ?? undefined,
      createdAt: row.createdAt
    }));
  }

  getHabitById(id: string): Habit | null {
    const row = this.db.prepare("SELECT * FROM habits WHERE id = ?").get(id) as
      | {
          id: string;
          name: string;
          cadence: string;
          targetPerWeek: number;
          motivation: string | null;
          createdAt: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      cadence: row.cadence as Cadence,
      targetPerWeek: row.targetPerWeek,
      motivation: row.motivation ?? undefined,
      createdAt: row.createdAt
    };
  }

  getHabitsWithStatus(): HabitWithStatus[] {
    return this.getHabits()
      .map((habit) => this.getHabitWithStatus(habit.id))
      .filter((habit): habit is HabitWithStatus => Boolean(habit));
  }

  toggleHabitCheckIn(
    habitId: string,
    options: {
      completed?: boolean;
      date?: string;
      note?: string;
    } = {}
  ): HabitWithStatus | null {
    const habit = this.getHabitById(habitId);
    if (!habit) {
      return null;
    }

    const dateKey = this.toDateKey(options.date ?? nowIso());
    const existing = this.db
      .prepare("SELECT id, completed FROM habit_check_ins WHERE habitId = ? AND checkInDate = ?")
      .get(habitId, dateKey) as { id: string; completed: number } | undefined;

    const desired = options.completed ?? (existing ? !Boolean(existing.completed) : true);

    if (existing) {
      this.db.prepare("UPDATE habit_check_ins SET completed = ?, note = ? WHERE id = ?").run(desired ? 1 : 0, options.note ?? null, existing.id);
    } else {
      this.db
        .prepare(
          "INSERT INTO habit_check_ins (id, habitId, checkInDate, completed, note) VALUES (?, ?, ?, ?, ?)"
        )
        .run(makeId("habit-check"), habitId, dateKey, desired ? 1 : 0, options.note ?? null);
    }

    this.trimCheckIns("habit_check_ins", "habitId", habitId);

    return this.getHabitWithStatus(habitId);
  }

  private getHabitWithStatus(id: string): HabitWithStatus | null {
    const habit = this.getHabitById(id);
    if (!habit) {
      return null;
    }

    const checkIns = this.getHabitCheckIns(id);
    const todayKey = this.toDateKey();
    const recent = this.buildRecentCheckIns(checkIns);
    const completionRate7d = recent.length === 0 ? 0 : Math.round((recent.filter((c) => c.completed).length / recent.length) * 100);
    const streak = this.computeStreak(checkIns, todayKey);
    const todayCompleted = recent.find((c) => c.date === todayKey)?.completed ?? false;

    return {
      ...habit,
      todayCompleted,
      streak,
      completionRate7d,
      recentCheckIns: recent
    };
  }

  private getHabitCheckIns(habitId: string): HabitCheckIn[] {
    const rows = this.db
      .prepare("SELECT * FROM habit_check_ins WHERE habitId = ? ORDER BY checkInDate DESC")
      .all(habitId) as Array<{
      id: string;
      habitId: string;
      checkInDate: string;
      completed: number;
      note: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      habitId: row.habitId,
      date: row.checkInDate,
      completed: Boolean(row.completed),
      note: row.note ?? undefined
    }));
  }

  createGoal(entry: Omit<Goal, "id" | "createdAt"> & { createdAt?: string }): GoalWithStatus {
    const goal: Goal = {
      id: makeId("goal"),
      createdAt: entry.createdAt ?? nowIso(),
      ...entry
    };

    this.db
      .prepare("INSERT INTO goals (id, title, cadence, targetCount, dueDate, motivation, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(goal.id, goal.title, goal.cadence, goal.targetCount, goal.dueDate ?? null, goal.motivation ?? null, goal.createdAt);

    const count = (this.db.prepare("SELECT COUNT(*) as count FROM goals").get() as { count: number }).count;
    if (count > this.maxGoals) {
      const removeIds = this.db
        .prepare("SELECT id FROM goals ORDER BY insertOrder ASC LIMIT ?")
        .all(count - this.maxGoals) as Array<{ id: string }>;
      const deleteStmt = this.db.prepare("DELETE FROM goals WHERE id = ?");
      const deleteCheckIns = this.db.prepare("DELETE FROM goal_check_ins WHERE goalId = ?");
      removeIds.forEach((row) => {
        deleteStmt.run(row.id);
        deleteCheckIns.run(row.id);
      });
    }

    return this.getGoalWithStatus(goal.id)!;
  }

  getGoals(): Goal[] {
    const rows = this.db.prepare("SELECT * FROM goals ORDER BY insertOrder DESC").all() as Array<{
      id: string;
      title: string;
      cadence: string;
      targetCount: number;
      dueDate: string | null;
      motivation: string | null;
      createdAt: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      cadence: row.cadence as Cadence,
      targetCount: row.targetCount,
      dueDate: row.dueDate,
      motivation: row.motivation ?? undefined,
      createdAt: row.createdAt
    }));
  }

  getGoalById(id: string): Goal | null {
    const row = this.db.prepare("SELECT * FROM goals WHERE id = ?").get(id) as
      | {
          id: string;
          title: string;
          cadence: string;
          targetCount: number;
          dueDate: string | null;
          motivation: string | null;
          createdAt: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      cadence: row.cadence as Cadence,
      targetCount: row.targetCount,
      dueDate: row.dueDate,
      motivation: row.motivation ?? undefined,
      createdAt: row.createdAt
    };
  }

  getGoalsWithStatus(): GoalWithStatus[] {
    return this.getGoals()
      .map((goal) => this.getGoalWithStatus(goal.id))
      .filter((goal): goal is GoalWithStatus => Boolean(goal));
  }

  toggleGoalCheckIn(goalId: string, options: { completed?: boolean; date?: string } = {}): GoalWithStatus | null {
    const goal = this.getGoalById(goalId);
    if (!goal) {
      return null;
    }

    const dateKey = this.toDateKey(options.date ?? nowIso());
    const existing = this.db
      .prepare("SELECT id, completed FROM goal_check_ins WHERE goalId = ? AND checkInDate = ?")
      .get(goalId, dateKey) as { id: string; completed: number } | undefined;

    const desired = options.completed ?? (existing ? !Boolean(existing.completed) : true);

    if (existing) {
      this.db.prepare("UPDATE goal_check_ins SET completed = ? WHERE id = ?").run(desired ? 1 : 0, existing.id);
    } else {
      this.db
        .prepare("INSERT INTO goal_check_ins (id, goalId, checkInDate, completed) VALUES (?, ?, ?, ?)")
        .run(makeId("goal-check"), goalId, dateKey, desired ? 1 : 0);
    }

    this.trimCheckIns("goal_check_ins", "goalId", goalId);

    return this.getGoalWithStatus(goalId);
  }

  private getGoalWithStatus(id: string): GoalWithStatus | null {
    const goal = this.getGoalById(id);
    if (!goal) {
      return null;
    }

    const checkIns = this.getGoalCheckIns(id);
    const todayKey = this.toDateKey();
    const recent = this.buildRecentCheckIns(checkIns);
    const completionRate7d = recent.length === 0 ? 0 : Math.round((recent.filter((c) => c.completed).length / recent.length) * 100);
    const streak = this.computeStreak(checkIns, todayKey);
    const todayCompleted = recent.find((c) => c.date === todayKey)?.completed ?? false;
    const progressCount = checkIns.filter((c) => c.completed).length;
    const remaining = Math.max(goal.targetCount - progressCount, 0);

    return {
      ...goal,
      progressCount,
      remaining,
      todayCompleted,
      streak,
      completionRate7d,
      recentCheckIns: recent
    };
  }

  private getGoalCheckIns(goalId: string): GoalCheckIn[] {
    const rows = this.db
      .prepare("SELECT * FROM goal_check_ins WHERE goalId = ? ORDER BY checkInDate DESC")
      .all(goalId) as Array<{
      id: string;
      goalId: string;
      checkInDate: string;
      completed: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      goalId: row.goalId,
      date: row.checkInDate,
      completed: Boolean(row.completed)
    }));
  }

  getOverdueDeadlinesRequiringReminder(referenceDate: string = nowIso(), cooldownMinutes = 180): Deadline[] {
    const reference = new Date(referenceDate);
    const nowMs = reference.getTime();

    if (Number.isNaN(nowMs)) {
      return [];
    }

    const cooldownMs = Math.max(0, cooldownMinutes) * 60_000;

    const deadlines = this.getDeadlines(reference);

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

  recordEmailDigest(entry: Omit<EmailDigest, "id" | "generatedAt"> & { generatedAt?: string }): EmailDigest {
    const digest: EmailDigest = {
      ...entry,
      id: makeId("email-digest"),
      generatedAt: entry.generatedAt ?? nowIso()
    };

    this.db
      .prepare(
        `INSERT INTO email_digests (id, type, reason, recipient, subject, body, timeframeStart, timeframeEnd, generatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        digest.id,
        digest.type,
        digest.reason,
        digest.recipient,
        digest.subject,
        digest.body,
        digest.timeframeStart,
        digest.timeframeEnd,
        digest.generatedAt
      );

    const count = (this.db.prepare("SELECT COUNT(*) as count FROM email_digests").get() as { count: number }).count;
    if (count > this.maxEmailDigests) {
      this.db
        .prepare(
          `DELETE FROM email_digests WHERE id IN (
            SELECT id FROM email_digests ORDER BY insertOrder ASC LIMIT ?
          )`
        )
        .run(count - this.maxEmailDigests);
    }

    return digest;
  }

  getEmailDigests(limit: number = this.maxEmailDigests): EmailDigest[] {
    const rows = this.db
      .prepare("SELECT * FROM email_digests ORDER BY insertOrder DESC LIMIT ?")
      .all(limit) as Array<{
      id: string;
      type: EmailDigest["type"];
      reason: EmailDigestReason;
      recipient: string;
      subject: string;
      body: string;
      timeframeStart: string;
      timeframeEnd: string;
      generatedAt: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      reason: row.reason,
      recipient: row.recipient,
      subject: row.subject,
      body: row.body,
      timeframeStart: row.timeframeStart,
      timeframeEnd: row.timeframeEnd,
      generatedAt: row.generatedAt
    }));
  }

  getLastEmailDigest(type?: EmailDigest["type"]): EmailDigest | null {
    const query = type
      ? "SELECT * FROM email_digests WHERE type = ? ORDER BY insertOrder DESC LIMIT 1"
      : "SELECT * FROM email_digests ORDER BY insertOrder DESC LIMIT 1";
    const row = type ? this.db.prepare(query).get(type) : this.db.prepare(query).get();

    if (!row) {
      return null;
    }

    const digestRow = row as {
      id: string;
      type: EmailDigest["type"];
      reason: EmailDigestReason;
      recipient: string;
      subject: string;
      body: string;
      timeframeStart: string;
      timeframeEnd: string;
      generatedAt: string;
    };

    return {
      id: digestRow.id,
      type: digestRow.type,
      reason: digestRow.reason,
      recipient: digestRow.recipient,
      subject: digestRow.subject,
      body: digestRow.body,
      timeframeStart: digestRow.timeframeStart,
      timeframeEnd: digestRow.timeframeEnd,
      generatedAt: digestRow.generatedAt
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

  getExportData(): ExportData {
    return {
      exportedAt: nowIso(),
      version: "1.0",
      journals: this.getJournalEntries(),
      tags: this.getTags(),
      schedule: this.getScheduleEvents(),
      deadlines: this.getDeadlines(),
      habits: this.getHabitsWithStatus(),
      goals: this.getGoalsWithStatus(),
      userContext: this.getUserContext(),
      notificationPreferences: this.getNotificationPreferences()
    };
  }

  importData(data: ImportData): ImportResult {
    const result: ImportResult = {
      imported: {
        journals: 0,
        schedule: 0,
        deadlines: 0,
        habits: 0,
        goals: 0
      },
      conflicts: {
        journals: []
      },
      warnings: []
    };

    // Version compatibility check
    if (data.version && data.version !== "1.0") {
      result.warnings.push(`Import version ${data.version} may not be fully compatible with current version 1.0`);
    }

    // Import journals using existing sync logic for conflict resolution
    if (data.journals && data.journals.length > 0) {
      const syncPayloads: JournalSyncPayload[] = data.journals.map((journal) => ({
        id: journal.id,
        clientEntryId: journal.clientEntryId ?? `import-${journal.id}`,
        content: journal.content,
        timestamp: journal.timestamp,
        baseVersion: undefined, // No base version for import = always apply if no conflict
        photos: journal.photos
      }));

      const syncResult = this.syncJournalEntries(syncPayloads);
      result.imported.journals = syncResult.applied.length;
      result.conflicts.journals = syncResult.conflicts;
    }

    // Import schedule events - use INSERT OR REPLACE to handle conflicts
    if (data.schedule && data.schedule.length > 0) {
      for (const event of data.schedule) {
        try {
          // Check if event already exists
          const existing = this.db.prepare("SELECT id FROM schedule_events WHERE id = ?").get(event.id);

          if (existing) {
            // Update existing event
            this.db
              .prepare("UPDATE schedule_events SET title = ?, startTime = ?, durationMinutes = ?, workload = ? WHERE id = ?")
              .run(event.title, event.startTime, event.durationMinutes, event.workload, event.id);
          } else {
            // Insert new event
            this.db
              .prepare("INSERT INTO schedule_events (id, title, startTime, durationMinutes, workload) VALUES (?, ?, ?, ?, ?)")
              .run(event.id, event.title, event.startTime, event.durationMinutes, event.workload);
          }

          result.imported.schedule += 1;
        } catch (error) {
          result.warnings.push(`Failed to import schedule event ${event.id}: ${error}`);
        }
      }

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
    }

    // Import deadlines
    if (data.deadlines && data.deadlines.length > 0) {
      for (const deadline of data.deadlines) {
        try {
          const existing = this.db.prepare("SELECT id FROM deadlines WHERE id = ?").get(deadline.id);

          if (existing) {
            // Update existing deadline
            this.db
              .prepare("UPDATE deadlines SET course = ?, task = ?, dueDate = ?, priority = ?, completed = ? WHERE id = ?")
              .run(deadline.course, deadline.task, deadline.dueDate, deadline.priority, deadline.completed ? 1 : 0, deadline.id);
          } else {
            // Insert new deadline
            this.db
              .prepare("INSERT INTO deadlines (id, course, task, dueDate, priority, completed) VALUES (?, ?, ?, ?, ?, ?)")
              .run(deadline.id, deadline.course, deadline.task, deadline.dueDate, deadline.priority, deadline.completed ? 1 : 0);
          }

          result.imported.deadlines += 1;
        } catch (error) {
          result.warnings.push(`Failed to import deadline ${deadline.id}: ${error}`);
        }
      }

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
    }

    // Import habits
    if (data.habits && data.habits.length > 0) {
      for (const habit of data.habits) {
        try {
          const existing = this.db.prepare("SELECT id FROM habits WHERE id = ?").get(habit.id);

          if (existing) {
            // Update existing habit
            this.db
              .prepare("UPDATE habits SET name = ?, cadence = ?, targetPerWeek = ?, motivation = ?, createdAt = ? WHERE id = ?")
              .run(habit.name, habit.cadence, habit.targetPerWeek, habit.motivation ?? null, habit.createdAt, habit.id);
          } else {
            // Insert new habit
            this.db
              .prepare("INSERT INTO habits (id, name, cadence, targetPerWeek, motivation, createdAt) VALUES (?, ?, ?, ?, ?, ?)")
              .run(habit.id, habit.name, habit.cadence, habit.targetPerWeek, habit.motivation ?? null, habit.createdAt);
          }

          result.imported.habits += 1;
        } catch (error) {
          result.warnings.push(`Failed to import habit ${habit.id}: ${error}`);
        }
      }

      // Trim to maxHabits
      const count = (this.db.prepare("SELECT COUNT(*) as count FROM habits").get() as { count: number }).count;
      if (count > this.maxHabits) {
        this.db
          .prepare(
            `DELETE FROM habits WHERE id IN (
              SELECT id FROM habits ORDER BY insertOrder ASC LIMIT ?
            )`
          )
          .run(count - this.maxHabits);
      }
    }

    // Import goals
    if (data.goals && data.goals.length > 0) {
      for (const goal of data.goals) {
        try {
          const existing = this.db.prepare("SELECT id FROM goals WHERE id = ?").get(goal.id);

          if (existing) {
            // Update existing goal
            this.db
              .prepare("UPDATE goals SET title = ?, cadence = ?, targetCount = ?, dueDate = ?, motivation = ?, createdAt = ? WHERE id = ?")
              .run(goal.title, goal.cadence, goal.targetCount, goal.dueDate, goal.motivation ?? null, goal.createdAt, goal.id);
          } else {
            // Insert new goal
            this.db
              .prepare("INSERT INTO goals (id, title, cadence, targetCount, dueDate, motivation, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
              .run(goal.id, goal.title, goal.cadence, goal.targetCount, goal.dueDate, goal.motivation ?? null, goal.createdAt);
          }

          result.imported.goals += 1;
        } catch (error) {
          result.warnings.push(`Failed to import goal ${goal.id}: ${error}`);
        }
      }

      // Trim to maxGoals
      const count = (this.db.prepare("SELECT COUNT(*) as count FROM goals").get() as { count: number }).count;
      if (count > this.maxGoals) {
        this.db
          .prepare(
            `DELETE FROM goals WHERE id IN (
              SELECT id FROM goals ORDER BY insertOrder ASC LIMIT ?
            )`
          )
          .run(count - this.maxGoals);
      }
    }

    // Import user context (merge with existing)
    if (data.userContext) {
      this.setUserContext(data.userContext);
    }

    // Import notification preferences (merge with existing)
    if (data.notificationPreferences) {
      this.setNotificationPreferences(data.notificationPreferences);
    }

    return result;
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
   * Snooze a notification by rescheduling it for later
   */
  snoozeNotification(notificationId: string, snoozeMinutes: number = 30): ScheduledNotification | null {
    // Find the original notification
    const notification = this.db
      .prepare("SELECT * FROM notifications WHERE id = ?")
      .get(notificationId) as {
        id: string;
        source: string;
        title: string;
        message: string;
        priority: string;
        timestamp: string;
      } | undefined;

    if (!notification) {
      return null;
    }

    // Schedule it for later
    const scheduledFor = new Date(Date.now() + snoozeMinutes * 60 * 1000);
    return this.scheduleNotification(
      {
        source: notification.source as AgentName,
        title: notification.title,
        message: notification.message,
        priority: notification.priority as Notification["priority"]
      },
      scheduledFor
    );
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

  private toDateKey(input: string | Date = new Date()): string {
    const date = typeof input === "string" ? new Date(input) : input;
    const copy = new Date(date);
    copy.setUTCHours(0, 0, 0, 0);
    return copy.toISOString().slice(0, 10);
  }

  private buildRecentCheckIns(checkIns: Array<{ date: string; completed: boolean }>, days: number = 7): Array<{ date: string; completed: boolean }> {
    const byDate = new Map<string, boolean>();
    for (const checkIn of checkIns) {
      byDate.set(this.toDateKey(checkIn.date), checkIn.completed);
    }

    const recent: Array<{ date: string; completed: boolean }> = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const day = new Date();
      day.setUTCDate(day.getUTCDate() - offset);
      const key = this.toDateKey(day);
      recent.push({
        date: key,
        completed: byDate.get(key) ?? false
      });
    }

    return recent;
  }

  private computeStreak(checkIns: Array<{ date: string; completed: boolean }>, referenceDateKey: string): number {
    const completedDates = new Set(checkIns.filter((c) => c.completed).map((c) => this.toDateKey(c.date)));
    const referenceDate = new Date(`${referenceDateKey}T00:00:00.000Z`);
    const graceWindowMs = 24 * 60 * 60 * 1000;
    let streak = 0;
    let graceUsed = false;
    let cursor = new Date(referenceDate);

    while (true) {
      const key = this.toDateKey(cursor);
      if (completedDates.has(key)) {
        streak += 1;
      } else if (!graceUsed && streak > 0 && referenceDate.getTime() - cursor.getTime() <= graceWindowMs) {
        graceUsed = true;
        streak += 1;
      } else {
        break;
      }
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    return streak;
  }

  private trimCheckIns(table: "habit_check_ins" | "goal_check_ins", column: "habitId" | "goalId", id: string): void {
    const count = (this.db.prepare(`SELECT COUNT(*) as count FROM ${table} WHERE ${column} = ?`).get(id) as {
      count: number;
    }).count;

    if (count <= this.maxCheckInsPerItem) {
      return;
    }

    this.db
      .prepare(
        `DELETE FROM ${table} WHERE id IN (
          SELECT id FROM ${table} WHERE ${column} = ? ORDER BY insertOrder ASC LIMIT ?
        )`
      )
      .run(id, count - this.maxCheckInsPerItem);
  }

  /**
   * Record a notification interaction (tap, dismiss, or action)
   */
  recordNotificationInteraction(
    notificationId: string,
    notificationTitle: string,
    notificationSource: AgentName,
    notificationPriority: Notification["priority"],
    interactionType: NotificationInteractionType,
    actionType?: string,
    timeToInteractionMs?: number
  ): NotificationInteraction {
    const interaction: NotificationInteraction = {
      id: makeId("notif-int"),
      notificationId,
      notificationTitle,
      notificationSource,
      notificationPriority,
      interactionType,
      timestamp: nowIso(),
      actionType,
      timeToInteractionMs
    };

    this.db
      .prepare(
        `INSERT INTO notification_interactions 
         (id, notificationId, notificationTitle, notificationSource, notificationPriority, 
          interactionType, timestamp, actionType, timeToInteractionMs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        interaction.id,
        interaction.notificationId,
        interaction.notificationTitle,
        interaction.notificationSource,
        interaction.notificationPriority,
        interaction.interactionType,
        interaction.timestamp,
        interaction.actionType ?? null,
        interaction.timeToInteractionMs ?? null
      );

    // Trim old interactions
    const maxInteractions = 1000;
    const count = (this.db.prepare("SELECT COUNT(*) as count FROM notification_interactions").get() as {
      count: number;
    }).count;

    if (count > maxInteractions) {
      this.db
        .prepare(
          `DELETE FROM notification_interactions WHERE id IN (
            SELECT id FROM notification_interactions ORDER BY insertOrder ASC LIMIT ?
          )`
        )
        .run(count - maxInteractions);
    }

    return interaction;
  }

  /**
   * Get notification interactions, optionally filtered by time range
   */
  getNotificationInteractions(options?: {
    since?: string;
    until?: string;
    interactionType?: NotificationInteractionType;
    source?: AgentName;
    limit?: number;
  }): NotificationInteraction[] {
    let query = "SELECT * FROM notification_interactions WHERE 1=1";
    const params: unknown[] = [];

    if (options?.since) {
      query += " AND timestamp >= ?";
      params.push(options.since);
    }

    if (options?.until) {
      query += " AND timestamp <= ?";
      params.push(options.until);
    }

    if (options?.interactionType) {
      query += " AND interactionType = ?";
      params.push(options.interactionType);
    }

    if (options?.source) {
      query += " AND notificationSource = ?";
      params.push(options.source);
    }

    query += " ORDER BY timestamp DESC";

    if (options?.limit) {
      query += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string;
      notificationId: string;
      notificationTitle: string;
      notificationSource: AgentName;
      notificationPriority: string;
      interactionType: NotificationInteractionType;
      timestamp: string;
      actionType: string | null;
      timeToInteractionMs: number | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      notificationId: row.notificationId,
      notificationTitle: row.notificationTitle,
      notificationSource: row.notificationSource,
      notificationPriority: row.notificationPriority as Notification["priority"],
      interactionType: row.interactionType,
      timestamp: row.timestamp,
      actionType: row.actionType ?? undefined,
      timeToInteractionMs: row.timeToInteractionMs ?? undefined
    }));
  }

  /**
   * Get aggregated metrics about notification interactions
   */
  getNotificationInteractionMetrics(options?: { since?: string; until?: string }): NotificationInteractionMetrics {
    const interactions = this.getNotificationInteractions({
      since: options?.since,
      until: options?.until
    });

    const tapCount = interactions.filter((i) => i.interactionType === "tap").length;
    const dismissCount = interactions.filter((i) => i.interactionType === "dismiss").length;
    const actionCount = interactions.filter((i) => i.interactionType === "action").length;

    const interactionsWithTime = interactions.filter((i) => i.timeToInteractionMs !== undefined);
    const averageTimeToInteractionMs =
      interactionsWithTime.length > 0
        ? interactionsWithTime.reduce((sum, i) => sum + (i.timeToInteractionMs ?? 0), 0) / interactionsWithTime.length
        : 0;

    const interactionsByHour: Record<number, number> = {};
    for (const interaction of interactions) {
      const hour = new Date(interaction.timestamp).getHours();
      interactionsByHour[hour] = (interactionsByHour[hour] || 0) + 1;
    }

    const interactionsBySource: Record<AgentName, number> = {
      notes: 0,
      "lecture-plan": 0,
      "assignment-tracker": 0,
      orchestrator: 0
    };
    for (const interaction of interactions) {
      interactionsBySource[interaction.notificationSource] =
        (interactionsBySource[interaction.notificationSource] || 0) + 1;
    }

    return {
      totalInteractions: interactions.length,
      tapCount,
      dismissCount,
      actionCount,
      averageTimeToInteractionMs,
      interactionsByHour,
      interactionsBySource,
      recentInteractions: interactions.slice(0, 20)
    };
  }

  recordLocation(latitude: number, longitude: number, accuracy?: number, label?: string): Location {
    const location: Location = {
      id: makeId("location"),
      latitude,
      longitude,
      accuracy,
      timestamp: nowIso(),
      label
    };

    this.db
      .prepare(
        "INSERT INTO locations (id, latitude, longitude, accuracy, timestamp, label) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(location.id, latitude, longitude, accuracy ?? null, location.timestamp, label ?? null);

    this.trimLocationsIfNeeded();
    return location;
  }

  getLocations(limit?: number): Location[] {
    const query = this.db.prepare(
      `SELECT id, latitude, longitude, accuracy, timestamp, label
       FROM locations
       ORDER BY insertOrder DESC
       LIMIT ?`
    );

    return (query.all(limit ?? this.maxLocations) as Array<{
      id: string;
      latitude: number;
      longitude: number;
      accuracy: number | null;
      timestamp: string;
      label: string | null;
    }>).map((row) => ({
      id: row.id,
      latitude: row.latitude,
      longitude: row.longitude,
      accuracy: row.accuracy ?? undefined,
      timestamp: row.timestamp,
      label: row.label ?? undefined
    }));
  }

  getLocationById(id: string): Location | null {
    const row = this.db
      .prepare("SELECT id, latitude, longitude, accuracy, timestamp, label FROM locations WHERE id = ?")
      .get(id) as { id: string; latitude: number; longitude: number; accuracy: number | null; timestamp: string; label: string | null } | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      latitude: row.latitude,
      longitude: row.longitude,
      accuracy: row.accuracy ?? undefined,
      timestamp: row.timestamp,
      label: row.label ?? undefined
    };
  }

  updateLocation(id: string, data: Partial<Omit<Location, "id" | "timestamp">>): Location | null {
    const existing = this.getLocationById(id);
    if (!existing) {
      return null;
    }

    const updates: string[] = [];
    const values: Array<string | number | null> = [];

    if (data.latitude !== undefined) {
      updates.push("latitude = ?");
      values.push(data.latitude);
    }
    if (data.longitude !== undefined) {
      updates.push("longitude = ?");
      values.push(data.longitude);
    }
    if (data.accuracy !== undefined) {
      updates.push("accuracy = ?");
      values.push(data.accuracy ?? null);
    }
    if (data.label !== undefined) {
      updates.push("label = ?");
      values.push(data.label ?? null);
    }

    if (updates.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE locations SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    }

    return this.getLocationById(id);
  }

  deleteLocation(id: string): boolean {
    const result = this.db.prepare("DELETE FROM locations WHERE id = ?").run(id);
    return result.changes > 0;
  }

  recordLocationHistory(
    locationId: string,
    stressLevel?: "low" | "medium" | "high",
    energyLevel?: "low" | "medium" | "high",
    context?: string
  ): LocationHistory | null {
    const location = this.getLocationById(locationId);
    if (!location) {
      return null;
    }

    const history: LocationHistory = {
      id: makeId("location-history"),
      locationId,
      timestamp: nowIso(),
      stressLevel,
      energyLevel,
      context
    };

    this.db
      .prepare(
        "INSERT INTO location_history (id, locationId, timestamp, stressLevel, energyLevel, context) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        history.id,
        locationId,
        history.timestamp,
        stressLevel ?? null,
        energyLevel ?? null,
        context ?? null
      );

    this.trimLocationHistoryIfNeeded();
    return history;
  }

  getLocationHistory(locationId?: string, limit?: number): LocationHistory[] {
    let query: Database.Statement;
    let params: Array<string | number>;

    if (locationId) {
      query = this.db.prepare(
        `SELECT id, locationId, timestamp, stressLevel, energyLevel, context
         FROM location_history
         WHERE locationId = ?
         ORDER BY insertOrder DESC
         LIMIT ?`
      );
      params = [locationId, limit ?? this.maxLocationHistory];
    } else {
      query = this.db.prepare(
        `SELECT id, locationId, timestamp, stressLevel, energyLevel, context
         FROM location_history
         ORDER BY insertOrder DESC
         LIMIT ?`
      );
      params = [limit ?? this.maxLocationHistory];
    }

    return (query.all(...params) as Array<{
      id: string;
      locationId: string;
      timestamp: string;
      stressLevel: string | null;
      energyLevel: string | null;
      context: string | null;
    }>).map((row) => ({
      id: row.id,
      locationId: row.locationId,
      timestamp: row.timestamp,
      stressLevel: (row.stressLevel as "low" | "medium" | "high") ?? undefined,
      energyLevel: (row.energyLevel as "low" | "medium" | "high") ?? undefined,
      context: row.context ?? undefined
    }));
  }

  getCurrentLocation(): Location | null {
    const locations = this.getLocations(1);
    return locations.length > 0 ? locations[0] : null;
  }

  private trimLocationsIfNeeded(): void {
    const count = (this.db.prepare("SELECT COUNT(*) as count FROM locations").get() as { count: number }).count;
    if (count > this.maxLocations) {
      this.db
        .prepare(
          `DELETE FROM locations WHERE id IN (
            SELECT id FROM locations ORDER BY insertOrder ASC LIMIT ?
          )`
        )
        .run(count - this.maxLocations);
    }
  }

  private trimLocationHistoryIfNeeded(): void {
    const count = (this.db.prepare("SELECT COUNT(*) as count FROM location_history").get() as { count: number })
      .count;
    if (count > this.maxLocationHistory) {
      this.db
        .prepare(
          `DELETE FROM location_history WHERE id IN (
            SELECT id FROM location_history ORDER BY insertOrder ASC LIMIT ?
          )`
        )
        .run(count - this.maxLocationHistory);
    }
  }

  /**
   * Add an operation to the background sync queue
   */
  enqueueSyncOperation(operationType: SyncOperationType, payload: Record<string, unknown>): SyncQueueItem {
    const item: SyncQueueItem = {
      id: makeId("sync"),
      operationType,
      payload,
      status: "pending",
      attempts: 0,
      lastAttemptAt: null,
      createdAt: nowIso(),
      completedAt: null,
      error: null
    };

    this.db
      .prepare(
        `INSERT INTO sync_queue (id, operationType, payload, status, attempts, lastAttemptAt, createdAt, completedAt, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.operationType,
        JSON.stringify(item.payload),
        item.status,
        item.attempts,
        item.lastAttemptAt,
        item.createdAt,
        item.completedAt,
        item.error
      );

    return item;
  }

  /**
   * Get pending sync queue items
   */
  getPendingSyncItems(limit?: number): SyncQueueItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, operationType, payload, status, attempts, lastAttemptAt, createdAt, completedAt, error
         FROM sync_queue
         WHERE status IN ('pending', 'failed')
         ORDER BY createdAt ASC
         LIMIT ?`
      )
      .all(limit ?? 100) as Array<{
      id: string;
      operationType: string;
      payload: string;
      status: string;
      attempts: number;
      lastAttemptAt: string | null;
      createdAt: string;
      completedAt: string | null;
      error: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      operationType: row.operationType as SyncOperationType,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      status: row.status as SyncQueueItem["status"],
      attempts: row.attempts,
      lastAttemptAt: row.lastAttemptAt,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      error: row.error
    }));
  }

  /**
   * Update sync queue item status
   */
  updateSyncItemStatus(
    id: string,
    status: SyncQueueItem["status"],
    error?: string
  ): void {
    const updates: Record<string, string | number | null> = {
      status,
      lastAttemptAt: nowIso()
    };

    if (status === "completed") {
      updates.completedAt = nowIso();
    }

    if (error !== undefined) {
      updates.error = error;
    }

    this.db
      .prepare(
        `UPDATE sync_queue
         SET status = ?, lastAttemptAt = ?, completedAt = ?, error = ?, attempts = attempts + 1
         WHERE id = ?`
      )
      .run(updates.status, updates.lastAttemptAt, updates.completedAt ?? null, updates.error ?? null, id);
  }

  /**
   * Delete completed sync items older than a certain date
   */
  cleanupCompletedSyncItems(olderThanDays: number = 7): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    const cutoffIso = cutoffDate.toISOString();

    const result = this.db
      .prepare(
        `DELETE FROM sync_queue
         WHERE status = 'completed' AND completedAt < ?`
      )
      .run(cutoffIso);

    return result.changes;
  }

  /**
   * Get sync queue status overview
   */
  getSyncQueueStatus(): SyncQueueStatus {
    const pending = (
      this.db.prepare("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'pending'").get() as { count: number }
    ).count;

    const processing = (
      this.db.prepare("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'processing'").get() as { count: number }
    ).count;

    const failed = (
      this.db.prepare("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'failed'").get() as { count: number }
    ).count;

    const recentRows = this.db
      .prepare(
        `SELECT id, operationType, payload, status, attempts, lastAttemptAt, createdAt, completedAt, error
         FROM sync_queue
         ORDER BY createdAt DESC
         LIMIT 20`
      )
      .all() as Array<{
      id: string;
      operationType: string;
      payload: string;
      status: string;
      attempts: number;
      lastAttemptAt: string | null;
      createdAt: string;
      completedAt: string | null;
      error: string | null;
    }>;

    const recentItems: SyncQueueItem[] = recentRows.map((row) => ({
      id: row.id,
      operationType: row.operationType as SyncOperationType,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      status: row.status as SyncQueueItem["status"],
      attempts: row.attempts,
      lastAttemptAt: row.lastAttemptAt,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      error: row.error
    }));

    return {
      pending,
      processing,
      failed,
      recentItems
    };
  }

  /**
   * Delete a sync queue item
   */
  deleteSyncQueueItem(id: string): boolean {
    const result = this.db.prepare("DELETE FROM sync_queue WHERE id = ?").run(id);
    return result.changes > 0;
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
