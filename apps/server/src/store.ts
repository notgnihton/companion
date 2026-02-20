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
  ScheduleSuggestionMute,
  RoutinePreset,
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
  NutritionDailySummary,
  NutritionDayHistoryEntry,
  NutritionCustomFood,
  NutritionMeal,
  NutritionMealItem,
  NutritionPlanSnapshot,
  NutritionPlanSettings,
  NutritionPlanSnapshotMeal,
  NutritionPlanSnapshotTarget,
  NutritionTargetProfile,
  NutritionMealType,
  StudyPlanSession,
  StudyPlanSessionRecord,
  StudyPlanSessionStatus,
  StudyPlanAdherenceMetrics,
  Tag,
  Location,
  LocationHistory,
  SyncQueueItem,
  SyncQueueStatus,
  SyncOperationType,
  IntegrationSyncAttempt,
  IntegrationSyncAttemptStatus,
  IntegrationSyncName,
  IntegrationSyncRootCause,
  IntegrationSyncSummary,
  ChatMessage,
  ChatMessageMetadata,
  ChatHistoryPage,
  ChatLongTermMemory,
  JournalMemoryEntryType,
  ReflectionEntry,
  ChatActionType,
  ChatPendingAction,
  GmailMessage,
  AuthRole,
  AuthSession,
  AuthUser,
  AuthUserWithPassword,
  WithingsData,
  WithingsSleepSummaryEntry,
  WithingsWeightEntry
} from "./types.js";
import { isAssignmentOrExamDeadline } from "./deadline-eligibility.js";
import { makeId, nowIso } from "./utils.js";

const agentNames: AgentName[] = [
  "notes",
  "lecture-plan",
  "assignment-tracker",
  "orchestrator"
];
const TAG_ID_LIKE_REGEX = /^tag-[a-zA-Z0-9_-]+$/;
const integrationNames: IntegrationSyncName[] = ["tp", "canvas", "gmail", "withings"];
const integrationRootCauses: IntegrationSyncRootCause[] = [
  "none",
  "auth",
  "network",
  "rate_limit",
  "validation",
  "provider",
  "unknown"
];
const journalMemoryEntryTypes: JournalMemoryEntryType[] = [
  "reflection",
  "event",
  "decision",
  "commitment",
  "outcome",
  "health",
  "food",
  "schedule-change",
  "deadline",
  "email",
  "habit-goal"
];
const NUTRITION_MEAL_DONE_TOKEN = "[done]";

export class RuntimeStore {
  private readonly maxEvents = 100;
  private readonly maxNotifications = 40;
  private readonly maxChatMessages = 5000;
  private readonly maxReflectionEntries = 8000;
  private readonly maxJournalEntries = 100;
  private readonly maxScheduleEvents = 200;
  private readonly maxRoutinePresets = 100;
  private readonly maxDeadlines = 200;
  private readonly maxHabits = 100;
  private readonly maxGoals = 100;
  private readonly maxNutritionMeals = 5000;
  private readonly maxNutritionCustomFoods = 1200;
  private readonly maxNutritionTargetProfiles = 4000;
  private readonly maxNutritionPlanSnapshots = 300;
  private readonly maxContextHistory = 500;
  private readonly maxCheckInsPerItem = 400;
  private readonly maxStudyPlanSessions = 5000;
  private readonly maxPushSubscriptions = 50;
  private readonly maxPushFailures = 100;
  private readonly maxEmailDigests = 50;
  private readonly maxLocations = 1000;
  private readonly maxLocationHistory = 5000;
  private readonly maxIntegrationSyncAttempts = 5000;
  private readonly maxAuthSessions = 2000;
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

      CREATE TABLE IF NOT EXISTS chat_pending_actions (
        id TEXT PRIMARY KEY,
        actionType TEXT NOT NULL,
        summary TEXT NOT NULL,
        payload TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        expiresAt TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE INDEX IF NOT EXISTS idx_chat_pending_actions_expiresAt
        ON chat_pending_actions(expiresAt);

      CREATE TABLE IF NOT EXISTS chat_long_term_memory (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        summary TEXT NOT NULL,
        sourceMessageCount INTEGER NOT NULL DEFAULT 0,
        totalMessagesAtCompression INTEGER NOT NULL DEFAULT 0,
        compressedMessageCount INTEGER NOT NULL DEFAULT 0,
        preservedMessageCount INTEGER NOT NULL DEFAULT 0,
        fromTimestamp TEXT,
        toTimestamp TEXT,
        usedModelMode TEXT NOT NULL DEFAULT 'fallback',
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reflection_entries (
        id TEXT PRIMARY KEY,
        entryType TEXT NOT NULL DEFAULT 'reflection',
        event TEXT NOT NULL,
        feelingStress TEXT NOT NULL,
        intent TEXT NOT NULL,
        commitment TEXT NOT NULL,
        outcome TEXT NOT NULL,
        salience REAL NOT NULL DEFAULT 0.5,
        captureReason TEXT NOT NULL DEFAULT '',
        timestamp TEXT NOT NULL,
        evidenceSnippet TEXT NOT NULL,
        sourceMessageId TEXT NOT NULL UNIQUE,
        updatedAt TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE INDEX IF NOT EXISTS idx_reflection_entries_timestamp
        ON reflection_entries(timestamp);

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        passwordHash TEXT NOT NULL,
        role TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        tokenHash TEXT NOT NULL UNIQUE,
        expiresAt TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastSeenAt TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000),
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_auth_sessions_tokenHash ON auth_sessions(tokenHash);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiresAt ON auth_sessions(expiresAt);

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
        location TEXT,
        startTime TEXT NOT NULL,
        durationMinutes INTEGER NOT NULL,
        workload TEXT NOT NULL,
        recurrence TEXT,
        recurrenceParentId TEXT,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS schedule_suggestion_mutes (
        id TEXT PRIMARY KEY,
        startTime TEXT NOT NULL,
        endTime TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE INDEX IF NOT EXISTS idx_schedule_suggestion_mutes_window
        ON schedule_suggestion_mutes(startTime, endTime);

      CREATE TABLE IF NOT EXISTS routine_presets (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        preferredStartTime TEXT NOT NULL,
        durationMinutes INTEGER NOT NULL,
        workload TEXT NOT NULL,
        weekdays TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE TABLE IF NOT EXISTS deadlines (
        id TEXT PRIMARY KEY,
        course TEXT NOT NULL,
        task TEXT NOT NULL,
        dueDate TEXT NOT NULL,
        sourceDueDate TEXT,
        priority TEXT NOT NULL,
        completed INTEGER NOT NULL,
        effortHoursRemaining REAL,
        effortConfidence TEXT,
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

      CREATE TABLE IF NOT EXISTS nutrition_meals (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        mealType TEXT NOT NULL,
        consumedAt TEXT NOT NULL,
        calories REAL NOT NULL,
        proteinGrams REAL NOT NULL,
        carbsGrams REAL NOT NULL,
        fatGrams REAL NOT NULL,
        itemsJson TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        createdAt TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE INDEX IF NOT EXISTS idx_nutrition_meals_consumedAt
        ON nutrition_meals(consumedAt DESC);

      CREATE TABLE IF NOT EXISTS nutrition_custom_foods (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        unitLabel TEXT NOT NULL,
        caloriesPerUnit REAL NOT NULL,
        proteinGramsPerUnit REAL NOT NULL,
        carbsGramsPerUnit REAL NOT NULL,
        fatGramsPerUnit REAL NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE INDEX IF NOT EXISTS idx_nutrition_custom_foods_name
        ON nutrition_custom_foods(name COLLATE NOCASE);

      CREATE TABLE IF NOT EXISTS nutrition_target_profiles (
        dateKey TEXT PRIMARY KEY,
        weightKg REAL,
        maintenanceCalories REAL,
        surplusCalories REAL,
        targetCalories REAL,
        targetProteinGrams REAL,
        targetCarbsGrams REAL,
        targetFatGrams REAL,
        proteinGramsPerLb REAL,
        fatGramsPerLb REAL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE INDEX IF NOT EXISTS idx_nutrition_target_profiles_updatedAt
        ON nutrition_target_profiles(updatedAt DESC);

      CREATE TABLE IF NOT EXISTS nutrition_plan_snapshots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sourceDate TEXT NOT NULL,
        targetProfileJson TEXT NOT NULL DEFAULT '{}',
        mealsJson TEXT NOT NULL DEFAULT '[]',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE INDEX IF NOT EXISTS idx_nutrition_plan_snapshots_updatedAt
        ON nutrition_plan_snapshots(updatedAt DESC);

      CREATE TABLE IF NOT EXISTS nutrition_plan_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        defaultSnapshotId TEXT,
        updatedAt TEXT,
        FOREIGN KEY (defaultSnapshotId) REFERENCES nutrition_plan_snapshots(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS study_plan_sessions (
        sessionId TEXT PRIMARY KEY,
        deadlineId TEXT NOT NULL,
        course TEXT NOT NULL,
        task TEXT NOT NULL,
        priority TEXT NOT NULL,
        startTime TEXT NOT NULL,
        endTime TEXT NOT NULL,
        durationMinutes INTEGER NOT NULL,
        score REAL NOT NULL,
        rationale TEXT NOT NULL,
        generatedAt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        checkedAt TEXT,
        energyLevel INTEGER,
        focusLevel INTEGER,
        checkInNote TEXT,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE INDEX IF NOT EXISTS idx_study_plan_sessions_startTime
        ON study_plan_sessions(startTime);
      CREATE INDEX IF NOT EXISTS idx_study_plan_sessions_status
        ON study_plan_sessions(status);

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

      CREATE TABLE IF NOT EXISTS integration_sync_attempts (
        id TEXT PRIMARY KEY,
        integration TEXT NOT NULL,
        status TEXT NOT NULL,
        latencyMs INTEGER NOT NULL,
        rootCause TEXT NOT NULL,
        errorMessage TEXT,
        attemptedAt TEXT NOT NULL,
        insertOrder INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000000)
      );

      CREATE INDEX IF NOT EXISTS idx_integration_sync_attempts_integration
        ON integration_sync_attempts(integration, attemptedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_integration_sync_attempts_status
        ON integration_sync_attempts(status, attemptedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_integration_sync_attempts_attemptedAt
        ON integration_sync_attempts(attemptedAt DESC);

      CREATE TABLE IF NOT EXISTS canvas_data (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        courses TEXT NOT NULL DEFAULT '[]',
        assignments TEXT NOT NULL DEFAULT '[]',
        modules TEXT NOT NULL DEFAULT '[]',
        announcements TEXT NOT NULL DEFAULT '[]',
        lastSyncedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS github_course_data (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        repositories TEXT NOT NULL DEFAULT '[]',
        documents TEXT NOT NULL DEFAULT '[]',
        deadlinesSynced INTEGER NOT NULL DEFAULT 0,
        lastSyncedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS gmail_data (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        refreshToken TEXT,
        accessToken TEXT,
        email TEXT,
        connectedAt TEXT,
        tokenSource TEXT,
        messages TEXT DEFAULT '[]',
        lastSyncedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS withings_data (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        refreshToken TEXT,
        accessToken TEXT,
        tokenExpiresAt TEXT,
        userId TEXT,
        scope TEXT,
        connectedAt TEXT,
        tokenSource TEXT,
        weightJson TEXT NOT NULL DEFAULT '[]',
        sleepJson TEXT NOT NULL DEFAULT '[]',
        lastSyncedAt TEXT
      );
    `);

    // Removed nutrition meal-plan feature: purge deprecated table/index from older runtimes.
    this.db.exec(`
      DROP INDEX IF EXISTS idx_nutrition_meal_plan_blocks_scheduledFor;
      DROP TABLE IF EXISTS nutrition_meal_plan_blocks;
    `);

    const journalColumns = this.db.prepare("PRAGMA table_info(journal_entries)").all() as Array<{ name: string }>;
    const hasPhotosColumn = journalColumns.some((col) => col.name === "photos");
    if (!hasPhotosColumn) {
      this.db.prepare("ALTER TABLE journal_entries ADD COLUMN photos TEXT NOT NULL DEFAULT '[]'").run();
    }

    const scheduleColumns = this.db.prepare("PRAGMA table_info(schedule_events)").all() as Array<{ name: string }>;
    const hasLocationColumn = scheduleColumns.some((col) => col.name === "location");
    if (!hasLocationColumn) {
      this.db.prepare("ALTER TABLE schedule_events ADD COLUMN location TEXT").run();
    }

    // Add canvasAssignmentId column if it doesn't exist
    const deadlineColumns = this.db.prepare("PRAGMA table_info(deadlines)").all() as Array<{ name: string }>;
    const hasCanvasAssignmentId = deadlineColumns.some((col) => col.name === "canvasAssignmentId");
    if (!hasCanvasAssignmentId) {
      this.db.prepare("ALTER TABLE deadlines ADD COLUMN canvasAssignmentId INTEGER").run();
    }
    const hasEffortHoursRemaining = deadlineColumns.some((col) => col.name === "effortHoursRemaining");
    if (!hasEffortHoursRemaining) {
      this.db.prepare("ALTER TABLE deadlines ADD COLUMN effortHoursRemaining REAL").run();
    }
    const hasEffortConfidence = deadlineColumns.some((col) => col.name === "effortConfidence");
    if (!hasEffortConfidence) {
      this.db.prepare("ALTER TABLE deadlines ADD COLUMN effortConfidence TEXT").run();
    }
    const hasSourceDueDate = deadlineColumns.some((col) => col.name === "sourceDueDate");
    if (!hasSourceDueDate) {
      this.db.prepare("ALTER TABLE deadlines ADD COLUMN sourceDueDate TEXT").run();
    }

    const nutritionMealColumns = this.db.prepare("PRAGMA table_info(nutrition_meals)").all() as Array<{ name: string }>;
    const hasItemsJsonColumn = nutritionMealColumns.some((col) => col.name === "itemsJson");
    if (!hasItemsJsonColumn) {
      this.db.prepare("ALTER TABLE nutrition_meals ADD COLUMN itemsJson TEXT NOT NULL DEFAULT '[]'").run();
    }

    // Add per-lb macro columns to nutrition_target_profiles
    const nutritionTargetColumns = this.db.prepare("PRAGMA table_info(nutrition_target_profiles)").all() as Array<{ name: string }>;
    const hasProteinGramsPerLb = nutritionTargetColumns.some((col) => col.name === "proteinGramsPerLb");
    if (!hasProteinGramsPerLb) {
      this.db.prepare("ALTER TABLE nutrition_target_profiles ADD COLUMN proteinGramsPerLb REAL").run();
    }
    const hasFatGramsPerLb = nutritionTargetColumns.some((col) => col.name === "fatGramsPerLb");
    if (!hasFatGramsPerLb) {
      this.db.prepare("ALTER TABLE nutrition_target_profiles ADD COLUMN fatGramsPerLb REAL").run();
    }

    // Add Gmail messages and lastSyncedAt columns if they don't exist
    const gmailColumns = this.db.prepare("PRAGMA table_info(gmail_data)").all() as Array<{ name: string }>;
    const hasMessagesColumn = gmailColumns.some((col) => col.name === "messages");
    if (!hasMessagesColumn) {
      this.db.prepare("ALTER TABLE gmail_data ADD COLUMN messages TEXT DEFAULT '[]'").run();
    }
    const hasLastSyncedAtColumn = gmailColumns.some((col) => col.name === "lastSyncedAt");
    if (!hasLastSyncedAtColumn) {
      this.db.prepare("ALTER TABLE gmail_data ADD COLUMN lastSyncedAt TEXT").run();
    }
    const hasAccessTokenColumn = gmailColumns.some((col) => col.name === "accessToken");
    if (!hasAccessTokenColumn) {
      this.db.prepare("ALTER TABLE gmail_data ADD COLUMN accessToken TEXT").run();
    }
    const hasTokenSourceColumn = gmailColumns.some((col) => col.name === "tokenSource");
    if (!hasTokenSourceColumn) {
      this.db.prepare("ALTER TABLE gmail_data ADD COLUMN tokenSource TEXT").run();
    }

    const withingsColumns = this.db.prepare("PRAGMA table_info(withings_data)").all() as Array<{ name: string }>;
    const hasWeightJsonColumn = withingsColumns.some((col) => col.name === "weightJson");
    if (!hasWeightJsonColumn) {
      this.db.prepare("ALTER TABLE withings_data ADD COLUMN weightJson TEXT NOT NULL DEFAULT '[]'").run();
    }
    const hasSleepJsonColumn = withingsColumns.some((col) => col.name === "sleepJson");
    if (!hasSleepJsonColumn) {
      this.db.prepare("ALTER TABLE withings_data ADD COLUMN sleepJson TEXT NOT NULL DEFAULT '[]'").run();
    }
    const hasWithingsLastSyncedAtColumn = withingsColumns.some((col) => col.name === "lastSyncedAt");
    if (!hasWithingsLastSyncedAtColumn) {
      this.db.prepare("ALTER TABLE withings_data ADD COLUMN lastSyncedAt TEXT").run();
    }

    const githubCourseColumns = this.db.prepare("PRAGMA table_info(github_course_data)").all() as Array<{ name: string }>;
    const hasDeadlinesSyncedColumn = githubCourseColumns.some((col) => col.name === "deadlinesSynced");
    if (!hasDeadlinesSyncedColumn) {
      this.db.prepare("ALTER TABLE github_course_data ADD COLUMN deadlinesSynced INTEGER NOT NULL DEFAULT 0").run();
    }

    const studyPlanColumns = this.db.prepare("PRAGMA table_info(study_plan_sessions)").all() as Array<{ name: string }>;
    const hasEnergyLevelColumn = studyPlanColumns.some((col) => col.name === "energyLevel");
    if (!hasEnergyLevelColumn) {
      this.db.prepare("ALTER TABLE study_plan_sessions ADD COLUMN energyLevel INTEGER").run();
    }
    const hasFocusLevelColumn = studyPlanColumns.some((col) => col.name === "focusLevel");
    if (!hasFocusLevelColumn) {
      this.db.prepare("ALTER TABLE study_plan_sessions ADD COLUMN focusLevel INTEGER").run();
    }
    const hasCheckInNoteColumn = studyPlanColumns.some((col) => col.name === "checkInNote");
    if (!hasCheckInNoteColumn) {
      this.db.prepare("ALTER TABLE study_plan_sessions ADD COLUMN checkInNote TEXT").run();
    }

    const reflectionColumns = this.db.prepare("PRAGMA table_info(reflection_entries)").all() as Array<{ name: string }>;
    const hasSalienceColumn = reflectionColumns.some((col) => col.name === "salience");
    if (!hasSalienceColumn) {
      this.db.prepare("ALTER TABLE reflection_entries ADD COLUMN salience REAL NOT NULL DEFAULT 0.5").run();
    }
    const hasCaptureReasonColumn = reflectionColumns.some((col) => col.name === "captureReason");
    if (!hasCaptureReasonColumn) {
      this.db.prepare("ALTER TABLE reflection_entries ADD COLUMN captureReason TEXT NOT NULL DEFAULT ''").run();
    }
    const hasEntryTypeColumn = reflectionColumns.some((col) => col.name === "entryType");
    if (!hasEntryTypeColumn) {
      this.db.prepare("ALTER TABLE reflection_entries ADD COLUMN entryType TEXT NOT NULL DEFAULT 'reflection'").run();
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

    const nutritionPlanSettingsExists = this.db.prepare("SELECT id FROM nutrition_plan_settings WHERE id = 1").get();
    if (!nutritionPlanSettingsExists) {
      this.db.prepare("INSERT INTO nutrition_plan_settings (id, defaultSnapshotId, updatedAt) VALUES (1, NULL, NULL)").run();
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

    this.pruneLegacySeedHabitsAndGoals();
  }

  private pruneLegacySeedHabitsAndGoals(): void {
    const habitRows = this.db.prepare("SELECT id, name, cadence, targetPerWeek FROM habits").all() as Array<{
      id: string;
      name: string;
      cadence: string;
      targetPerWeek: number;
    }>;

    const goalRows = this.db.prepare("SELECT id, title, cadence, targetCount FROM goals").all() as Array<{
      id: string;
      title: string;
      cadence: string;
      targetCount: number;
    }>;

    const habitSignatures = new Set(
      habitRows.map((habit) => `${habit.name.trim().toLowerCase()}|${habit.cadence}|${habit.targetPerWeek}`)
    );
    const goalSignatures = new Set(
      goalRows.map((goal) => `${goal.title.trim().toLowerCase()}|${goal.cadence}|${goal.targetCount}`)
    );

    const hasLegacyHabits =
      habitRows.length === 3 &&
      habitSignatures.has("morning run|daily|5") &&
      habitSignatures.has("study sprint|daily|6") &&
      habitSignatures.has("wind-down reading|weekly|4");

    const hasLegacyGoals =
      goalRows.length === 2 &&
      goalSignatures.has("finish algorithms pset|daily|6") &&
      goalSignatures.has("publish portfolio draft|daily|10");

    if (hasLegacyHabits) {
      this.db.prepare("DELETE FROM habit_check_ins").run();
      this.db.prepare("DELETE FROM habits").run();
    }

    if (hasLegacyGoals) {
      this.db.prepare("DELETE FROM goal_check_ins").run();
      this.db.prepare("DELETE FROM goals").run();
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

  getChatMessageCount(): number {
    return (this.db.prepare("SELECT COUNT(*) as count FROM chat_messages").get() as { count: number }).count;
  }

  private normalizeJournalMemoryEntryType(value: unknown): JournalMemoryEntryType {
    if (typeof value === "string" && journalMemoryEntryTypes.includes(value as JournalMemoryEntryType)) {
      return value as JournalMemoryEntryType;
    }
    return "event";
  }

  private mapReflectionRow(row: {
    id: string;
    entryType?: string;
    event: string;
    feelingStress: string;
    intent: string;
    commitment: string;
    outcome: string;
    salience: number;
    captureReason: string;
    timestamp: string;
    evidenceSnippet: string;
    sourceMessageId: string;
    updatedAt: string;
  }): ReflectionEntry {
    return {
      id: row.id,
      entryType: this.normalizeJournalMemoryEntryType(row.entryType),
      event: row.event,
      feelingStress: row.feelingStress,
      intent: row.intent,
      commitment: row.commitment,
      outcome: row.outcome,
      salience: Number.isFinite(row.salience) ? row.salience : 0.5,
      captureReason: row.captureReason,
      timestamp: row.timestamp,
      evidenceSnippet: row.evidenceSnippet,
      sourceMessageId: row.sourceMessageId,
      updatedAt: row.updatedAt
    };
  }

  upsertReflectionEntry(input: {
    entryType?: JournalMemoryEntryType;
    event: string;
    feelingStress: string;
    intent: string;
    commitment: string;
    outcome: string;
    salience?: number;
    captureReason?: string;
    timestamp: string;
    evidenceSnippet: string;
    sourceMessageId: string;
  }): ReflectionEntry {
    const updatedAt = nowIso();
    const existing = this.db
      .prepare(
        "SELECT id, entryType, event, feelingStress, intent, commitment, outcome, salience, captureReason, timestamp, evidenceSnippet, sourceMessageId, updatedAt FROM reflection_entries WHERE sourceMessageId = ?"
      )
      .get(input.sourceMessageId) as
      | {
          id: string;
          entryType: string;
          event: string;
          feelingStress: string;
          intent: string;
          commitment: string;
          outcome: string;
          salience: number;
          captureReason: string;
          timestamp: string;
          evidenceSnippet: string;
          sourceMessageId: string;
          updatedAt: string;
        }
      | undefined;

    const id = existing?.id ?? makeId("reflection");

    const normalizedSalience = Number.isFinite(input.salience)
      ? Math.max(0, Math.min(1, Number(input.salience)))
      : 0.5;
    const normalizedCaptureReason =
      typeof input.captureReason === "string" ? input.captureReason.slice(0, 220) : "";
    const normalizedEntryType = this.normalizeJournalMemoryEntryType(input.entryType);

    this.db
      .prepare(
        `INSERT INTO reflection_entries (
           id, entryType, event, feelingStress, intent, commitment, outcome, salience, captureReason, timestamp, evidenceSnippet, sourceMessageId, updatedAt, insertOrder
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(insertOrder), 0) + 1 FROM reflection_entries)
         )
         ON CONFLICT(sourceMessageId) DO UPDATE SET
           entryType = EXCLUDED.entryType,
           event = EXCLUDED.event,
           feelingStress = EXCLUDED.feelingStress,
           intent = EXCLUDED.intent,
           commitment = EXCLUDED.commitment,
           outcome = EXCLUDED.outcome,
           salience = EXCLUDED.salience,
           captureReason = EXCLUDED.captureReason,
           timestamp = EXCLUDED.timestamp,
           evidenceSnippet = EXCLUDED.evidenceSnippet,
           updatedAt = EXCLUDED.updatedAt`
      )
      .run(
        id,
        normalizedEntryType,
        input.event,
        input.feelingStress,
        input.intent,
        input.commitment,
        input.outcome,
        normalizedSalience,
        normalizedCaptureReason,
        input.timestamp,
        input.evidenceSnippet,
        input.sourceMessageId,
        updatedAt
      );

    const count = (this.db.prepare("SELECT COUNT(*) as count FROM reflection_entries").get() as { count: number }).count;
    if (count > this.maxReflectionEntries) {
      this.db
        .prepare(
          `DELETE FROM reflection_entries WHERE id IN (
            SELECT id FROM reflection_entries ORDER BY insertOrder ASC LIMIT ?
          )`
        )
        .run(count - this.maxReflectionEntries);
    }

    const row = this.db
      .prepare(
        "SELECT id, entryType, event, feelingStress, intent, commitment, outcome, salience, captureReason, timestamp, evidenceSnippet, sourceMessageId, updatedAt FROM reflection_entries WHERE sourceMessageId = ?"
      )
      .get(input.sourceMessageId) as
      | {
          id: string;
          entryType: string;
          event: string;
          feelingStress: string;
          intent: string;
          commitment: string;
          outcome: string;
          salience: number;
          captureReason: string;
          timestamp: string;
          evidenceSnippet: string;
          sourceMessageId: string;
          updatedAt: string;
        }
      | undefined;

    if (!row) {
      return {
        id,
        entryType: normalizedEntryType,
        event: input.event,
        feelingStress: input.feelingStress,
        intent: input.intent,
        commitment: input.commitment,
        outcome: input.outcome,
        salience: normalizedSalience,
        captureReason: normalizedCaptureReason,
        timestamp: input.timestamp,
        evidenceSnippet: input.evidenceSnippet,
        sourceMessageId: input.sourceMessageId,
        updatedAt
      };
    }

    return this.mapReflectionRow(row);
  }

  getRecentReflectionEntries(limit: number): ReflectionEntry[] {
    if (limit <= 0) {
      return [];
    }

    const rows = this.db
      .prepare(
        "SELECT id, entryType, event, feelingStress, intent, commitment, outcome, salience, captureReason, timestamp, evidenceSnippet, sourceMessageId, updatedAt FROM reflection_entries ORDER BY insertOrder DESC LIMIT ?"
      )
      .all(limit) as Array<{
      id: string;
      entryType: string;
      event: string;
      feelingStress: string;
      intent: string;
      commitment: string;
      outcome: string;
      salience: number;
      captureReason: string;
      timestamp: string;
      evidenceSnippet: string;
      sourceMessageId: string;
      updatedAt: string;
    }>;

    return rows.map((row) => this.mapReflectionRow(row)).reverse();
  }

  getReflectionEntriesInRange(windowStart: string, windowEnd: string, limit = 500): ReflectionEntry[] {
    const normalizedLimit = Math.max(1, Math.min(limit, 2000));
    const rows = this.db
      .prepare(
        `SELECT id, event, feelingStress, intent, commitment, outcome, timestamp, evidenceSnippet, sourceMessageId, updatedAt
           , salience, captureReason, entryType
           FROM reflection_entries
          WHERE timestamp >= ? AND timestamp <= ?
          ORDER BY timestamp DESC
          LIMIT ?`
      )
      .all(windowStart, windowEnd, normalizedLimit) as Array<{
      id: string;
      entryType: string;
      event: string;
      feelingStress: string;
      intent: string;
      commitment: string;
      outcome: string;
      salience: number;
      captureReason: string;
      timestamp: string;
      evidenceSnippet: string;
      sourceMessageId: string;
      updatedAt: string;
    }>;

    return rows.map((row) => this.mapReflectionRow(row));
  }

  getChatLongTermMemory(): ChatLongTermMemory | null {
    const row = this.db
      .prepare(
        `SELECT summary, sourceMessageCount, totalMessagesAtCompression, compressedMessageCount, preservedMessageCount,
                fromTimestamp, toTimestamp, usedModelMode, updatedAt
           FROM chat_long_term_memory
          WHERE id = 1`
      )
      .get() as
      | {
          summary: string;
          sourceMessageCount: number;
          totalMessagesAtCompression: number;
          compressedMessageCount: number;
          preservedMessageCount: number;
          fromTimestamp: string | null;
          toTimestamp: string | null;
          usedModelMode: string;
          updatedAt: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    const usedModelMode: ChatLongTermMemory["usedModelMode"] =
      row.usedModelMode === "live" || row.usedModelMode === "standard" || row.usedModelMode === "fallback"
        ? row.usedModelMode
        : "fallback";

    return {
      summary: row.summary,
      sourceMessageCount: Math.max(0, Number(row.sourceMessageCount) || 0),
      totalMessagesAtCompression: Math.max(0, Number(row.totalMessagesAtCompression) || 0),
      compressedMessageCount: Math.max(0, Number(row.compressedMessageCount) || 0),
      preservedMessageCount: Math.max(0, Number(row.preservedMessageCount) || 0),
      fromTimestamp: row.fromTimestamp ?? undefined,
      toTimestamp: row.toTimestamp ?? undefined,
      usedModelMode,
      updatedAt: row.updatedAt
    };
  }

  upsertChatLongTermMemory(memory: Omit<ChatLongTermMemory, "updatedAt"> & { updatedAt?: string }): ChatLongTermMemory {
    const updatedAt = memory.updatedAt ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO chat_long_term_memory
           (id, summary, sourceMessageCount, totalMessagesAtCompression, compressedMessageCount, preservedMessageCount,
            fromTimestamp, toTimestamp, usedModelMode, updatedAt)
         VALUES
           (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           summary = EXCLUDED.summary,
           sourceMessageCount = EXCLUDED.sourceMessageCount,
           totalMessagesAtCompression = EXCLUDED.totalMessagesAtCompression,
           compressedMessageCount = EXCLUDED.compressedMessageCount,
           preservedMessageCount = EXCLUDED.preservedMessageCount,
           fromTimestamp = EXCLUDED.fromTimestamp,
           toTimestamp = EXCLUDED.toTimestamp,
           usedModelMode = EXCLUDED.usedModelMode,
           updatedAt = EXCLUDED.updatedAt`
      )
      .run(
        memory.summary,
        memory.sourceMessageCount,
        memory.totalMessagesAtCompression,
        memory.compressedMessageCount,
        memory.preservedMessageCount,
        memory.fromTimestamp ?? null,
        memory.toTimestamp ?? null,
        memory.usedModelMode,
        updatedAt
      );

    return {
      summary: memory.summary,
      sourceMessageCount: memory.sourceMessageCount,
      totalMessagesAtCompression: memory.totalMessagesAtCompression,
      compressedMessageCount: memory.compressedMessageCount,
      preservedMessageCount: memory.preservedMessageCount,
      fromTimestamp: memory.fromTimestamp,
      toTimestamp: memory.toTimestamp,
      usedModelMode: memory.usedModelMode,
      updatedAt
    };
  }

  private parsePendingChatPayload(raw: string): Record<string, unknown> {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private pruneExpiredPendingChatActions(referenceDate: Date = new Date()): void {
    this.db.prepare("DELETE FROM chat_pending_actions WHERE expiresAt <= ?").run(referenceDate.toISOString());
  }

  createPendingChatAction(input: {
    actionType: ChatActionType;
    summary: string;
    payload: Record<string, unknown>;
    expiresAt?: string;
  }): ChatPendingAction {
    const createdAt = nowIso();
    const defaultExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const action: ChatPendingAction = {
      id: makeId("action"),
      actionType: input.actionType,
      summary: input.summary,
      payload: input.payload,
      createdAt,
      expiresAt: input.expiresAt ?? defaultExpiresAt
    };

    this.db
      .prepare(
        "INSERT INTO chat_pending_actions (id, actionType, summary, payload, createdAt, expiresAt, insertOrder) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(insertOrder), 0) + 1 FROM chat_pending_actions))"
      )
      .run(action.id, action.actionType, action.summary, JSON.stringify(action.payload), action.createdAt, action.expiresAt);

    return action;
  }

  getPendingChatActions(referenceDate: Date = new Date()): ChatPendingAction[] {
    this.pruneExpiredPendingChatActions(referenceDate);

    const rows = this.db
      .prepare("SELECT id, actionType, summary, payload, createdAt, expiresAt FROM chat_pending_actions ORDER BY insertOrder ASC")
      .all() as Array<{
      id: string;
      actionType: string;
      summary: string;
      payload: string;
      createdAt: string;
      expiresAt: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      actionType: row.actionType as ChatActionType,
      summary: row.summary,
      payload: this.parsePendingChatPayload(row.payload),
      createdAt: row.createdAt,
      expiresAt: row.expiresAt
    }));
  }

  getPendingChatActionById(id: string, referenceDate: Date = new Date()): ChatPendingAction | null {
    this.pruneExpiredPendingChatActions(referenceDate);

    const row = this.db
      .prepare("SELECT id, actionType, summary, payload, createdAt, expiresAt FROM chat_pending_actions WHERE id = ?")
      .get(id) as
      | {
          id: string;
          actionType: string;
          summary: string;
          payload: string;
          createdAt: string;
          expiresAt: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      actionType: row.actionType as ChatActionType,
      summary: row.summary,
      payload: this.parsePendingChatPayload(row.payload),
      createdAt: row.createdAt,
      expiresAt: row.expiresAt
    };
  }

  deletePendingChatAction(id: string): boolean {
    const result = this.db.prepare("DELETE FROM chat_pending_actions WHERE id = ?").run(id);
    return result.changes > 0;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private parseAuthRole(role: string): AuthRole {
    return role === "admin" ? "admin" : "user";
  }

  createUser(input: { email: string; passwordHash: string; role: AuthRole }): AuthUser {
    const email = this.normalizeEmail(input.email);
    const createdAt = nowIso();
    const id = makeId("user");

    this.db
      .prepare(
        `INSERT INTO users (id, email, passwordHash, role, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, email, input.passwordHash, input.role, createdAt, createdAt);

    return {
      id,
      email,
      role: input.role,
      createdAt,
      updatedAt: createdAt
    };
  }

  upsertUserByEmail(input: { email: string; passwordHash: string; role: AuthRole }): AuthUser {
    const existing = this.getUserByEmail(input.email);
    if (!existing) {
      return this.createUser(input);
    }

    const updatedAt = nowIso();
    const email = this.normalizeEmail(input.email);
    this.db
      .prepare("UPDATE users SET email = ?, passwordHash = ?, role = ?, updatedAt = ? WHERE id = ?")
      .run(email, input.passwordHash, input.role, updatedAt, existing.id);

    return {
      id: existing.id,
      email,
      role: input.role,
      createdAt: existing.createdAt,
      updatedAt
    };
  }

  getUserByEmail(email: string): AuthUserWithPassword | null {
    const normalizedEmail = this.normalizeEmail(email);
    const row = this.db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail) as
      | {
          id: string;
          email: string;
          passwordHash: string;
          role: string;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      role: this.parseAuthRole(row.role),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  getUserById(id: string): AuthUser | null {
    const row = this.db.prepare("SELECT id, email, role, createdAt, updatedAt FROM users WHERE id = ?").get(id) as
      | {
          id: string;
          email: string;
          role: string;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      email: row.email,
      role: this.parseAuthRole(row.role),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  createAuthSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
  }): AuthSession {
    const now = nowIso();
    const session: AuthSession = {
      id: makeId("session"),
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdAt: now,
      lastSeenAt: now
    };

    this.db
      .prepare(
        `INSERT INTO auth_sessions (id, userId, tokenHash, expiresAt, createdAt, lastSeenAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        session.id,
        session.userId,
        session.tokenHash,
        session.expiresAt,
        session.createdAt,
        session.lastSeenAt
      );

    this.trimAuthSessions();
    return session;
  }

  getAuthSessionByTokenHash(tokenHash: string): AuthSession | null {
    const row = this.db.prepare("SELECT * FROM auth_sessions WHERE tokenHash = ?").get(tokenHash) as
      | {
          id: string;
          userId: string;
          tokenHash: string;
          expiresAt: string;
          createdAt: string;
          lastSeenAt: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt
    };
  }

  touchAuthSession(tokenHash: string, timestamp: string = nowIso()): void {
    this.db.prepare("UPDATE auth_sessions SET lastSeenAt = ? WHERE tokenHash = ?").run(timestamp, tokenHash);
  }

  deleteAuthSessionByTokenHash(tokenHash: string): boolean {
    const result = this.db.prepare("DELETE FROM auth_sessions WHERE tokenHash = ?").run(tokenHash);
    return result.changes > 0;
  }

  deleteExpiredAuthSessions(reference: string = nowIso()): number {
    const result = this.db.prepare("DELETE FROM auth_sessions WHERE expiresAt <= ?").run(reference);
    return result.changes;
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

  resolveTagIds(tagRefs: string[], options: { createMissing?: boolean } = {}): string[] {
    const uniqueRefs = Array.from(
      new Set(
        tagRefs
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      )
    );

    if (uniqueRefs.length === 0) {
      return [];
    }

    const existingTags = this.getTags();
    const byId = new Map(existingTags.map((tag) => [tag.id, tag.id]));
    const byName = new Map(existingTags.map((tag) => [tag.name.toLowerCase(), tag.id]));
    const resolvedIds: string[] = [];
    const seenResolved = new Set<string>();
    const unresolvedNames: string[] = [];

    uniqueRefs.forEach((ref) => {
      const byIdMatch = byId.get(ref);
      if (byIdMatch) {
        if (!seenResolved.has(byIdMatch)) {
          seenResolved.add(byIdMatch);
          resolvedIds.push(byIdMatch);
        }
        return;
      }

      const byNameMatch = byName.get(ref.toLowerCase());
      if (byNameMatch) {
        if (!seenResolved.has(byNameMatch)) {
          seenResolved.add(byNameMatch);
          resolvedIds.push(byNameMatch);
        }
        return;
      }

      unresolvedNames.push(ref);
    });

    if (!options.createMissing || unresolvedNames.length === 0) {
      return resolvedIds;
    }

    unresolvedNames.forEach((name) => {
      // Preserve behavior for stale/deleted ids while allowing user-entered tag names.
      if (TAG_ID_LIKE_REGEX.test(name)) {
        return;
      }

      const existingId = byName.get(name.toLowerCase());
      if (existingId) {
        if (!seenResolved.has(existingId)) {
          seenResolved.add(existingId);
          resolvedIds.push(existingId);
        }
        return;
      }

      try {
        const created = this.createTag(name);
        byName.set(created.name.toLowerCase(), created.id);
        if (!seenResolved.has(created.id)) {
          seenResolved.add(created.id);
          resolvedIds.push(created.id);
        }
      } catch {
        const concurrentMatch = this.getTags().find((tag) => tag.name.toLowerCase() === name.toLowerCase());
        if (concurrentMatch && !seenResolved.has(concurrentMatch.id)) {
          seenResolved.add(concurrentMatch.id);
          resolvedIds.push(concurrentMatch.id);
        }
      }
    });

    return resolvedIds;
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

  deleteJournalEntry(entryId: string): boolean {
    this.db.prepare("DELETE FROM journal_entry_tags WHERE entryId = ?").run(entryId);
    const result = this.db.prepare("DELETE FROM journal_entries WHERE id = ?").run(entryId);
    return result.changes > 0;
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
      canvasAssignmentId: number | null;
    }>;

    const deadlinesCompleted = deadlinesInWindow.filter((d) => d.completed).length;
    const completionRate = deadlinesInWindow.length === 0 ? 0 : Math.round((deadlinesCompleted / deadlinesInWindow.length) * 100);

    const reflectionHighlights = this.getReflectionEntriesInRange(windowStart.toISOString(), windowEnd.toISOString(), 40)
      .slice(0, 3)
      .map((entry) => entry.evidenceSnippet.trim())
      .filter((value) => value.length > 0);

    return {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      deadlinesDue: deadlinesInWindow.length,
      deadlinesCompleted,
      completionRate,
      reflectionHighlights
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
    const location = typeof entry.location === "string" && entry.location.trim().length > 0
      ? entry.location.trim()
      : undefined;
    const lectureEvent: LectureEvent = {
      id: makeId("lecture"),
      ...entry,
      ...(location ? { location } : {})
    };

    const recurrenceJson = lectureEvent.recurrence ? JSON.stringify(lectureEvent.recurrence) : null;

    this.db
      .prepare("INSERT INTO schedule_events (id, title, location, startTime, durationMinutes, workload, recurrence, recurrenceParentId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        lectureEvent.id,
        lectureEvent.title,
        lectureEvent.location ?? null,
        lectureEvent.startTime,
        lectureEvent.durationMinutes,
        lectureEvent.workload,
        recurrenceJson,
        lectureEvent.recurrenceParentId ?? null
      );

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
      location: string | null;
      startTime: string;
      durationMinutes: number;
      workload: string;
      recurrence: string | null;
      recurrenceParentId: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      ...(row.location ? { location: row.location } : {}),
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
          location: string | null;
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
      ...(row.location ? { location: row.location } : {}),
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
      .prepare("UPDATE schedule_events SET title = ?, location = ?, startTime = ?, durationMinutes = ?, workload = ?, recurrence = ?, recurrenceParentId = ? WHERE id = ?")
      .run(
        next.title,
        typeof next.location === "string" && next.location.trim().length > 0 ? next.location.trim() : null,
        next.startTime,
        next.durationMinutes,
        next.workload,
        recurrenceJson,
        next.recurrenceParentId ?? null,
        id
      );

    return next;
  }

  deleteScheduleEvent(id: string): boolean {
    const result = this.db.prepare("DELETE FROM schedule_events WHERE id = ?").run(id);
    return result.changes > 0;
  }

  createScheduleSuggestionMute(entry: { startTime: string; endTime: string }): ScheduleSuggestionMute | null {
    const start = new Date(entry.startTime);
    const end = new Date(entry.endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
      return null;
    }

    const mute: ScheduleSuggestionMute = {
      id: makeId("schedule-mute"),
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      createdAt: nowIso()
    };

    this.db
      .prepare(
        "INSERT INTO schedule_suggestion_mutes (id, startTime, endTime, createdAt) VALUES (?, ?, ?, ?)"
      )
      .run(mute.id, mute.startTime, mute.endTime, mute.createdAt);

    return mute;
  }

  getScheduleSuggestionMutes(options: { day?: Date; now?: Date } = {}): ScheduleSuggestionMute[] {
    const referenceNow = options.now ?? new Date();

    // Opportunistic cleanup: keep mutes for 7 days after they end.
    const cleanupBefore = new Date(referenceNow.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    this.db
      .prepare("DELETE FROM schedule_suggestion_mutes WHERE endTime < ?")
      .run(cleanupBefore);

    if (options.day) {
      const dayStart = new Date(options.day);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const rows = this.db
        .prepare(
          `SELECT id, startTime, endTime, createdAt
             FROM schedule_suggestion_mutes
            WHERE startTime <= ? AND endTime >= ?
            ORDER BY startTime ASC, insertOrder ASC`
        )
        .all(dayEnd.toISOString(), dayStart.toISOString()) as Array<{
          id: string;
          startTime: string;
          endTime: string;
          createdAt: string;
        }>;

      return rows.map((row) => ({
        id: row.id,
        startTime: row.startTime,
        endTime: row.endTime,
        createdAt: row.createdAt
      }));
    }

    const rows = this.db
      .prepare(
        `SELECT id, startTime, endTime, createdAt
           FROM schedule_suggestion_mutes
          WHERE endTime >= ?
          ORDER BY startTime ASC, insertOrder ASC`
      )
      .all(referenceNow.toISOString()) as Array<{
        id: string;
        startTime: string;
        endTime: string;
        createdAt: string;
      }>;

    return rows.map((row) => ({
      id: row.id,
      startTime: row.startTime,
      endTime: row.endTime,
      createdAt: row.createdAt
    }));
  }

  createRoutinePreset(
    entry: Omit<RoutinePreset, "id" | "createdAt" | "updatedAt">
  ): RoutinePreset {
    const now = nowIso();
    const preset: RoutinePreset = {
      id: makeId("routine"),
      title: entry.title.trim(),
      preferredStartTime: entry.preferredStartTime,
      durationMinutes: Math.max(15, Math.round(entry.durationMinutes)),
      workload: entry.workload,
      weekdays: this.normalizeRoutineWeekdays(entry.weekdays),
      active: entry.active,
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(
        `INSERT INTO routine_presets
          (id, title, preferredStartTime, durationMinutes, workload, weekdays, active, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        preset.id,
        preset.title,
        preset.preferredStartTime,
        preset.durationMinutes,
        preset.workload,
        JSON.stringify(preset.weekdays),
        preset.active ? 1 : 0,
        preset.createdAt,
        preset.updatedAt
      );

    const count = (this.db.prepare("SELECT COUNT(*) as count FROM routine_presets").get() as { count: number }).count;
    if (count > this.maxRoutinePresets) {
      this.db
        .prepare(
          `DELETE FROM routine_presets WHERE id IN (
            SELECT id FROM routine_presets ORDER BY insertOrder ASC LIMIT ?
          )`
        )
        .run(count - this.maxRoutinePresets);
    }

    return preset;
  }

  getRoutinePresets(): RoutinePreset[] {
    const rows = this.db
      .prepare("SELECT * FROM routine_presets ORDER BY active DESC, title ASC, insertOrder ASC")
      .all() as Array<{
      id: string;
      title: string;
      preferredStartTime: string;
      durationMinutes: number;
      workload: string;
      weekdays: string;
      active: number;
      createdAt: string;
      updatedAt: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      preferredStartTime: row.preferredStartTime,
      durationMinutes: row.durationMinutes,
      workload: row.workload as RoutinePreset["workload"],
      weekdays: this.normalizeRoutineWeekdays(JSON.parse(row.weekdays)),
      active: row.active === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  getRoutinePresetById(id: string): RoutinePreset | null {
    const row = this.db.prepare("SELECT * FROM routine_presets WHERE id = ?").get(id) as
      | {
          id: string;
          title: string;
          preferredStartTime: string;
          durationMinutes: number;
          workload: string;
          weekdays: string;
          active: number;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      preferredStartTime: row.preferredStartTime,
      durationMinutes: row.durationMinutes,
      workload: row.workload as RoutinePreset["workload"],
      weekdays: this.normalizeRoutineWeekdays(JSON.parse(row.weekdays)),
      active: row.active === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  updateRoutinePreset(
    id: string,
    patch: Partial<Omit<RoutinePreset, "id" | "createdAt" | "updatedAt">>
  ): RoutinePreset | null {
    const existing = this.getRoutinePresetById(id);
    if (!existing) {
      return null;
    }

    const next: RoutinePreset = {
      ...existing,
      ...patch,
      title: typeof patch.title === "string" ? patch.title.trim() : existing.title,
      preferredStartTime: patch.preferredStartTime ?? existing.preferredStartTime,
      durationMinutes:
        typeof patch.durationMinutes === "number"
          ? Math.max(15, Math.round(patch.durationMinutes))
          : existing.durationMinutes,
      workload: patch.workload ?? existing.workload,
      weekdays: patch.weekdays ? this.normalizeRoutineWeekdays(patch.weekdays) : existing.weekdays,
      active: patch.active ?? existing.active,
      updatedAt: nowIso()
    };

    this.db
      .prepare(
        `UPDATE routine_presets
         SET title = ?, preferredStartTime = ?, durationMinutes = ?, workload = ?, weekdays = ?, active = ?, updatedAt = ?
         WHERE id = ?`
      )
      .run(
        next.title,
        next.preferredStartTime,
        next.durationMinutes,
        next.workload,
        JSON.stringify(next.weekdays),
        next.active ? 1 : 0,
        next.updatedAt,
        id
      );

    return next;
  }

  private normalizeRoutineWeekdays(input: unknown): number[] {
    const values = Array.isArray(input) ? input : [];
    const normalized = values
      .map((value) => (typeof value === "number" ? value : Number.NaN))
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
      .map((value) => Number(value));

    if (normalized.length === 0) {
      return [0, 1, 2, 3, 4, 5, 6];
    }

    return Array.from(new Set(normalized)).sort((a, b) => a - b);
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

  private normalizeDeadlineEffort(deadline: Deadline): Deadline {
    const hasEffortInput = typeof deadline.effortHoursRemaining === "number" && Number.isFinite(deadline.effortHoursRemaining);
    if (!hasEffortInput) {
      return {
        ...deadline,
        effortHoursRemaining: undefined,
        effortConfidence: undefined
      };
    }

    const effortHoursRemaining = Math.max(0, Number(deadline.effortHoursRemaining));
    const effortConfidence = deadline.effortConfidence ?? "medium";

    return {
      ...deadline,
      effortHoursRemaining,
      effortConfidence
    };
  }

  createDeadline(entry: Omit<Deadline, "id">): Deadline {
    const deadline = this.normalizeDeadlineEffort({
      id: makeId("deadline"),
      ...entry
    });

    this.db
      .prepare(
        `INSERT INTO deadlines (
          id, course, task, dueDate, sourceDueDate, priority, completed, canvasAssignmentId, effortHoursRemaining, effortConfidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        deadline.id,
        deadline.course,
        deadline.task,
        deadline.dueDate,
        deadline.sourceDueDate ?? null,
        deadline.priority,
        deadline.completed ? 1 : 0,
        deadline.canvasAssignmentId ?? null,
        deadline.effortHoursRemaining ?? null,
        deadline.effortConfidence ?? null
      );

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
      sourceDueDate: string | null;
      priority: string;
      completed: number;
      canvasAssignmentId: number | null;
      effortHoursRemaining: number | null;
      effortConfidence: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      course: row.course,
      task: row.task,
      dueDate: row.dueDate,
      ...(row.sourceDueDate ? { sourceDueDate: row.sourceDueDate } : {}),
      priority: row.priority as Deadline["priority"],
      completed: Boolean(row.completed),
      ...(row.canvasAssignmentId && { canvasAssignmentId: row.canvasAssignmentId }),
      ...(row.effortHoursRemaining !== null ? { effortHoursRemaining: row.effortHoursRemaining } : {}),
      ...(row.effortConfidence ? { effortConfidence: row.effortConfidence as Deadline["effortConfidence"] } : {})
    })).map((deadline) => (applyEscalation ? this.applyDeadlinePriorityEscalation(deadline, referenceDate) : deadline));
  }

  getAcademicDeadlines(referenceDate: Date = new Date(), applyEscalation = true): Deadline[] {
    return this.getDeadlines(referenceDate, applyEscalation).filter((deadline) => isAssignmentOrExamDeadline(deadline));
  }

  purgeNonAcademicDeadlines(): number {
    const stale = this.getDeadlines(new Date(), false).filter((deadline) => !isAssignmentOrExamDeadline(deadline));
    let removed = 0;

    stale.forEach((deadline) => {
      if (this.deleteDeadline(deadline.id)) {
        removed += 1;
      }
    });

    return removed;
  }

  getDeadlineById(id: string, applyEscalation = true, referenceDate: Date = new Date()): Deadline | null {
    const row = this.db.prepare("SELECT * FROM deadlines WHERE id = ?").get(id) as
      | {
          id: string;
          course: string;
          task: string;
          dueDate: string;
          sourceDueDate: string | null;
          priority: string;
          completed: number;
          canvasAssignmentId: number | null;
          effortHoursRemaining: number | null;
          effortConfidence: string | null;
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
      ...(row.sourceDueDate ? { sourceDueDate: row.sourceDueDate } : {}),
      priority: row.priority as Deadline["priority"],
      completed: Boolean(row.completed),
      ...(row.canvasAssignmentId && { canvasAssignmentId: row.canvasAssignmentId }),
      ...(row.effortHoursRemaining !== null ? { effortHoursRemaining: row.effortHoursRemaining } : {}),
      ...(row.effortConfidence ? { effortConfidence: row.effortConfidence as Deadline["effortConfidence"] } : {})
    };

    return applyEscalation ? this.applyDeadlinePriorityEscalation(deadline, referenceDate) : deadline;
  }

  updateDeadline(id: string, patch: Partial<Omit<Deadline, "id">>): Deadline | null {
    const existing = this.getDeadlineById(id, false);

    if (!existing) {
      return null;
    }

    const next = this.normalizeDeadlineEffort({
      ...existing,
      ...patch
    });

    this.db
      .prepare(
        `UPDATE deadlines SET
          course = ?, task = ?, dueDate = ?, sourceDueDate = ?, priority = ?, completed = ?,
          canvasAssignmentId = ?, effortHoursRemaining = ?, effortConfidence = ?
         WHERE id = ?`
      )
      .run(
        next.course,
        next.task,
        next.dueDate,
        next.sourceDueDate ?? null,
        next.priority,
        next.completed ? 1 : 0,
        next.canvasAssignmentId ?? null,
        next.effortHoursRemaining ?? null,
        next.effortConfidence ?? null,
        id
      );

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

  updateHabit(
    id: string,
    patch: Partial<Pick<Habit, "name" | "cadence" | "targetPerWeek" | "motivation">>
  ): HabitWithStatus | null {
    const existing = this.getHabitById(id);
    if (!existing) {
      return null;
    }

    const next: Habit = {
      ...existing,
      ...patch
    };

    this.db
      .prepare(
        `UPDATE habits SET
          name = ?, cadence = ?, targetPerWeek = ?, motivation = ?
         WHERE id = ?`
      )
      .run(next.name, next.cadence, next.targetPerWeek, next.motivation ?? null, id);

    return this.getHabitWithStatus(id);
  }

  deleteHabit(id: string): boolean {
    this.db.prepare("DELETE FROM habit_check_ins WHERE habitId = ?").run(id);
    const result = this.db.prepare("DELETE FROM habits WHERE id = ?").run(id);
    return result.changes > 0;
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

  /** Find a habit named "Gym" (case-insensitive), or create one if it doesn't exist. */
  ensureGymHabit(): Habit {
    const habits = this.getHabits();
    const gym = habits.find((h) => h.name.toLowerCase() === "gym");
    if (gym) return gym;
    const created = this.createHabit({ name: "Gym", cadence: "daily", targetPerWeek: 5 });
    return created;
  }

  /** Get set of date keys where the gym habit was checked-in within the range. */
  getGymCheckInDates(from: string, to: string): Set<string> {
    const habits = this.getHabits();
    const gym = habits.find((h) => h.name.toLowerCase() === "gym");
    if (!gym) return new Set();

    const rows = this.db
      .prepare(
        "SELECT checkInDate FROM habit_check_ins WHERE habitId = ? AND completed = 1 AND checkInDate >= ? AND checkInDate <= ?"
      )
      .all(gym.id, from, to) as Array<{ checkInDate: string }>;

    return new Set(rows.map((r) => r.checkInDate));
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
    const { streak, graceUsed } = this.computeStreak(checkIns, todayKey);
    const todayCompleted = recent.find((c) => c.date === todayKey)?.completed ?? false;

    return {
      ...habit,
      todayCompleted,
      streak,
      streakGraceUsed: graceUsed,
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

  updateGoal(
    id: string,
    patch: Partial<Pick<Goal, "title" | "cadence" | "targetCount" | "dueDate" | "motivation">>
  ): GoalWithStatus | null {
    const existing = this.getGoalById(id);
    if (!existing) {
      return null;
    }

    const next: Goal = {
      ...existing,
      ...patch
    };

    this.db
      .prepare(
        `UPDATE goals SET
          title = ?, cadence = ?, targetCount = ?, dueDate = ?, motivation = ?
         WHERE id = ?`
      )
      .run(next.title, next.cadence, next.targetCount, next.dueDate ?? null, next.motivation ?? null, id);

    return this.getGoalWithStatus(id);
  }

  deleteGoal(id: string): boolean {
    this.db.prepare("DELETE FROM goal_check_ins WHERE goalId = ?").run(id);
    const result = this.db.prepare("DELETE FROM goals WHERE id = ?").run(id);
    return result.changes > 0;
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
    const { streak, graceUsed } = this.computeStreak(checkIns, todayKey);
    const todayCompleted = recent.find((c) => c.date === todayKey)?.completed ?? false;
    const progressCount = checkIns.filter((c) => c.completed).length;
    const remaining = Math.max(goal.targetCount - progressCount, 0);

    return {
      ...goal,
      progressCount,
      remaining,
      todayCompleted,
      streak,
      streakGraceUsed: graceUsed,
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

  private normalizeNutritionMealType(value: string | undefined): NutritionMealType {
    const normalized = (value ?? "other").trim().toLowerCase();
    if (
      normalized === "breakfast" ||
      normalized === "lunch" ||
      normalized === "dinner" ||
      normalized === "snack" ||
      normalized === "other"
    ) {
      return normalized;
    }
    return "other";
  }

  private clampNutritionMetric(value: number, fallback = 0, max = 10000, precision = 1): number {
    if (!Number.isFinite(value)) {
      return fallback;
    }
    const clamped = Math.min(max, Math.max(0, value));
    const decimals = Number.isInteger(precision) ? Math.min(Math.max(precision, 0), 6) : 1;
    const factor = 10 ** decimals;
    return Math.round(clamped * factor) / factor;
  }

  private clampSignedNutritionMetric(value: number, fallback = 0, min = -5000, max = 5000, precision = 1): number {
    if (!Number.isFinite(value)) {
      return fallback;
    }
    const clamped = Math.min(max, Math.max(min, value));
    const decimals = Number.isInteger(precision) ? Math.min(Math.max(precision, 0), 6) : 1;
    const factor = 10 ** decimals;
    return Math.round(clamped * factor) / factor;
  }

  private toOptionalMetric(value: unknown, max: number, precision = 1): number | null {
    if (typeof value !== "number") {
      return null;
    }
    return this.clampNutritionMetric(value, 0, max, precision);
  }

  private toOptionalSignedMetric(value: unknown, min: number, max: number, precision = 1): number | null {
    if (typeof value !== "number") {
      return null;
    }
    return this.clampSignedNutritionMetric(value, 0, min, max, precision);
  }

  private deriveNutritionTargetsFromSettings(input: {
    weightKg: number | null;
    maintenanceCalories: number | null;
    surplusCalories: number | null;
    proteinGramsPerLb?: number | null;
    fatGramsPerLb?: number | null;
  }): {
    targetCalories: number;
    targetProteinGrams: number;
    targetCarbsGrams: number;
    targetFatGrams: number;
  } | null {
    if (
      typeof input.weightKg !== "number" ||
      typeof input.maintenanceCalories !== "number" ||
      typeof input.surplusCalories !== "number"
    ) {
      return null;
    }

    const proteinPerLb = typeof input.proteinGramsPerLb === "number" ? input.proteinGramsPerLb : 0.8;
    const fatPerLb = typeof input.fatGramsPerLb === "number" ? input.fatGramsPerLb : 0.4;

    const targetCalories = this.clampNutritionMetric(input.maintenanceCalories + input.surplusCalories, 0, 15000, 6);
    const weightLb = input.weightKg * 2.2046226218;
    const targetProteinGrams = this.clampNutritionMetric(weightLb * proteinPerLb, 0, 1000, 6);
    const targetFatGrams = this.clampNutritionMetric(weightLb * fatPerLb, 0, 600, 6);
    const remainingCalories = Math.max(0, targetCalories - targetProteinGrams * 4 - targetFatGrams * 9);
    const targetCarbsGrams = this.clampNutritionMetric(remainingCalories / 4, 0, 1500, 6);

    return {
      targetCalories,
      targetProteinGrams,
      targetCarbsGrams,
      targetFatGrams
    };
  }

  private normalizeIsoOrNow(value: string | undefined): string {
    if (typeof value !== "string") {
      return nowIso();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? nowIso() : parsed.toISOString();
  }

  private normalizeNutritionMealItems(value: unknown): NutritionMealItem[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const normalized: NutritionMealItem[] = [];
    for (const rawItem of value) {
      if (!rawItem || typeof rawItem !== "object") {
        continue;
      }
      const item = rawItem as Record<string, unknown>;
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!name) {
        continue;
      }

      const id =
        typeof item.id === "string" && item.id.trim().length > 0 ? item.id.trim() : makeId("nutrition-meal-item");
      const quantity =
        typeof item.quantity === "number" ? this.clampNutritionMetric(item.quantity, 1, 1000) : 1;
      const unitLabel =
        typeof item.unitLabel === "string" && item.unitLabel.trim().length > 0 ? item.unitLabel.trim() : "serving";

      normalized.push({
        id,
        name,
        quantity: Math.max(0.1, quantity),
        unitLabel,
        caloriesPerUnit: this.clampNutritionMetric(
          typeof item.caloriesPerUnit === "number" ? item.caloriesPerUnit : 0,
          0,
          10000,
          4
        ),
        proteinGramsPerUnit: this.clampNutritionMetric(
          typeof item.proteinGramsPerUnit === "number" ? item.proteinGramsPerUnit : 0,
          0,
          1000,
          4
        ),
        carbsGramsPerUnit: this.clampNutritionMetric(
          typeof item.carbsGramsPerUnit === "number" ? item.carbsGramsPerUnit : 0,
          0,
          1500,
          4
        ),
        fatGramsPerUnit: this.clampNutritionMetric(
          typeof item.fatGramsPerUnit === "number" ? item.fatGramsPerUnit : 0,
          0,
          600,
          4
        ),
        ...(typeof item.customFoodId === "string" && item.customFoodId.trim().length > 0
          ? { customFoodId: item.customFoodId.trim() }
          : {})
      });
    }

    return normalized;
  }

  private parseNutritionMealItemsJson(raw: string | null | undefined): NutritionMealItem[] {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return this.normalizeNutritionMealItems(parsed);
    } catch {
      return [];
    }
  }

  private toNutritionConsumedTime(iso: string): string {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
      return "00:00";
    }
    const hours = String(parsed.getUTCHours()).padStart(2, "0");
    const minutes = String(parsed.getUTCMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  }

  private stripNutritionMealDoneToken(notes: string | null | undefined): string | undefined {
    if (typeof notes !== "string") {
      return undefined;
    }
    const cleaned = notes.replaceAll(NUTRITION_MEAL_DONE_TOKEN, "").trim();
    return cleaned.length > 0 ? cleaned : undefined;
  }

  private isValidNutritionConsumedTime(value: string): boolean {
    if (!/^\d{2}:\d{2}$/.test(value)) {
      return false;
    }
    const [hoursRaw, minutesRaw] = value.split(":");
    const hours = Number.parseInt(hoursRaw ?? "", 10);
    const minutes = Number.parseInt(minutesRaw ?? "", 10);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
      return false;
    }
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
  }

  private toNutritionConsumedAtForDate(dateKey: string, consumedTime: string, orderIndex: number): string {
    const fallback = new Date(`${dateKey}T00:00:00.000Z`);
    if (Number.isNaN(fallback.getTime())) {
      return nowIso();
    }

    if (!this.isValidNutritionConsumedTime(consumedTime)) {
      fallback.setUTCMinutes(orderIndex);
      return fallback.toISOString();
    }

    const [hoursRaw, minutesRaw] = consumedTime.split(":");
    const hours = Number.parseInt(hoursRaw ?? "0", 10);
    const minutes = Number.parseInt(minutesRaw ?? "0", 10);
    fallback.setUTCHours(hours, minutes, 0, 0);
    return fallback.toISOString();
  }

  private normalizeNutritionPlanSnapshotTarget(value: unknown): NutritionPlanSnapshotTarget | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const record = value as Record<string, unknown>;
    const target: NutritionPlanSnapshotTarget = {};

    if (typeof record.weightKg === "number") {
      target.weightKg = this.clampNutritionMetric(record.weightKg, 0, 500);
    }
    if (typeof record.maintenanceCalories === "number") {
      target.maintenanceCalories = this.clampNutritionMetric(record.maintenanceCalories, 0, 10000);
    }
    if (typeof record.surplusCalories === "number") {
      target.surplusCalories = this.clampSignedNutritionMetric(record.surplusCalories, 0, -5000, 5000);
    }
    if (typeof record.targetCalories === "number") {
      target.targetCalories = this.clampNutritionMetric(record.targetCalories, 0, 15000);
    }
    if (typeof record.targetProteinGrams === "number") {
      target.targetProteinGrams = this.clampNutritionMetric(record.targetProteinGrams, 0, 1000);
    }
    if (typeof record.targetCarbsGrams === "number") {
      target.targetCarbsGrams = this.clampNutritionMetric(record.targetCarbsGrams, 0, 1500);
    }
    if (typeof record.targetFatGrams === "number") {
      target.targetFatGrams = this.clampNutritionMetric(record.targetFatGrams, 0, 600);
    }

    return Object.keys(target).length > 0 ? target : null;
  }

  private normalizeNutritionPlanSnapshotMeals(value: unknown): NutritionPlanSnapshotMeal[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const normalized: NutritionPlanSnapshotMeal[] = [];
    value.forEach((entry, orderIndex) => {
      if (!entry || typeof entry !== "object") {
        return;
      }

      const record = entry as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      if (!name) {
        return;
      }

      const items = this.normalizeNutritionMealItems(record.items).map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitLabel: item.unitLabel,
        caloriesPerUnit: item.caloriesPerUnit,
        proteinGramsPerUnit: item.proteinGramsPerUnit,
        carbsGramsPerUnit: item.carbsGramsPerUnit,
        fatGramsPerUnit: item.fatGramsPerUnit,
        ...(item.customFoodId ? { customFoodId: item.customFoodId } : {})
      }));

      const consumedTimeRaw = typeof record.consumedTime === "string" ? record.consumedTime.trim() : "";
      const consumedTime = this.isValidNutritionConsumedTime(consumedTimeRaw)
        ? consumedTimeRaw
        : this.toNutritionConsumedTime(new Date(Date.UTC(1970, 0, 1, 0, orderIndex, 0, 0)).toISOString());

      const meal: NutritionPlanSnapshotMeal = {
        name,
        mealType: this.normalizeNutritionMealType(
          typeof record.mealType === "string" ? record.mealType : undefined
        ),
        consumedTime,
        items,
        ...(typeof record.calories === "number"
          ? { calories: this.clampNutritionMetric(record.calories, 0, 10000) }
          : {}),
        ...(typeof record.proteinGrams === "number"
          ? { proteinGrams: this.clampNutritionMetric(record.proteinGrams, 0, 1000) }
          : {}),
        ...(typeof record.carbsGrams === "number"
          ? { carbsGrams: this.clampNutritionMetric(record.carbsGrams, 0, 1500) }
          : {}),
        ...(typeof record.fatGrams === "number"
          ? { fatGrams: this.clampNutritionMetric(record.fatGrams, 0, 600) }
          : {}),
        ...(this.stripNutritionMealDoneToken(typeof record.notes === "string" ? record.notes : undefined)
          ? { notes: this.stripNutritionMealDoneToken(typeof record.notes === "string" ? record.notes : undefined) }
          : {})
      };

      normalized.push(meal);
    });

    return normalized;
  }

  private parseNutritionPlanSnapshotTargetJson(raw: string | null | undefined): NutritionPlanSnapshotTarget | null {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return this.normalizeNutritionPlanSnapshotTarget(parsed);
    } catch {
      return null;
    }
  }

  private parseNutritionPlanSnapshotMealsJson(raw: string | null | undefined): NutritionPlanSnapshotMeal[] {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return this.normalizeNutritionPlanSnapshotMeals(parsed);
    } catch {
      return [];
    }
  }

  private computeNutritionTotalsFromMealItems(items: NutritionMealItem[]): {
    calories: number;
    proteinGrams: number;
    carbsGrams: number;
    fatGrams: number;
  } {
    const totals = items.reduce(
      (acc, item) => {
        acc.calories += item.caloriesPerUnit * item.quantity;
        acc.proteinGrams += item.proteinGramsPerUnit * item.quantity;
        acc.carbsGrams += item.carbsGramsPerUnit * item.quantity;
        acc.fatGrams += item.fatGramsPerUnit * item.quantity;
        return acc;
      },
      {
        calories: 0,
        proteinGrams: 0,
        carbsGrams: 0,
        fatGrams: 0
      }
    );

    return {
      calories: this.clampNutritionMetric(totals.calories, 0, 10000),
      proteinGrams: this.clampNutritionMetric(totals.proteinGrams, 0, 1000),
      carbsGrams: this.clampNutritionMetric(totals.carbsGrams, 0, 1500),
      fatGrams: this.clampNutritionMetric(totals.fatGrams, 0, 600)
    };
  }

  createNutritionMeal(
    entry: Pick<NutritionMeal, "name" | "mealType" | "consumedAt"> &
      Partial<Pick<NutritionMeal, "items" | "calories" | "proteinGrams" | "carbsGrams" | "fatGrams" | "notes">> & {
        createdAt?: string;
      }
  ): NutritionMeal {
    const consumedAt = this.normalizeIsoOrNow(entry.consumedAt);
    const items = this.normalizeNutritionMealItems(entry.items);
    const derivedTotals =
      items.length > 0
        ? this.computeNutritionTotalsFromMealItems(items)
        : {
            calories: this.clampNutritionMetric(
              typeof entry.calories === "number" ? entry.calories : 0,
              0,
              10000
            ),
            proteinGrams: this.clampNutritionMetric(
              typeof entry.proteinGrams === "number" ? entry.proteinGrams : 0,
              0,
              1000
            ),
            carbsGrams: this.clampNutritionMetric(typeof entry.carbsGrams === "number" ? entry.carbsGrams : 0, 0, 1500),
            fatGrams: this.clampNutritionMetric(typeof entry.fatGrams === "number" ? entry.fatGrams : 0, 0, 600)
          };
    const meal: NutritionMeal = {
      id: makeId("meal"),
      name: entry.name.trim(),
      mealType: this.normalizeNutritionMealType(entry.mealType),
      consumedAt,
      items,
      calories: derivedTotals.calories,
      proteinGrams: derivedTotals.proteinGrams,
      carbsGrams: derivedTotals.carbsGrams,
      fatGrams: derivedTotals.fatGrams,
      ...(entry.notes && entry.notes.trim().length > 0 ? { notes: entry.notes.trim() } : {}),
      createdAt: this.normalizeIsoOrNow(entry.createdAt)
    };

    this.db
      .prepare(
        `INSERT INTO nutrition_meals (
          id, name, mealType, consumedAt, calories, proteinGrams, carbsGrams, fatGrams, itemsJson, notes, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        meal.id,
        meal.name,
        meal.mealType,
        meal.consumedAt,
        meal.calories,
        meal.proteinGrams,
        meal.carbsGrams,
        meal.fatGrams,
        JSON.stringify(meal.items),
        meal.notes ?? null,
        meal.createdAt
      );

    this.trimNutritionMeals();
    return meal;
  }

  getNutritionMealById(id: string): NutritionMeal | null {
    const row = this.db.prepare("SELECT * FROM nutrition_meals WHERE id = ?").get(id) as
      | {
          id: string;
          name: string;
          mealType: string;
          consumedAt: string;
          calories: number;
          proteinGrams: number;
          carbsGrams: number;
          fatGrams: number;
          itemsJson: string | null;
          notes: string | null;
          createdAt: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      mealType: this.normalizeNutritionMealType(row.mealType),
      consumedAt: row.consumedAt,
      items: this.parseNutritionMealItemsJson(row.itemsJson),
      calories: this.clampNutritionMetric(row.calories, 0, 10000),
      proteinGrams: this.clampNutritionMetric(row.proteinGrams, 0, 1000),
      carbsGrams: this.clampNutritionMetric(row.carbsGrams, 0, 1500),
      fatGrams: this.clampNutritionMetric(row.fatGrams, 0, 600),
      ...(row.notes ? { notes: row.notes } : {}),
      createdAt: row.createdAt
    };
  }

  getNutritionMeals(options: {
    date?: string;
    from?: string;
    to?: string;
    limit?: number;
    skipBaselineHydration?: boolean;
  } = {}): NutritionMeal[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (typeof options.date === "string" && options.date.trim().length > 0) {
      const requestedDate = options.date.trim();
      if (!options.skipBaselineHydration) {
        this.ensureNutritionBaselineForDate(requestedDate);
      }
      const start = new Date(`${requestedDate}T00:00:00.000Z`);
      if (!Number.isNaN(start.getTime())) {
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);
        clauses.push("consumedAt >= ?", "consumedAt < ?");
        params.push(start.toISOString(), end.toISOString());
      }
    } else {
      if (typeof options.from === "string" && options.from.trim().length > 0) {
        const fromDate = new Date(options.from);
        if (!Number.isNaN(fromDate.getTime())) {
          clauses.push("consumedAt >= ?");
          params.push(fromDate.toISOString());
        }
      }
      if (typeof options.to === "string" && options.to.trim().length > 0) {
        const toDate = new Date(options.to);
        if (!Number.isNaN(toDate.getTime())) {
          clauses.push("consumedAt <= ?");
          params.push(toDate.toISOString());
        }
      }
    }

    let query = "SELECT * FROM nutrition_meals";
    if (clauses.length > 0) {
      query += ` WHERE ${clauses.join(" AND ")}`;
    }
    query += " ORDER BY consumedAt ASC, insertOrder ASC";

    const limit = typeof options.limit === "number" ? Math.min(Math.max(Math.round(options.limit), 1), 1000) : null;
    if (limit !== null) {
      query += " LIMIT ?";
      params.push(limit);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string;
      name: string;
      mealType: string;
      consumedAt: string;
      calories: number;
      proteinGrams: number;
      carbsGrams: number;
      fatGrams: number;
      itemsJson: string | null;
      notes: string | null;
      createdAt: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      mealType: this.normalizeNutritionMealType(row.mealType),
      consumedAt: row.consumedAt,
      items: this.parseNutritionMealItemsJson(row.itemsJson),
      calories: this.clampNutritionMetric(row.calories, 0, 10000),
      proteinGrams: this.clampNutritionMetric(row.proteinGrams, 0, 1000),
      carbsGrams: this.clampNutritionMetric(row.carbsGrams, 0, 1500),
      fatGrams: this.clampNutritionMetric(row.fatGrams, 0, 600),
      ...(row.notes ? { notes: row.notes } : {}),
      createdAt: row.createdAt
    }));
  }

  updateNutritionMeal(
    id: string,
    patch: Partial<Omit<NutritionMeal, "id" | "createdAt">>
  ): NutritionMeal | null {
    const existing = this.getNutritionMealById(id);
    if (!existing) {
      return null;
    }

    const name = typeof patch.name === "string" ? patch.name.trim() : existing.name;
    if (!name) {
      return null;
    }

    const hasItemsPatch = Object.prototype.hasOwnProperty.call(patch, "items");
    const nextItems = hasItemsPatch ? this.normalizeNutritionMealItems((patch as { items?: unknown }).items) : existing.items;
    const totalsFromItems = nextItems.length > 0 ? this.computeNutritionTotalsFromMealItems(nextItems) : null;

    const next: NutritionMeal = {
      ...existing,
      ...patch,
      name,
      mealType:
        patch.mealType !== undefined
          ? this.normalizeNutritionMealType(patch.mealType)
          : existing.mealType,
      consumedAt:
        typeof patch.consumedAt === "string"
          ? this.normalizeIsoOrNow(patch.consumedAt)
          : existing.consumedAt,
      items: nextItems,
      calories:
        totalsFromItems
          ? totalsFromItems.calories
          : typeof patch.calories === "number"
          ? this.clampNutritionMetric(patch.calories, existing.calories, 10000)
          : existing.calories,
      proteinGrams:
        totalsFromItems
          ? totalsFromItems.proteinGrams
          : typeof patch.proteinGrams === "number"
          ? this.clampNutritionMetric(patch.proteinGrams, existing.proteinGrams, 1000)
          : existing.proteinGrams,
      carbsGrams:
        totalsFromItems
          ? totalsFromItems.carbsGrams
          : typeof patch.carbsGrams === "number"
          ? this.clampNutritionMetric(patch.carbsGrams, existing.carbsGrams, 1500)
          : existing.carbsGrams,
      fatGrams:
        totalsFromItems
          ? totalsFromItems.fatGrams
          : typeof patch.fatGrams === "number"
          ? this.clampNutritionMetric(patch.fatGrams, existing.fatGrams, 600)
          : existing.fatGrams,
      ...(Object.prototype.hasOwnProperty.call(patch, "notes")
        ? patch.notes && patch.notes.trim().length > 0
          ? { notes: patch.notes.trim() }
          : {}
        : existing.notes
          ? { notes: existing.notes }
          : {})
    };

    this.db
      .prepare(
        `UPDATE nutrition_meals SET
          name = ?, mealType = ?, consumedAt = ?, calories = ?, proteinGrams = ?, carbsGrams = ?, fatGrams = ?, itemsJson = ?, notes = ?
         WHERE id = ?`
      )
      .run(
        next.name,
        next.mealType,
        next.consumedAt,
        next.calories,
        next.proteinGrams,
        next.carbsGrams,
        next.fatGrams,
        JSON.stringify(next.items),
        next.notes ?? null,
        id
      );

    return next;
  }

  deleteNutritionMeal(id: string): boolean {
    const result = this.db.prepare("DELETE FROM nutrition_meals WHERE id = ?").run(id);
    return result.changes > 0;
  }

  createNutritionCustomFood(
    entry: Omit<NutritionCustomFood, "id" | "createdAt" | "updatedAt"> &
      Partial<Pick<NutritionCustomFood, "createdAt" | "updatedAt">>
  ): NutritionCustomFood {
    const timestamp = nowIso();
    const food: NutritionCustomFood = {
      id: makeId("custom-food"),
      name: entry.name.trim(),
      unitLabel: entry.unitLabel.trim(),
      caloriesPerUnit: this.clampNutritionMetric(entry.caloriesPerUnit, 0, 10000, 4),
      proteinGramsPerUnit: this.clampNutritionMetric(entry.proteinGramsPerUnit, 0, 1000, 4),
      carbsGramsPerUnit: this.clampNutritionMetric(entry.carbsGramsPerUnit, 0, 1500, 4),
      fatGramsPerUnit: this.clampNutritionMetric(entry.fatGramsPerUnit, 0, 600, 4),
      createdAt: this.normalizeIsoOrNow(entry.createdAt ?? timestamp),
      updatedAt: this.normalizeIsoOrNow(entry.updatedAt ?? timestamp)
    };

    this.db
      .prepare(
        `INSERT INTO nutrition_custom_foods (
          id, name, unitLabel, caloriesPerUnit, proteinGramsPerUnit, carbsGramsPerUnit, fatGramsPerUnit, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        food.id,
        food.name,
        food.unitLabel,
        food.caloriesPerUnit,
        food.proteinGramsPerUnit,
        food.carbsGramsPerUnit,
        food.fatGramsPerUnit,
        food.createdAt,
        food.updatedAt
      );

    this.trimNutritionCustomFoods();
    return food;
  }

  getNutritionCustomFoodById(id: string): NutritionCustomFood | null {
    const row = this.db.prepare("SELECT * FROM nutrition_custom_foods WHERE id = ?").get(id) as
      | {
          id: string;
          name: string;
          unitLabel: string;
          caloriesPerUnit: number;
          proteinGramsPerUnit: number;
          carbsGramsPerUnit: number;
          fatGramsPerUnit: number;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      unitLabel: row.unitLabel,
      caloriesPerUnit: this.clampNutritionMetric(row.caloriesPerUnit, 0, 10000, 4),
      proteinGramsPerUnit: this.clampNutritionMetric(row.proteinGramsPerUnit, 0, 1000, 4),
      carbsGramsPerUnit: this.clampNutritionMetric(row.carbsGramsPerUnit, 0, 1500, 4),
      fatGramsPerUnit: this.clampNutritionMetric(row.fatGramsPerUnit, 0, 600, 4),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  getNutritionCustomFoods(options: { query?: string; limit?: number } = {}): NutritionCustomFood[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (typeof options.query === "string" && options.query.trim().length > 0) {
      clauses.push("name LIKE ? COLLATE NOCASE");
      params.push(`%${options.query.trim()}%`);
    }

    let query = "SELECT * FROM nutrition_custom_foods";
    if (clauses.length > 0) {
      query += ` WHERE ${clauses.join(" AND ")}`;
    }
    query += " ORDER BY updatedAt DESC, insertOrder DESC";

    const limit = typeof options.limit === "number" ? Math.min(Math.max(Math.round(options.limit), 1), 2000) : null;
    if (limit !== null) {
      query += " LIMIT ?";
      params.push(limit);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string;
      name: string;
      unitLabel: string;
      caloriesPerUnit: number;
      proteinGramsPerUnit: number;
      carbsGramsPerUnit: number;
      fatGramsPerUnit: number;
      createdAt: string;
      updatedAt: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      unitLabel: row.unitLabel,
      caloriesPerUnit: this.clampNutritionMetric(row.caloriesPerUnit, 0, 10000, 4),
      proteinGramsPerUnit: this.clampNutritionMetric(row.proteinGramsPerUnit, 0, 1000, 4),
      carbsGramsPerUnit: this.clampNutritionMetric(row.carbsGramsPerUnit, 0, 1500, 4),
      fatGramsPerUnit: this.clampNutritionMetric(row.fatGramsPerUnit, 0, 600, 4),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  updateNutritionCustomFood(
    id: string,
    patch: Partial<Omit<NutritionCustomFood, "id" | "createdAt" | "updatedAt">>
  ): NutritionCustomFood | null {
    const existing = this.getNutritionCustomFoodById(id);
    if (!existing) {
      return null;
    }

    const next: NutritionCustomFood = {
      ...existing,
      ...patch,
      name: typeof patch.name === "string" ? patch.name.trim() : existing.name,
      unitLabel: typeof patch.unitLabel === "string" ? patch.unitLabel.trim() : existing.unitLabel,
      caloriesPerUnit:
        typeof patch.caloriesPerUnit === "number"
          ? this.clampNutritionMetric(patch.caloriesPerUnit, 0, 10000, 4)
          : existing.caloriesPerUnit,
      proteinGramsPerUnit:
        typeof patch.proteinGramsPerUnit === "number"
          ? this.clampNutritionMetric(patch.proteinGramsPerUnit, 0, 1000, 4)
          : existing.proteinGramsPerUnit,
      carbsGramsPerUnit:
        typeof patch.carbsGramsPerUnit === "number"
          ? this.clampNutritionMetric(patch.carbsGramsPerUnit, 0, 1500, 4)
          : existing.carbsGramsPerUnit,
      fatGramsPerUnit:
        typeof patch.fatGramsPerUnit === "number"
          ? this.clampNutritionMetric(patch.fatGramsPerUnit, 0, 600, 4)
          : existing.fatGramsPerUnit,
      updatedAt: nowIso()
    };

    this.db
      .prepare(
        `UPDATE nutrition_custom_foods SET
          name = ?, unitLabel = ?, caloriesPerUnit = ?, proteinGramsPerUnit = ?, carbsGramsPerUnit = ?, fatGramsPerUnit = ?, updatedAt = ?
         WHERE id = ?`
      )
      .run(
        next.name,
        next.unitLabel,
        next.caloriesPerUnit,
        next.proteinGramsPerUnit,
        next.carbsGramsPerUnit,
        next.fatGramsPerUnit,
        next.updatedAt,
        id
      );

    return next;
  }

  deleteNutritionCustomFood(id: string): boolean {
    const result = this.db.prepare("DELETE FROM nutrition_custom_foods WHERE id = ?").run(id);
    return result.changes > 0;
  }

  getNutritionTargetProfile(date: string | Date = new Date()): NutritionTargetProfile | null {
    const dateKey = this.toDateKey(date);
    const row = this.db.prepare("SELECT * FROM nutrition_target_profiles WHERE dateKey = ?").get(dateKey) as
      | {
          dateKey: string;
          weightKg: number | null;
          maintenanceCalories: number | null;
          surplusCalories: number | null;
          targetCalories: number | null;
          targetProteinGrams: number | null;
          targetCarbsGrams: number | null;
          targetFatGrams: number | null;
          proteinGramsPerLb: number | null;
          fatGramsPerLb: number | null;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      date: row.dateKey,
      ...(typeof row.weightKg === "number" ? { weightKg: this.clampNutritionMetric(row.weightKg, 0, 500) } : {}),
      ...(typeof row.maintenanceCalories === "number"
        ? { maintenanceCalories: this.clampNutritionMetric(row.maintenanceCalories, 0, 10000) }
        : {}),
      ...(typeof row.surplusCalories === "number"
        ? { surplusCalories: this.clampSignedNutritionMetric(row.surplusCalories, 0, -5000, 5000) }
        : {}),
      ...(typeof row.targetCalories === "number"
        ? { targetCalories: this.clampNutritionMetric(row.targetCalories, 0, 15000, 6) }
        : {}),
      ...(typeof row.targetProteinGrams === "number"
        ? { targetProteinGrams: this.clampNutritionMetric(row.targetProteinGrams, 0, 1000, 6) }
        : {}),
      ...(typeof row.targetCarbsGrams === "number"
        ? { targetCarbsGrams: this.clampNutritionMetric(row.targetCarbsGrams, 0, 1500, 6) }
        : {}),
      ...(typeof row.targetFatGrams === "number"
        ? { targetFatGrams: this.clampNutritionMetric(row.targetFatGrams, 0, 600, 6) }
        : {}),
      ...(typeof row.proteinGramsPerLb === "number"
        ? { proteinGramsPerLb: this.clampNutritionMetric(row.proteinGramsPerLb, 0, 2, 6) }
        : {}),
      ...(typeof row.fatGramsPerLb === "number"
        ? { fatGramsPerLb: this.clampNutritionMetric(row.fatGramsPerLb, 0, 2, 6) }
        : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  upsertNutritionTargetProfile(entry: {
    date?: string | Date;
    weightKg?: number | null;
    maintenanceCalories?: number | null;
    surplusCalories?: number | null;
    targetCalories?: number | null;
    targetProteinGrams?: number | null;
    targetCarbsGrams?: number | null;
    targetFatGrams?: number | null;
    proteinGramsPerLb?: number | null;
    fatGramsPerLb?: number | null;
  }): NutritionTargetProfile {
    const dateKey = this.toDateKey(entry.date ?? new Date());
    const existing = this.getNutritionTargetProfile(dateKey);
    const now = nowIso();

    const has = (field: string): boolean => Object.prototype.hasOwnProperty.call(entry, field);

    let weightKg = has("weightKg")
      ? this.toOptionalMetric(entry.weightKg, 500)
      : existing?.weightKg ?? null;
    let maintenanceCalories = has("maintenanceCalories")
      ? this.toOptionalMetric(entry.maintenanceCalories, 10000)
      : existing?.maintenanceCalories ?? null;
    let surplusCalories = has("surplusCalories")
      ? this.toOptionalSignedMetric(entry.surplusCalories, -5000, 5000)
      : existing?.surplusCalories ?? null;
    let targetCalories = has("targetCalories")
      ? this.toOptionalMetric(entry.targetCalories, 15000, 6)
      : existing?.targetCalories ?? null;
    let targetProteinGrams = has("targetProteinGrams")
      ? this.toOptionalMetric(entry.targetProteinGrams, 1000, 6)
      : existing?.targetProteinGrams ?? null;
    let targetCarbsGrams = has("targetCarbsGrams")
      ? this.toOptionalMetric(entry.targetCarbsGrams, 1500, 6)
      : existing?.targetCarbsGrams ?? null;
    let targetFatGrams = has("targetFatGrams")
      ? this.toOptionalMetric(entry.targetFatGrams, 600, 6)
      : existing?.targetFatGrams ?? null;
    const proteinGramsPerLb = has("proteinGramsPerLb")
      ? this.toOptionalMetric(entry.proteinGramsPerLb, 2, 6)
      : existing?.proteinGramsPerLb ?? null;
    const fatGramsPerLb = has("fatGramsPerLb")
      ? this.toOptionalMetric(entry.fatGramsPerLb, 2, 6)
      : existing?.fatGramsPerLb ?? null;

    const settingsChanged = has("weightKg") || has("maintenanceCalories") || has("surplusCalories");
    const targetsChanged = has("targetCalories") || has("targetProteinGrams") || has("targetCarbsGrams") || has("targetFatGrams");

    const derived = this.deriveNutritionTargetsFromSettings({
      weightKg,
      maintenanceCalories,
      surplusCalories,
      proteinGramsPerLb,
      fatGramsPerLb
    });

    if (derived) {
      if (settingsChanged && !targetsChanged) {
        targetCalories = derived.targetCalories;
        targetProteinGrams = derived.targetProteinGrams;
        targetCarbsGrams = derived.targetCarbsGrams;
        targetFatGrams = derived.targetFatGrams;
      } else {
        targetCalories = targetCalories ?? derived.targetCalories;
        targetProteinGrams = targetProteinGrams ?? derived.targetProteinGrams;
        targetCarbsGrams = targetCarbsGrams ?? derived.targetCarbsGrams;
        targetFatGrams = targetFatGrams ?? derived.targetFatGrams;
      }
    }

    if (existing) {
      this.db
        .prepare(
          `UPDATE nutrition_target_profiles SET
            weightKg = ?,
            maintenanceCalories = ?,
            surplusCalories = ?,
            targetCalories = ?,
            targetProteinGrams = ?,
            targetCarbsGrams = ?,
            targetFatGrams = ?,
            proteinGramsPerLb = ?,
            fatGramsPerLb = ?,
            updatedAt = ?
           WHERE dateKey = ?`
        )
        .run(
          weightKg,
          maintenanceCalories,
          surplusCalories,
          targetCalories,
          targetProteinGrams,
          targetCarbsGrams,
          targetFatGrams,
          proteinGramsPerLb,
          fatGramsPerLb,
          now,
          dateKey
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO nutrition_target_profiles (
            dateKey,
            weightKg,
            maintenanceCalories,
            surplusCalories,
            targetCalories,
            targetProteinGrams,
            targetCarbsGrams,
            targetFatGrams,
            proteinGramsPerLb,
            fatGramsPerLb,
            createdAt,
            updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          dateKey,
          weightKg,
          maintenanceCalories,
          surplusCalories,
          targetCalories,
          targetProteinGrams,
          targetCarbsGrams,
          targetFatGrams,
          proteinGramsPerLb,
          fatGramsPerLb,
          now,
          now
        );
      this.trimNutritionTargetProfiles();
    }

    return this.getNutritionTargetProfile(dateKey) ?? {
      date: dateKey,
      ...(typeof weightKg === "number" ? { weightKg } : {}),
      ...(typeof maintenanceCalories === "number" ? { maintenanceCalories } : {}),
      ...(typeof surplusCalories === "number" ? { surplusCalories } : {}),
      ...(typeof targetCalories === "number" ? { targetCalories } : {}),
      ...(typeof targetProteinGrams === "number" ? { targetProteinGrams } : {}),
      ...(typeof targetCarbsGrams === "number" ? { targetCarbsGrams } : {}),
      ...(typeof targetFatGrams === "number" ? { targetFatGrams } : {}),
      ...(typeof proteinGramsPerLb === "number" ? { proteinGramsPerLb } : {}),
      ...(typeof fatGramsPerLb === "number" ? { fatGramsPerLb } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
  }

  getNutritionPlanSettings(): NutritionPlanSettings {
    const row = this.db.prepare("SELECT defaultSnapshotId, updatedAt FROM nutrition_plan_settings WHERE id = 1").get() as
      | {
          defaultSnapshotId: string | null;
          updatedAt: string | null;
        }
      | undefined;

    if (!row || !row.defaultSnapshotId) {
      return {
        defaultSnapshotId: null,
        defaultSnapshotName: null,
        updatedAt: row?.updatedAt ?? null
      };
    }

    const snapshot = this.getNutritionPlanSnapshotById(row.defaultSnapshotId);
    if (!snapshot) {
      this.db.prepare("UPDATE nutrition_plan_settings SET defaultSnapshotId = NULL, updatedAt = ? WHERE id = 1").run(nowIso());
      return {
        defaultSnapshotId: null,
        defaultSnapshotName: null,
        updatedAt: null
      };
    }

    return {
      defaultSnapshotId: snapshot.id,
      defaultSnapshotName: snapshot.name,
      updatedAt: row.updatedAt ?? null
    };
  }

  setNutritionDefaultPlanSnapshot(snapshotId: string | null): NutritionPlanSettings | null {
    const nextId = typeof snapshotId === "string" && snapshotId.trim().length > 0 ? snapshotId.trim() : null;
    if (nextId) {
      const snapshot = this.getNutritionPlanSnapshotById(nextId);
      if (!snapshot) {
        return null;
      }
    }

    const updatedAt = nowIso();
    this.db
      .prepare("UPDATE nutrition_plan_settings SET defaultSnapshotId = ?, updatedAt = ? WHERE id = 1")
      .run(nextId, updatedAt);

    return this.getNutritionPlanSettings();
  }

  ensureNutritionBaselineForDate(date: string | Date = new Date()): {
    applied: boolean;
    date: string;
    snapshotId: string | null;
  } {
    const dateKey = this.toDateKey(date);
    const todayKey = this.toDateKey(new Date());
    if (dateKey < todayKey) {
      return { applied: false, date: dateKey, snapshotId: null };
    }

    const settings = this.getNutritionPlanSettings();
    if (!settings.defaultSnapshotId) {
      return { applied: false, date: dateKey, snapshotId: null };
    }

    const existingMeals = this.getNutritionMeals({ date: dateKey, limit: 1, skipBaselineHydration: true });
    if (existingMeals.length > 0) {
      return { applied: false, date: dateKey, snapshotId: settings.defaultSnapshotId };
    }

    const applied = this.applyNutritionPlanSnapshot(settings.defaultSnapshotId, {
      date: dateKey,
      replaceMeals: false,
      setAsDefault: false
    });
    return {
      applied: Boolean(applied),
      date: dateKey,
      snapshotId: settings.defaultSnapshotId
    };
  }

  getNutritionDailySummary(date: string | Date = new Date()): NutritionDailySummary {
    const dateKey = this.toDateKey(date);
    this.ensureNutritionBaselineForDate(dateKey);
    const meals = this.getNutritionMeals({ date: dateKey, limit: 1000, skipBaselineHydration: true });
    const targetProfile = this.getNutritionTargetProfile(dateKey);

    const totals = meals.reduce(
      (acc, meal) => {
        if (meal.items.length > 0) {
          for (const item of meal.items) {
            acc.calories += item.caloriesPerUnit * item.quantity;
            acc.proteinGrams += item.proteinGramsPerUnit * item.quantity;
            acc.carbsGrams += item.carbsGramsPerUnit * item.quantity;
            acc.fatGrams += item.fatGramsPerUnit * item.quantity;
          }
        } else {
          acc.calories += meal.calories;
          acc.proteinGrams += meal.proteinGrams;
          acc.carbsGrams += meal.carbsGrams;
          acc.fatGrams += meal.fatGrams;
        }
        return acc;
      },
      {
        calories: 0,
        proteinGrams: 0,
        carbsGrams: 0,
        fatGrams: 0
      }
    );

    return {
      date: dateKey,
      totals: {
        calories: this.clampNutritionMetric(totals.calories, 0, 50000),
        proteinGrams: this.clampNutritionMetric(totals.proteinGrams, 0, 10000),
        carbsGrams: this.clampNutritionMetric(totals.carbsGrams, 0, 10000),
        fatGrams: this.clampNutritionMetric(totals.fatGrams, 0, 6000)
      },
      targetProfile,
      remainingToTarget:
        targetProfile &&
        typeof targetProfile.targetCalories === "number" &&
        typeof targetProfile.targetProteinGrams === "number" &&
        typeof targetProfile.targetCarbsGrams === "number" &&
        typeof targetProfile.targetFatGrams === "number"
          ? {
              calories: Math.round((targetProfile.targetCalories - totals.calories) * 10) / 10,
              proteinGrams: Math.round((targetProfile.targetProteinGrams - totals.proteinGrams) * 10) / 10,
              carbsGrams: Math.round((targetProfile.targetCarbsGrams - totals.carbsGrams) * 10) / 10,
              fatGrams: Math.round((targetProfile.targetFatGrams - totals.fatGrams) * 10) / 10
            }
          : null,
      mealsLogged: meals.length,
      meals
    };
  }

  getNutritionDailyHistory(from: string | Date, to: string | Date): NutritionDayHistoryEntry[] {
    const fromKey = this.toDateKey(from);
    const toKey = this.toDateKey(to);

    // Get all weight entries for the range (includes body comp)
    const withingsData = this.getWithingsData();
    const weightByDate = new Map<string, number>();
    const fatByDate = new Map<string, number>();
    const muscleByDate = new Map<string, number>();
    for (const w of withingsData.weight) {
      const wDate = this.toDateKey(w.measuredAt);
      if (wDate >= fromKey && wDate <= toKey) {
        weightByDate.set(wDate, w.weightKg);
        if (w.fatRatioPercent != null) fatByDate.set(wDate, w.fatRatioPercent);
        if (w.muscleMassKg != null) muscleByDate.set(wDate, w.muscleMassKg);
      }
    }

    // Get gym habit check-in dates
    const gymDates = this.getGymCheckInDates(fromKey, toKey);

    const entries: NutritionDayHistoryEntry[] = [];
    const cursor = new Date(fromKey + "T00:00:00Z");
    const end = new Date(toKey + "T00:00:00Z");

    while (cursor <= end) {
      const dateKey = this.toDateKey(cursor);
      const meals = this.getNutritionMeals({ date: dateKey, limit: 1000, skipBaselineHydration: true });
      const targetProfile = this.getNutritionTargetProfile(dateKey);

      const totals = meals.reduce(
        (acc, meal) => {
          if (meal.items.length > 0) {
            for (const item of meal.items) {
              acc.calories += item.caloriesPerUnit * item.quantity;
              acc.proteinGrams += item.proteinGramsPerUnit * item.quantity;
              acc.carbsGrams += item.carbsGramsPerUnit * item.quantity;
              acc.fatGrams += item.fatGramsPerUnit * item.quantity;
            }
          } else {
            acc.calories += meal.calories;
            acc.proteinGrams += meal.proteinGrams;
            acc.carbsGrams += meal.carbsGrams;
            acc.fatGrams += meal.fatGrams;
          }
          return acc;
        },
        { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 }
      );

      entries.push({
        date: dateKey,
        totals: {
          calories: this.clampNutritionMetric(totals.calories, 0, 50000),
          proteinGrams: this.clampNutritionMetric(totals.proteinGrams, 0, 10000),
          carbsGrams: this.clampNutritionMetric(totals.carbsGrams, 0, 10000),
          fatGrams: this.clampNutritionMetric(totals.fatGrams, 0, 6000)
        },
        targets: targetProfile && typeof targetProfile.targetCalories === "number"
          ? {
              calories: targetProfile.targetCalories,
              proteinGrams: targetProfile.targetProteinGrams!,
              carbsGrams: targetProfile.targetCarbsGrams!,
              fatGrams: targetProfile.targetFatGrams!
            }
          : null,
        mealsLogged: meals.length,
        weightKg: weightByDate.get(dateKey) ?? null,
        fatRatioPercent: fatByDate.get(dateKey) ?? null,
        muscleMassKg: muscleByDate.get(dateKey) ?? null,
        gymCheckedIn: gymDates.has(dateKey)
      });

      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return entries;
  }

  getNutritionPlanSnapshotById(id: string): NutritionPlanSnapshot | null {
    const row = this.db.prepare("SELECT * FROM nutrition_plan_snapshots WHERE id = ?").get(id) as
      | {
          id: string;
          name: string;
          sourceDate: string;
          targetProfileJson: string | null;
          mealsJson: string | null;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      sourceDate: row.sourceDate,
      targetProfile: this.parseNutritionPlanSnapshotTargetJson(row.targetProfileJson),
      meals: this.parseNutritionPlanSnapshotMealsJson(row.mealsJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  getNutritionPlanSnapshots(options: {
    query?: string;
    limit?: number;
  } = {}): NutritionPlanSnapshot[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (typeof options.query === "string" && options.query.trim().length > 0) {
      clauses.push("name LIKE ? COLLATE NOCASE");
      params.push(`%${options.query.trim()}%`);
    }

    let query = "SELECT * FROM nutrition_plan_snapshots";
    if (clauses.length > 0) {
      query += ` WHERE ${clauses.join(" AND ")}`;
    }
    query += " ORDER BY updatedAt DESC, insertOrder DESC";

    const limit = typeof options.limit === "number" ? Math.min(Math.max(Math.round(options.limit), 1), 1000) : null;
    if (limit !== null) {
      query += " LIMIT ?";
      params.push(limit);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string;
      name: string;
      sourceDate: string;
      targetProfileJson: string | null;
      mealsJson: string | null;
      createdAt: string;
      updatedAt: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sourceDate: row.sourceDate,
      targetProfile: this.parseNutritionPlanSnapshotTargetJson(row.targetProfileJson),
      meals: this.parseNutritionPlanSnapshotMealsJson(row.mealsJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  createNutritionPlanSnapshot(entry: {
    name: string;
    date?: string | Date;
    replaceId?: string;
    targetProfile?: NutritionPlanSnapshotTarget | null;
    meals?: NutritionPlanSnapshotMeal[];
    allowEmptyMeals?: boolean;
  }): NutritionPlanSnapshot | null {
    const name = entry.name.trim();
    if (!name) {
      return null;
    }

    const sourceDate = this.toDateKey(entry.date ?? new Date());
    const targetProfile =
      entry.targetProfile !== undefined
        ? this.normalizeNutritionPlanSnapshotTarget(entry.targetProfile)
        : this.normalizeNutritionPlanSnapshotTarget(this.getNutritionTargetProfile(sourceDate));
    const meals =
      entry.meals !== undefined
        ? this.normalizeNutritionPlanSnapshotMeals(entry.meals)
        : this.getNutritionMeals({ date: sourceDate, limit: 1000 }).map((meal) => ({
            name: meal.name,
            mealType: this.normalizeNutritionMealType(meal.mealType),
            consumedTime: this.toNutritionConsumedTime(meal.consumedAt),
            items: meal.items.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              unitLabel: item.unitLabel,
              caloriesPerUnit: item.caloriesPerUnit,
              proteinGramsPerUnit: item.proteinGramsPerUnit,
              carbsGramsPerUnit: item.carbsGramsPerUnit,
              fatGramsPerUnit: item.fatGramsPerUnit,
              ...(item.customFoodId ? { customFoodId: item.customFoodId } : {})
            })),
            ...(meal.items.length === 0
              ? {
                  calories: meal.calories,
                  proteinGrams: meal.proteinGrams,
                  carbsGrams: meal.carbsGrams,
                  fatGrams: meal.fatGrams
                }
              : {}),
            ...(this.stripNutritionMealDoneToken(meal.notes) ? { notes: this.stripNutritionMealDoneToken(meal.notes) } : {})
              }));
    const allowEmptyMeals = entry.allowEmptyMeals === true;
    if (!allowEmptyMeals && meals.length === 0) {
      return null;
    }

    const now = nowIso();
    const replaceId = typeof entry.replaceId === "string" && entry.replaceId.trim().length > 0 ? entry.replaceId.trim() : null;
    if (replaceId) {
      const existing = this.getNutritionPlanSnapshotById(replaceId);
      if (existing) {
        this.db
          .prepare(
            `UPDATE nutrition_plan_snapshots
             SET name = ?, sourceDate = ?, targetProfileJson = ?, mealsJson = ?, updatedAt = ?
             WHERE id = ?`
          )
          .run(
            name,
            sourceDate,
            JSON.stringify(targetProfile ?? {}),
            JSON.stringify(meals),
            now,
            replaceId
          );
        return this.getNutritionPlanSnapshotById(replaceId);
      }
    }

    const snapshot: NutritionPlanSnapshot = {
      id: makeId("nutrition-plan"),
      name,
      sourceDate,
      targetProfile,
      meals,
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(
        `INSERT INTO nutrition_plan_snapshots (
          id, name, sourceDate, targetProfileJson, mealsJson, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        snapshot.id,
        snapshot.name,
        snapshot.sourceDate,
        JSON.stringify(snapshot.targetProfile ?? {}),
        JSON.stringify(snapshot.meals),
        snapshot.createdAt,
        snapshot.updatedAt
      );

    this.trimNutritionPlanSnapshots();
    return snapshot;
  }

  applyNutritionPlanSnapshot(
    snapshotId: string,
    options: {
      date?: string | Date;
      replaceMeals?: boolean;
      setAsDefault?: boolean;
    } = {}
  ): {
    snapshot: NutritionPlanSnapshot;
    appliedDate: string;
    mealsCreated: NutritionMeal[];
    targetProfile: NutritionTargetProfile | null;
  } | null {
    const snapshot = this.getNutritionPlanSnapshotById(snapshotId);
    if (!snapshot) {
      return null;
    }

    const appliedDate = this.toDateKey(options.date ?? new Date());
    const replaceMeals = options.replaceMeals !== false;
    if (replaceMeals) {
      const existingMeals = this.getNutritionMeals({ date: appliedDate, limit: 1000 });
      existingMeals.forEach((meal) => {
        this.deleteNutritionMeal(meal.id);
      });
    }

    const mealsCreated: NutritionMeal[] = [];
    snapshot.meals.forEach((meal, index) => {
      const sanitizedNotes = this.stripNutritionMealDoneToken(meal.notes);
      const created = this.createNutritionMeal({
        name: meal.name,
        mealType: meal.mealType,
        consumedAt: this.toNutritionConsumedAtForDate(appliedDate, meal.consumedTime, index),
        items: meal.items,
        ...(meal.items.length === 0
          ? {
              calories: typeof meal.calories === "number" ? meal.calories : 0,
              proteinGrams: typeof meal.proteinGrams === "number" ? meal.proteinGrams : 0,
              carbsGrams: typeof meal.carbsGrams === "number" ? meal.carbsGrams : 0,
              fatGrams: typeof meal.fatGrams === "number" ? meal.fatGrams : 0
            }
          : {}),
        ...(sanitizedNotes ? { notes: sanitizedNotes } : {})
      });
      mealsCreated.push(created);
    });

    const targetProfile = snapshot.targetProfile
      ? this.upsertNutritionTargetProfile({
          date: appliedDate,
          ...snapshot.targetProfile
        })
      : this.getNutritionTargetProfile(appliedDate);

    if (options.setAsDefault !== false) {
      this.setNutritionDefaultPlanSnapshot(snapshot.id);
    }

    return {
      snapshot,
      appliedDate,
      mealsCreated,
      targetProfile
    };
  }

  deleteNutritionPlanSnapshot(id: string): boolean {
    const settings = this.getNutritionPlanSettings();
    const result = this.db.prepare("DELETE FROM nutrition_plan_snapshots WHERE id = ?").run(id);
    if (result.changes > 0 && settings.defaultSnapshotId === id) {
      this.setNutritionDefaultPlanSnapshot(null);
    }
    return result.changes > 0;
  }

  upsertStudyPlanSessions(
    sessions: StudyPlanSession[],
    generatedAt: string,
    options?: {
      windowStart?: string;
      windowEnd?: string;
    }
  ): void {
    const transaction = this.db.transaction(() => {
      if (options?.windowStart && options?.windowEnd) {
        this.db
          .prepare(
            `DELETE FROM study_plan_sessions
             WHERE status = 'pending'
               AND startTime >= ?
               AND startTime <= ?`
          )
          .run(options.windowStart, options.windowEnd);
      }

      const upsert = this.db.prepare(
        `INSERT INTO study_plan_sessions (
          sessionId,
          deadlineId,
          course,
          task,
          priority,
          startTime,
          endTime,
          durationMinutes,
          score,
          rationale,
          generatedAt,
          status,
          checkedAt,
          energyLevel,
          focusLevel,
          checkInNote
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL)
        ON CONFLICT(sessionId) DO UPDATE SET
          deadlineId = excluded.deadlineId,
          course = excluded.course,
          task = excluded.task,
          priority = excluded.priority,
          startTime = excluded.startTime,
          endTime = excluded.endTime,
          durationMinutes = excluded.durationMinutes,
          score = excluded.score,
          rationale = excluded.rationale,
          generatedAt = excluded.generatedAt`
      );

      for (const session of sessions) {
        upsert.run(
          session.id,
          session.deadlineId,
          session.course,
          session.task,
          session.priority,
          session.startTime,
          session.endTime,
          session.durationMinutes,
          session.score,
          session.rationale,
          generatedAt
        );
      }
    });

    transaction();
    this.trimStudyPlanSessions();
  }

  getStudyPlanSessionById(sessionId: string): StudyPlanSessionRecord | null {
    const row = this.db
      .prepare("SELECT * FROM study_plan_sessions WHERE sessionId = ?")
      .get(sessionId) as
      | {
          sessionId: string;
          deadlineId: string;
          course: string;
          task: string;
          priority: string;
          startTime: string;
          endTime: string;
          durationMinutes: number;
          score: number;
          rationale: string;
          generatedAt: string;
          status: string;
          checkedAt: string | null;
          energyLevel: number | null;
          focusLevel: number | null;
          checkInNote: string | null;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.sessionId,
      deadlineId: row.deadlineId,
      course: row.course,
      task: row.task,
      priority: row.priority as StudyPlanSession["priority"],
      startTime: row.startTime,
      endTime: row.endTime,
      durationMinutes: row.durationMinutes,
      score: row.score,
      rationale: row.rationale,
      generatedAt: row.generatedAt,
      status: row.status as StudyPlanSessionStatus,
      checkedAt: row.checkedAt,
      energyLevel: row.energyLevel,
      focusLevel: row.focusLevel,
      checkInNote: row.checkInNote
    };
  }

  getStudyPlanSessions(options?: {
    windowStart?: string;
    windowEnd?: string;
    status?: StudyPlanSessionStatus;
    limit?: number;
  }): StudyPlanSessionRecord[] {
    let query = "SELECT * FROM study_plan_sessions WHERE 1=1";
    const params: unknown[] = [];

    if (options?.windowStart) {
      query += " AND startTime >= ?";
      params.push(options.windowStart);
    }

    if (options?.windowEnd) {
      query += " AND startTime <= ?";
      params.push(options.windowEnd);
    }

    if (options?.status) {
      query += " AND status = ?";
      params.push(options.status);
    }

    query += " ORDER BY startTime ASC";

    if (options?.limit) {
      query += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{
      sessionId: string;
      deadlineId: string;
      course: string;
      task: string;
      priority: string;
      startTime: string;
      endTime: string;
      durationMinutes: number;
      score: number;
      rationale: string;
      generatedAt: string;
      status: string;
      checkedAt: string | null;
      energyLevel: number | null;
      focusLevel: number | null;
      checkInNote: string | null;
    }>;

    return rows.map((row) => ({
      id: row.sessionId,
      deadlineId: row.deadlineId,
      course: row.course,
      task: row.task,
      priority: row.priority as StudyPlanSession["priority"],
      startTime: row.startTime,
      endTime: row.endTime,
      durationMinutes: row.durationMinutes,
      score: row.score,
      rationale: row.rationale,
      generatedAt: row.generatedAt,
      status: row.status as StudyPlanSessionStatus,
      checkedAt: row.checkedAt,
      energyLevel: row.energyLevel,
      focusLevel: row.focusLevel,
      checkInNote: row.checkInNote
    }));
  }

  setStudyPlanSessionStatus(
    sessionId: string,
    status: Exclude<StudyPlanSessionStatus, "pending">,
    checkedAt: string = nowIso(),
    checkIn?: {
      energyLevel?: number;
      focusLevel?: number;
      checkInNote?: string;
    }
  ): StudyPlanSessionRecord | null {
    const existing = this.getStudyPlanSessionById(sessionId);
    if (!existing) {
      return null;
    }

    const nextEnergyLevel = checkIn?.energyLevel ?? existing.energyLevel;
    const nextFocusLevel = checkIn?.focusLevel ?? existing.focusLevel;
    const nextCheckInNote = checkIn?.checkInNote ?? existing.checkInNote;

    const result = this.db
      .prepare(
        "UPDATE study_plan_sessions SET status = ?, checkedAt = ?, energyLevel = ?, focusLevel = ?, checkInNote = ? WHERE sessionId = ?"
      )
      .run(status, checkedAt, nextEnergyLevel, nextFocusLevel, nextCheckInNote, sessionId);

    if (result.changes === 0) {
      return null;
    }

    return this.getStudyPlanSessionById(sessionId);
  }

  getStudyPlanAdherenceMetrics(options?: {
    windowStart?: string;
    windowEnd?: string;
  }): StudyPlanAdherenceMetrics {
    const defaultEnd = new Date();
    const defaultStart = new Date(defaultEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

    const parsedStart = options?.windowStart ? new Date(options.windowStart) : defaultStart;
    const parsedEnd = options?.windowEnd ? new Date(options.windowEnd) : defaultEnd;

    const start = Number.isNaN(parsedStart.getTime()) ? defaultStart : parsedStart;
    const end = Number.isNaN(parsedEnd.getTime()) ? defaultEnd : parsedEnd;
    const normalizedStart = start.getTime() <= end.getTime() ? start : end;
    const normalizedEnd = start.getTime() <= end.getTime() ? end : start;

    const sessions = this.getStudyPlanSessions({
      windowStart: normalizedStart.toISOString(),
      windowEnd: normalizedEnd.toISOString()
    });

    const sessionsPlanned = sessions.length;
    const sessionsDone = sessions.filter((session) => session.status === "done").length;
    const sessionsSkipped = sessions.filter((session) => session.status === "skipped").length;
    const sessionsPending = sessions.filter((session) => session.status === "pending").length;

    const totalPlannedMinutes = sessions.reduce((total, session) => total + session.durationMinutes, 0);
    const completedMinutes = sessions
      .filter((session) => session.status === "done")
      .reduce((total, session) => total + session.durationMinutes, 0);
    const skippedMinutes = sessions
      .filter((session) => session.status === "skipped")
      .reduce((total, session) => total + session.durationMinutes, 0);
    const pendingMinutes = sessions
      .filter((session) => session.status === "pending")
      .reduce((total, session) => total + session.durationMinutes, 0);

    const trackedSessions = sessionsDone + sessionsSkipped;
    const completionRate = sessionsPlanned === 0 ? 0 : Math.round((sessionsDone / sessionsPlanned) * 100);
    const adherenceRate = trackedSessions === 0 ? 0 : Math.round((sessionsDone / trackedSessions) * 100);
    const checkedSessions = sessions.filter((session) => session.status !== "pending");
    const energyValues = checkedSessions
      .map((session) => session.energyLevel)
      .filter((value): value is number => typeof value === "number");
    const focusValues = checkedSessions
      .map((session) => session.focusLevel)
      .filter((value): value is number => typeof value === "number");
    const averageEnergy =
      energyValues.length === 0
        ? null
        : Math.round((energyValues.reduce((sum, value) => sum + value, 0) / energyValues.length) * 10) / 10;
    const averageFocus =
      focusValues.length === 0
        ? null
        : Math.round((focusValues.reduce((sum, value) => sum + value, 0) / focusValues.length) * 10) / 10;
    const sessionsWithNotes = checkedSessions.filter(
      (session) => typeof session.checkInNote === "string" && session.checkInNote.trim().length > 0
    );
    const recentNotes = [...sessionsWithNotes]
      .filter((session): session is StudyPlanSessionRecord & { checkedAt: string } => typeof session.checkedAt === "string")
      .sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime())
      .slice(0, 5)
      .map((session) => ({
        sessionId: session.id,
        course: session.course,
        task: session.task,
        status: session.status as Exclude<StudyPlanSessionStatus, "pending">,
        checkedAt: session.checkedAt,
        note: session.checkInNote ?? ""
      }));

    return {
      windowStart: normalizedStart.toISOString(),
      windowEnd: normalizedEnd.toISOString(),
      sessionsPlanned,
      sessionsDone,
      sessionsSkipped,
      sessionsPending,
      completionRate,
      adherenceRate,
      totalPlannedMinutes,
      completedMinutes,
      skippedMinutes,
      pendingMinutes,
      checkInTrends: {
        sessionsChecked: checkedSessions.length,
        sessionsWithEnergy: energyValues.length,
        sessionsWithFocus: focusValues.length,
        sessionsWithNotes: sessionsWithNotes.length,
        averageEnergy,
        averageFocus,
        lowEnergyCount: energyValues.filter((value) => value <= 2).length,
        highEnergyCount: energyValues.filter((value) => value >= 4).length,
        lowFocusCount: focusValues.filter((value) => value <= 2).length,
        highFocusCount: focusValues.filter((value) => value >= 4).length,
        recentNotes
      }
    };
  }

  getOverdueDeadlinesRequiringReminder(referenceDate: string = nowIso(), cooldownMinutes = 180): Deadline[] {
    const reference = new Date(referenceDate);
    const nowMs = reference.getTime();

    if (Number.isNaN(nowMs)) {
      return [];
    }

    const cooldownMs = Math.max(0, cooldownMinutes) * 60_000;

    const deadlines = this.getAcademicDeadlines(reference);

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
    const deadlines = this.getAcademicDeadlines();
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
        growthStreak: 0
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
          const normalizedDeadline = this.normalizeDeadlineEffort(deadline);
          const existing = this.db.prepare("SELECT id FROM deadlines WHERE id = ?").get(deadline.id);

          if (existing) {
            // Update existing deadline
            this.db
              .prepare(
                `UPDATE deadlines SET
                  course = ?, task = ?, dueDate = ?, sourceDueDate = ?, priority = ?, completed = ?,
                  canvasAssignmentId = ?, effortHoursRemaining = ?, effortConfidence = ?
                 WHERE id = ?`
              )
              .run(
                normalizedDeadline.course,
                normalizedDeadline.task,
                normalizedDeadline.dueDate,
                normalizedDeadline.sourceDueDate ?? null,
                normalizedDeadline.priority,
                normalizedDeadline.completed ? 1 : 0,
                normalizedDeadline.canvasAssignmentId ?? null,
                normalizedDeadline.effortHoursRemaining ?? null,
                normalizedDeadline.effortConfidence ?? null,
                normalizedDeadline.id
              );
          } else {
            // Insert new deadline
            this.db
              .prepare(
                `INSERT INTO deadlines (
                  id, course, task, dueDate, sourceDueDate, priority, completed, canvasAssignmentId, effortHoursRemaining, effortConfidence
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                normalizedDeadline.id,
                normalizedDeadline.course,
                normalizedDeadline.task,
                normalizedDeadline.dueDate,
                normalizedDeadline.sourceDueDate ?? null,
                normalizedDeadline.priority,
                normalizedDeadline.completed ? 1 : 0,
                normalizedDeadline.canvasAssignmentId ?? null,
                normalizedDeadline.effortHoursRemaining ?? null,
                normalizedDeadline.effortConfidence ?? null
              );
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

  private computeStreak(checkIns: Array<{ date: string; completed: boolean }>, referenceDateKey: string): { streak: number; graceUsed: boolean } {
    const completedDates = new Set(checkIns.filter((c) => c.completed).map((c) => this.toDateKey(c.date)));
    let streak = 0;
    let graceUsed = false;
    const cursor = new Date(`${referenceDateKey}T00:00:00.000Z`);

    while (true) {
      const key = this.toDateKey(cursor);
      if (completedDates.has(key)) {
        streak += 1;
      } else if (!graceUsed && streak > 0) {
        // Grace: skip one missed day, but only if the day BEFORE it was completed
        // (bridges a single gap, doesn't extend past the last real check-in)
        const peek = new Date(cursor);
        peek.setUTCDate(peek.getUTCDate() - 1);
        if (completedDates.has(this.toDateKey(peek))) {
          graceUsed = true;
          // don't increment streak — just skip this gap day
        } else {
          break;
        }
      } else {
        break;
      }
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    return { streak, graceUsed };
  }

  private trimNutritionMeals(): void {
    const count = (this.db.prepare("SELECT COUNT(*) as count FROM nutrition_meals").get() as { count: number }).count;
    if (count <= this.maxNutritionMeals) {
      return;
    }

    this.db
      .prepare(
        `DELETE FROM nutrition_meals WHERE id IN (
          SELECT id FROM nutrition_meals ORDER BY insertOrder ASC LIMIT ?
        )`
      )
      .run(count - this.maxNutritionMeals);
  }

  private trimNutritionCustomFoods(): void {
    const count = (
      this.db.prepare("SELECT COUNT(*) as count FROM nutrition_custom_foods").get() as { count: number }
    ).count;
    if (count <= this.maxNutritionCustomFoods) {
      return;
    }

    this.db
      .prepare(
        `DELETE FROM nutrition_custom_foods WHERE id IN (
          SELECT id FROM nutrition_custom_foods ORDER BY insertOrder ASC LIMIT ?
        )`
      )
      .run(count - this.maxNutritionCustomFoods);
  }

  private trimNutritionTargetProfiles(): void {
    const count = (
      this.db.prepare("SELECT COUNT(*) as count FROM nutrition_target_profiles").get() as { count: number }
    ).count;
    if (count <= this.maxNutritionTargetProfiles) {
      return;
    }

    this.db
      .prepare(
        `DELETE FROM nutrition_target_profiles WHERE dateKey IN (
          SELECT dateKey FROM nutrition_target_profiles ORDER BY updatedAt ASC LIMIT ?
        )`
      )
      .run(count - this.maxNutritionTargetProfiles);
  }

  private trimNutritionPlanSnapshots(): void {
    const count = (
      this.db.prepare("SELECT COUNT(*) as count FROM nutrition_plan_snapshots").get() as { count: number }
    ).count;
    if (count <= this.maxNutritionPlanSnapshots) {
      return;
    }

    this.db
      .prepare(
        `DELETE FROM nutrition_plan_snapshots WHERE id IN (
          SELECT id FROM nutrition_plan_snapshots ORDER BY updatedAt ASC, insertOrder ASC LIMIT ?
        )`
      )
      .run(count - this.maxNutritionPlanSnapshots);
  }

  private trimAuthSessions(): void {
    this.deleteExpiredAuthSessions();

    const count = (this.db.prepare("SELECT COUNT(*) as count FROM auth_sessions").get() as { count: number }).count;
    if (count <= this.maxAuthSessions) {
      return;
    }

    this.db
      .prepare(
        `DELETE FROM auth_sessions WHERE id IN (
          SELECT id FROM auth_sessions ORDER BY insertOrder ASC LIMIT ?
        )`
      )
      .run(count - this.maxAuthSessions);
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

  private trimStudyPlanSessions(): void {
    const count = (this.db.prepare("SELECT COUNT(*) as count FROM study_plan_sessions").get() as { count: number }).count;

    if (count <= this.maxStudyPlanSessions) {
      return;
    }

    this.db
      .prepare(
        `DELETE FROM study_plan_sessions WHERE sessionId IN (
          SELECT sessionId FROM study_plan_sessions ORDER BY insertOrder ASC LIMIT ?
        )`
      )
      .run(count - this.maxStudyPlanSessions);
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

  recordIntegrationSyncAttempt(
    attempt: Omit<IntegrationSyncAttempt, "id">
  ): IntegrationSyncAttempt {
    const record: IntegrationSyncAttempt = {
      id: makeId("sync-attempt"),
      ...attempt
    };

    this.db
      .prepare(
        `INSERT INTO integration_sync_attempts (
          id, integration, status, latencyMs, rootCause, errorMessage, attemptedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.integration,
        record.status,
        record.latencyMs,
        record.rootCause,
        record.errorMessage,
        record.attemptedAt
      );

    this.trimIntegrationSyncAttemptsIfNeeded();
    return record;
  }

  getIntegrationSyncAttempts(options: {
    integration?: IntegrationSyncName;
    status?: IntegrationSyncAttemptStatus;
    limit?: number;
    hours?: number;
  } = {}): IntegrationSyncAttempt[] {
    const whereParts: string[] = [];
    const params: Array<string | number> = [];

    if (options.integration) {
      whereParts.push("integration = ?");
      params.push(options.integration);
    }

    if (options.status) {
      whereParts.push("status = ?");
      params.push(options.status);
    }

    if (typeof options.hours === "number" && Number.isFinite(options.hours) && options.hours > 0) {
      const cutoff = new Date(Date.now() - options.hours * 60 * 60 * 1000).toISOString();
      whereParts.push("attemptedAt >= ?");
      params.push(cutoff);
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(options.limit ?? 200, 2000));
    const query = `
      SELECT id, integration, status, latencyMs, rootCause, errorMessage, attemptedAt
      FROM integration_sync_attempts
      ${whereClause}
      ORDER BY attemptedAt DESC
      LIMIT ?
    `;

    const rows = this.db.prepare(query).all(...params, limit) as Array<{
      id: string;
      integration: string;
      status: string;
      latencyMs: number;
      rootCause: string;
      errorMessage: string | null;
      attemptedAt: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      integration: row.integration as IntegrationSyncName,
      status: row.status as IntegrationSyncAttemptStatus,
      latencyMs: row.latencyMs,
      rootCause: row.rootCause as IntegrationSyncRootCause,
      errorMessage: row.errorMessage,
      attemptedAt: row.attemptedAt
    }));
  }

  getIntegrationSyncSummary(windowHours = 24 * 7): IntegrationSyncSummary {
    const attempts = this.getIntegrationSyncAttempts({
      limit: this.maxIntegrationSyncAttempts,
      hours: windowHours
    });

    const totalAttempts = attempts.length;
    const totalSuccesses = attempts.filter((attempt) => attempt.status === "success").length;
    const totalFailures = totalAttempts - totalSuccesses;

    const integrations = integrationNames.map((integration) => {
      const records = attempts.filter((attempt) => attempt.integration === integration);
      const attemptsCount = records.length;
      const successes = records.filter((attempt) => attempt.status === "success").length;
      const failures = attemptsCount - successes;
      const averageLatencyMs =
        attemptsCount > 0
          ? Math.round(records.reduce((sum, attempt) => sum + attempt.latencyMs, 0) / attemptsCount)
          : 0;
      const lastAttemptAt = records[0]?.attemptedAt ?? null;
      const lastSuccessAt = records.find((attempt) => attempt.status === "success")?.attemptedAt ?? null;

      const failuresByRootCause = integrationRootCauses.reduce<Record<IntegrationSyncRootCause, number>>(
        (acc, rootCause) => {
          acc[rootCause] = 0;
          return acc;
        },
        {} as Record<IntegrationSyncRootCause, number>
      );

      records
        .filter((attempt) => attempt.status === "failure")
        .forEach((attempt) => {
          failuresByRootCause[attempt.rootCause] += 1;
        });

      return {
        integration,
        attempts: attemptsCount,
        successes,
        failures,
        successRate: attemptsCount > 0 ? Number(((successes / attemptsCount) * 100).toFixed(1)) : 0,
        averageLatencyMs,
        lastAttemptAt,
        lastSuccessAt,
        failuresByRootCause
      };
    });

    return {
      generatedAt: nowIso(),
      windowHours,
      totals: {
        attempts: totalAttempts,
        successes: totalSuccesses,
        failures: totalFailures,
        successRate: totalAttempts > 0 ? Number(((totalSuccesses / totalAttempts) * 100).toFixed(1)) : 0
      },
      integrations
    };
  }

  private trimIntegrationSyncAttemptsIfNeeded(): void {
    const count = (
      this.db.prepare("SELECT COUNT(*) as count FROM integration_sync_attempts").get() as { count: number }
    ).count;
    if (count <= this.maxIntegrationSyncAttempts) {
      return;
    }

    this.db
      .prepare(
        `DELETE FROM integration_sync_attempts WHERE id IN (
          SELECT id FROM integration_sync_attempts ORDER BY insertOrder ASC LIMIT ?
        )`
      )
      .run(count - this.maxIntegrationSyncAttempts);
  }

  /**
   * Serialize the current SQLite database state.
   * Used for external snapshot persistence (e.g. PostgreSQL-backed backups).
   */
  serializeDatabase(): Buffer {
    return this.db.serialize();
  }

  /**
   * Set Canvas data
   */
  setCanvasData(data: import("./types.js").CanvasData): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO canvas_data (
        id, courses, assignments, modules, announcements, lastSyncedAt
      ) VALUES (1, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      JSON.stringify(data.courses),
      JSON.stringify(data.assignments),
      JSON.stringify(data.modules),
      JSON.stringify(data.announcements),
      data.lastSyncedAt
    );
  }

  /**
   * Get Canvas data
   */
  getCanvasData(): import("./types.js").CanvasData | null {
    const stmt = this.db.prepare(`
      SELECT courses, assignments, modules, announcements, lastSyncedAt
      FROM canvas_data WHERE id = 1
    `);

    const row = stmt.get() as {
      courses: string;
      assignments: string;
      modules: string;
      announcements: string;
      lastSyncedAt: string | null;
    } | undefined;

    if (!row) {
      return null;
    }

    return {
      courses: JSON.parse(row.courses),
      assignments: JSON.parse(row.assignments),
      modules: JSON.parse(row.modules),
      announcements: JSON.parse(row.announcements),
      lastSyncedAt: row.lastSyncedAt
    };
  }

  /**
   * Set GitHub course data
   */
  setGitHubCourseData(data: import("./types.js").GitHubCourseData): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO github_course_data (
        id, repositories, documents, deadlinesSynced, lastSyncedAt
      ) VALUES (1, ?, ?, ?, ?)
    `);

    stmt.run(
      JSON.stringify(data.repositories),
      JSON.stringify(data.documents),
      data.deadlinesSynced,
      data.lastSyncedAt
    );
  }

  /**
   * Get GitHub course data
   */
  getGitHubCourseData(): import("./types.js").GitHubCourseData | null {
    const stmt = this.db.prepare(`
      SELECT repositories, documents, deadlinesSynced, lastSyncedAt
      FROM github_course_data WHERE id = 1
    `);

    const row = stmt.get() as {
      repositories: string;
      documents: string;
      deadlinesSynced: number;
      lastSyncedAt: string | null;
    } | undefined;

    if (!row) {
      return null;
    }

    return {
      repositories: JSON.parse(row.repositories),
      documents: JSON.parse(row.documents),
      deadlinesSynced: row.deadlinesSynced ?? 0,
      lastSyncedAt: row.lastSyncedAt
    };
  }

  /**
   * Set Gmail OAuth tokens
   */
  setGmailTokens(data: {
    refreshToken?: string;
    accessToken?: string;
    email: string;
    connectedAt: string;
    source?: "oauth" | "env" | "unknown";
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO gmail_data (
        id, refreshToken, accessToken, email, connectedAt, tokenSource
      ) VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        refreshToken = excluded.refreshToken,
        accessToken = excluded.accessToken,
        email = excluded.email,
        connectedAt = excluded.connectedAt,
        tokenSource = excluded.tokenSource
    `);

    stmt.run(
      data.refreshToken ?? null,
      data.accessToken ?? null,
      data.email,
      data.connectedAt,
      data.source ?? "oauth"
    );
  }

  /**
   * Get Gmail OAuth tokens
   */
  getGmailTokens(): {
    refreshToken?: string;
    accessToken?: string;
    email: string;
    connectedAt: string;
    source: "oauth" | "env" | "unknown";
  } | null {
    const stmt = this.db.prepare(`
      SELECT refreshToken, accessToken, email, connectedAt, tokenSource
      FROM gmail_data WHERE id = 1
    `);

    const row = stmt.get() as {
      refreshToken: string | null;
      accessToken: string | null;
      email: string | null;
      connectedAt: string | null;
      tokenSource: string | null;
    } | undefined;

    if (!row || (!row.refreshToken && !row.accessToken)) {
      return null;
    }

    // Log warning if required fields are missing
    if (!row.email || !row.connectedAt) {
      console.warn("[store] Gmail tokens missing email or connectedAt fields");
    }

    return {
      ...(row.refreshToken ? { refreshToken: row.refreshToken } : {}),
      ...(row.accessToken ? { accessToken: row.accessToken } : {}),
      email: row.email || "unknown",
      connectedAt: row.connectedAt || new Date().toISOString(),
      source:
        row.tokenSource === "oauth" || row.tokenSource === "env"
          ? row.tokenSource
          : "unknown"
    };
  }

  /**
   * Set Gmail messages
   */
  setGmailMessages(messages: GmailMessage[], lastSyncedAt: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO gmail_data (id, messages, lastSyncedAt)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        messages = excluded.messages,
        lastSyncedAt = excluded.lastSyncedAt
    `);

    stmt.run(JSON.stringify(messages), lastSyncedAt);
  }

  /**
   * Get Gmail messages
   */
  getGmailMessages(): GmailMessage[] {
    const stmt = this.db.prepare(`
      SELECT messages FROM gmail_data WHERE id = 1
    `);

    const row = stmt.get() as { messages: string | null } | undefined;

    if (!row || !row.messages) {
      return [];
    }

    try {
      return JSON.parse(row.messages) as GmailMessage[];
    } catch {
      return [];
    }
  }

  /**
   * Get Gmail data (messages + sync info)
   */
  getGmailData(): { messages: GmailMessage[]; lastSyncedAt: string | null } {
    const stmt = this.db.prepare(`
      SELECT messages, lastSyncedAt FROM gmail_data WHERE id = 1
    `);

    const row = stmt.get() as { messages: string | null; lastSyncedAt: string | null } | undefined;

    if (!row) {
      return { messages: [], lastSyncedAt: null };
    }

    let messages: GmailMessage[] = [];
    if (row.messages) {
      try {
        messages = JSON.parse(row.messages) as GmailMessage[];
      } catch {
        messages = [];
      }
    }

    return { messages, lastSyncedAt: row.lastSyncedAt };
  }

  setWithingsTokens(data: {
    refreshToken?: string;
    accessToken?: string;
    tokenExpiresAt?: string;
    userId?: string;
    scope?: string;
    connectedAt: string;
    source?: "oauth" | "env" | "unknown";
  }): void {
    const existing = this.getWithingsTokens();
    const stmt = this.db.prepare(`
      INSERT INTO withings_data (
        id, refreshToken, accessToken, tokenExpiresAt, userId, scope, connectedAt, tokenSource
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        refreshToken = excluded.refreshToken,
        accessToken = excluded.accessToken,
        tokenExpiresAt = excluded.tokenExpiresAt,
        userId = excluded.userId,
        scope = excluded.scope,
        connectedAt = excluded.connectedAt,
        tokenSource = excluded.tokenSource
    `);

    stmt.run(
      data.refreshToken ?? existing?.refreshToken ?? null,
      data.accessToken ?? existing?.accessToken ?? null,
      data.tokenExpiresAt ?? existing?.tokenExpiresAt ?? null,
      data.userId ?? existing?.userId ?? null,
      data.scope ?? existing?.scope ?? null,
      data.connectedAt,
      data.source ?? existing?.source ?? "oauth"
    );
  }

  getWithingsTokens(): {
    refreshToken?: string;
    accessToken?: string;
    tokenExpiresAt?: string;
    userId?: string;
    scope?: string;
    connectedAt: string;
    source: "oauth" | "env" | "unknown";
  } | null {
    const stmt = this.db.prepare(`
      SELECT refreshToken, accessToken, tokenExpiresAt, userId, scope, connectedAt, tokenSource
      FROM withings_data WHERE id = 1
    `);

    const row = stmt.get() as {
      refreshToken: string | null;
      accessToken: string | null;
      tokenExpiresAt: string | null;
      userId: string | null;
      scope: string | null;
      connectedAt: string | null;
      tokenSource: string | null;
    } | undefined;

    if (!row || (!row.refreshToken && !row.accessToken)) {
      return null;
    }

    return {
      ...(row.refreshToken ? { refreshToken: row.refreshToken } : {}),
      ...(row.accessToken ? { accessToken: row.accessToken } : {}),
      ...(row.tokenExpiresAt ? { tokenExpiresAt: row.tokenExpiresAt } : {}),
      ...(row.userId ? { userId: row.userId } : {}),
      ...(row.scope ? { scope: row.scope } : {}),
      connectedAt: row.connectedAt ?? new Date().toISOString(),
      source:
        row.tokenSource === "oauth" || row.tokenSource === "env"
          ? row.tokenSource
          : "unknown"
    };
  }

  setWithingsData(weight: WithingsWeightEntry[], sleepSummary: WithingsSleepSummaryEntry[], lastSyncedAt: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO withings_data (id, weightJson, sleepJson, lastSyncedAt)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        weightJson = excluded.weightJson,
        sleepJson = excluded.sleepJson,
        lastSyncedAt = excluded.lastSyncedAt
    `);

    stmt.run(JSON.stringify(weight), JSON.stringify(sleepSummary), lastSyncedAt);
  }

  getWithingsData(): WithingsData {
    const stmt = this.db.prepare(`
      SELECT weightJson, sleepJson, lastSyncedAt
      FROM withings_data WHERE id = 1
    `);

    const row = stmt.get() as {
      weightJson: string | null;
      sleepJson: string | null;
      lastSyncedAt: string | null;
    } | undefined;

    if (!row) {
      return {
        weight: [],
        sleepSummary: [],
        lastSyncedAt: null
      };
    }

    let weight: WithingsWeightEntry[] = [];
    let sleepSummary: WithingsSleepSummaryEntry[] = [];

    try {
      weight = row.weightJson ? (JSON.parse(row.weightJson) as WithingsWeightEntry[]) : [];
    } catch {
      weight = [];
    }

    try {
      sleepSummary = row.sleepJson ? (JSON.parse(row.sleepJson) as WithingsSleepSummaryEntry[]) : [];
    } catch {
      sleepSummary = [];
    }

    return {
      weight,
      sleepSummary,
      lastSyncedAt: row.lastSyncedAt
    };
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
