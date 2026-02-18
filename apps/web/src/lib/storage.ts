import {
  CanvasSettings,
  CanvasStatus,
  DashboardSnapshot,
  Deadline,
  Goal,
  Habit,
  JournalEntry,
  JournalPhoto,
  LectureEvent,
  SocialMediaFeed,
  StudyPlan,
  NotificationPreferences,
  OnboardingProfile,
  IntegrationScopeSettings,
  ThemePreference,
  UserContext
} from "../types";

// Storage version - increment when data structures change to auto-clear cache
const STORAGE_VERSION = "1.0.2";  // Changed to trigger cache clear
const VERSION_KEY = "companion:version";

// Auto-clear storage if version changed (prevents cached data bugs)
const storedVersion = localStorage.getItem(VERSION_KEY);
if (storedVersion !== STORAGE_VERSION) {
  console.log(`Storage version changed (${storedVersion} → ${STORAGE_VERSION}), clearing cache`);
  localStorage.clear();
  localStorage.setItem(VERSION_KEY, STORAGE_VERSION);
}

const STORAGE_KEYS = {
  dashboard: "companion:dashboard",
  context: "companion:context",
  journal: "companion:journal",
  archivedJournalIds: "companion:archived-journal-ids",
  journalQueue: "companion:journal-queue",
  syncQueue: "companion:sync-queue",
  schedule: "companion:schedule",
  scheduleCachedAt: "companion:schedule-cached-at",
  deadlines: "companion:deadlines",
  deadlinesCachedAt: "companion:deadlines-cached-at",
  studyPlan: "companion:study-plan",
  studyPlanCachedAt: "companion:study-plan-cached-at",
  socialMediaCache: "companion:social-media-cache",
  socialMediaCachedAt: "companion:social-media-cached-at",
  habits: "companion:habits",
  goals: "companion:goals",
  onboarding: "companion:onboarding",
  notificationPreferences: "companion:notification-preferences",
  theme: "companion:theme",
  talkModeEnabled: "companion:talk-mode-enabled",
  canvasSettings: "companion:canvas-settings",
  canvasStatus: "companion:canvas-status",
  integrationScopeSettings: "companion:integration-scope-settings",
  authToken: "companion:auth-token"
} as const;

export interface JournalQueueItem {
  id: string;
  clientEntryId: string;
  content: string;
  timestamp: string;
  baseVersion?: number;
  tags?: string[];
  photos?: JournalPhoto[];
}

export interface SyncQueueItem {
  id: string;
  operationType: "journal" | "deadline" | "context" | "habit-checkin" | "goal-checkin" | "schedule-update";
  payload: Record<string, unknown>;
  dedupeKey?: string;
  createdAt: string;
}

const defaultContext: UserContext = {
  stressLevel: "medium",
  energyLevel: "medium",
  mode: "balanced"
};

const defaultCanvasSettings: CanvasSettings = {
  baseUrl: "https://stavanger.instructure.com",
  token: ""
};

const defaultCanvasStatus: CanvasStatus = {
  baseUrl: defaultCanvasSettings.baseUrl,
  lastSyncedAt: null,
  courses: []
};

const defaultIntegrationScopeSettings: IntegrationScopeSettings = {
  semester: "26v",
  tpCourseIds: ["DAT520,1", "DAT560,1", "DAT600,1"],
  canvasCourseIds: [],
  pastDays: 30,
  futureDays: 180
};


const defaultNotificationPreferences: NotificationPreferences = {
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

export function loadNotificationPreferences(): NotificationPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.notificationPreferences);
    if (raw) return JSON.parse(raw) as NotificationPreferences;
  } catch {
    // corrupted
  }
  return defaultNotificationPreferences;
}

export function saveNotificationPreferences(preferences: NotificationPreferences): void {
  localStorage.setItem(STORAGE_KEYS.notificationPreferences, JSON.stringify(preferences));
}

export function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.theme);
    if (raw === "light" || raw === "dark" || raw === "system") {
      return raw;
    }
  } catch {
    // corrupted
  }
  return "system";
}

export function saveThemePreference(preference: ThemePreference): void {
  localStorage.setItem(STORAGE_KEYS.theme, preference);
}

export function loadTalkModeEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.talkModeEnabled) === "true";
  } catch {
    return false;
  }
}

export function saveTalkModeEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.talkModeEnabled, enabled ? "true" : "false");
}

export function loadAuthToken(): string | null {
  try {
    const token = localStorage.getItem(STORAGE_KEYS.authToken);
    if (!token || token.trim().length === 0) {
      return null;
    }
    return token.trim();
  } catch {
    return null;
  }
}

export function saveAuthToken(token: string): void {
  localStorage.setItem(STORAGE_KEYS.authToken, token.trim());
}

export function clearAuthToken(): void {
  localStorage.removeItem(STORAGE_KEYS.authToken);
}

export function clearCompanionSessionData(options: { keepTheme?: boolean } = {}): void {
  const keepTheme = options.keepTheme ?? true;
  const themeValue = keepTheme ? localStorage.getItem(STORAGE_KEYS.theme) : null;

  Object.values(STORAGE_KEYS).forEach((key) => {
    if (keepTheme && key === STORAGE_KEYS.theme) {
      return;
    }
    localStorage.removeItem(key);
  });

  if (keepTheme && themeValue) {
    localStorage.setItem(STORAGE_KEYS.theme, themeValue);
  }

  localStorage.setItem(VERSION_KEY, STORAGE_VERSION);
}

export function loadCanvasSettings(): CanvasSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.canvasSettings);
    if (raw) return { ...defaultCanvasSettings, ...(JSON.parse(raw) as CanvasSettings) };
  } catch {
    // corrupted
  }
  return defaultCanvasSettings;
}

export function saveCanvasSettings(settings: CanvasSettings): void {
  localStorage.setItem(STORAGE_KEYS.canvasSettings, JSON.stringify(settings));
}

export function loadCanvasStatus(): CanvasStatus {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.canvasStatus);
    if (raw) return { ...defaultCanvasStatus, ...(JSON.parse(raw) as CanvasStatus) };
  } catch {
    // corrupted
  }
  return defaultCanvasStatus;
}

export function saveCanvasStatus(status: CanvasStatus): void {
  localStorage.setItem(STORAGE_KEYS.canvasStatus, JSON.stringify(status));
}

export function loadIntegrationScopeSettings(): IntegrationScopeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.integrationScopeSettings);
    if (!raw) {
      return defaultIntegrationScopeSettings;
    }

    const parsed = JSON.parse(raw) as Partial<IntegrationScopeSettings>;
    const tpCourseIds = Array.isArray(parsed.tpCourseIds)
      ? parsed.tpCourseIds.map((value) => value.trim()).filter(Boolean)
      : defaultIntegrationScopeSettings.tpCourseIds;
    const canvasCourseIds = Array.isArray(parsed.canvasCourseIds)
      ? parsed.canvasCourseIds.filter((value): value is number => Number.isInteger(value) && value > 0)
      : [];

    return {
      semester: typeof parsed.semester === "string" && parsed.semester.trim() ? parsed.semester.trim() : "26v",
      tpCourseIds,
      canvasCourseIds,
      pastDays:
        typeof parsed.pastDays === "number" && Number.isFinite(parsed.pastDays)
          ? Math.max(0, Math.min(365, Math.round(parsed.pastDays)))
          : defaultIntegrationScopeSettings.pastDays,
      futureDays:
        typeof parsed.futureDays === "number" && Number.isFinite(parsed.futureDays)
          ? Math.max(1, Math.min(730, Math.round(parsed.futureDays)))
          : defaultIntegrationScopeSettings.futureDays
    };
  } catch {
    return defaultIntegrationScopeSettings;
  }
}

export function saveIntegrationScopeSettings(settings: IntegrationScopeSettings): void {
  const normalized: IntegrationScopeSettings = {
    semester: settings.semester.trim() || "26v",
    tpCourseIds: settings.tpCourseIds.map((value) => value.trim()).filter(Boolean),
    canvasCourseIds: settings.canvasCourseIds.filter((value) => Number.isInteger(value) && value > 0),
    pastDays: Math.max(0, Math.min(365, Math.round(settings.pastDays))),
    futureDays: Math.max(1, Math.min(730, Math.round(settings.futureDays)))
  };
  localStorage.setItem(STORAGE_KEYS.integrationScopeSettings, JSON.stringify(normalized));
}

function defaultDashboard(): DashboardSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      todayFocus: "Welcome to Companion! Set your context below.",
      pendingDeadlines: 0,
      activeAgents: 0,
      journalStreak: 0
    },
    agentStates: [
      { name: "notes", status: "idle", lastRunAt: null },
      { name: "lecture-plan", status: "idle", lastRunAt: null },
      { name: "assignment-tracker", status: "idle", lastRunAt: null },
      { name: "orchestrator", status: "idle", lastRunAt: null }
    ],
    notifications: [],
    events: []
  };
}

export function loadDashboard(): DashboardSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.dashboard);
    if (raw) return JSON.parse(raw) as DashboardSnapshot;
  } catch {
    // corrupted — fall through
  }
  return defaultDashboard();
}

export function saveDashboard(snapshot: DashboardSnapshot): void {
  localStorage.setItem(STORAGE_KEYS.dashboard, JSON.stringify(snapshot));
}

export function loadContext(): UserContext {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.context);
    if (raw) return JSON.parse(raw) as UserContext;
  } catch {
    // corrupted — fall through
  }
  return defaultContext;
}

export function saveContext(ctx: UserContext): void {
  localStorage.setItem(STORAGE_KEYS.context, JSON.stringify(ctx));
}


export function loadOnboardingProfile(): OnboardingProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.onboarding);
    if (raw) {
      return JSON.parse(raw) as OnboardingProfile;
    }
  } catch {
    // ignore corrupted data
  }

  return null;
}

export function saveOnboardingProfile(profile: OnboardingProfile): void {
  localStorage.setItem(STORAGE_KEYS.onboarding, JSON.stringify(profile));
}

export function loadJournalEntries(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.journal);
    if (raw) return JSON.parse(raw) as JournalEntry[];
  } catch {
    // corrupted — fall through
  }
  return [];
}

export function saveJournalEntries(entries: JournalEntry[]): void {
  localStorage.setItem(STORAGE_KEYS.journal, JSON.stringify(entries));
}

export function loadArchivedJournalIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.archivedJournalIds);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

export function saveArchivedJournalIds(ids: string[]): void {
  localStorage.setItem(STORAGE_KEYS.archivedJournalIds, JSON.stringify(ids));
}

export function addJournalEntry(text: string, tags?: string[], photos?: JournalPhoto[]): JournalEntry {
  const clientEntryId = crypto.randomUUID();
  const entry: JournalEntry = {
    id: clientEntryId,
    clientEntryId,
    text,
    content: text,
    timestamp: new Date().toISOString(),
    syncStatus: navigator.onLine ? "synced" : "queued",
    tags: tags || [],
    photos: photos ?? []
  };
  const entries = loadJournalEntries();
  entries.unshift(entry);
  saveJournalEntries(entries);
  return entry;
}

export function loadJournalQueue(): JournalQueueItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.journalQueue);
    if (raw) return JSON.parse(raw) as JournalQueueItem[];
  } catch {
    // corrupted
  }
  return [];
}

export function saveJournalQueue(entries: JournalQueueItem[]): void {
  localStorage.setItem(STORAGE_KEYS.journalQueue, JSON.stringify(entries));
}

export function enqueueJournalEntry(entry: JournalEntry): void {
  const queue = loadJournalQueue();
  queue.push({
    id: crypto.randomUUID(),
    clientEntryId: entry.clientEntryId ?? entry.id,
    content: entry.text,
    timestamp: entry.timestamp,
    baseVersion: entry.version,
    tags: entry.tags,
    photos: entry.photos
  });
  saveJournalQueue(queue);
}

export function removeJournalQueueItem(clientEntryId: string): void {
  const queue = loadJournalQueue().filter((item) => item.clientEntryId !== clientEntryId);
  saveJournalQueue(queue);
}

function getDefaultSchedule(): LectureEvent[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return [
    {
      id: "1",
      title: "Data Structures",
      startTime: new Date(today.getTime() + 10 * 60 * 60 * 1000).toISOString(),
      durationMinutes: 90,
      workload: "medium"
    },
    {
      id: "2",
      title: "Linear Algebra",
      startTime: new Date(today.getTime() + 14 * 60 * 60 * 1000).toISOString(),
      durationMinutes: 75,
      workload: "high"
    },
    {
      id: "3",
      title: "Systems Design",
      startTime: new Date(today.getTime() + 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000).toISOString(),
      durationMinutes: 90,
      workload: "high"
    }
  ];
}

export function loadSchedule(): LectureEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.schedule);
    if (raw) return JSON.parse(raw) as LectureEvent[];
  } catch {
    // corrupted — fall through
  }
  const schedule = getDefaultSchedule();
  saveSchedule(schedule);
  return schedule;
}

export function saveSchedule(schedule: LectureEvent[]): void {
  localStorage.setItem(STORAGE_KEYS.schedule, JSON.stringify(schedule));
  localStorage.setItem(STORAGE_KEYS.scheduleCachedAt, new Date().toISOString());
}

export function loadScheduleCachedAt(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.scheduleCachedAt);
  } catch {
    return null;
  }
}

function getDefaultDeadlines(): Deadline[] {
  const now = new Date();

  return [
    {
      id: "1",
      course: "Algorithms",
      task: "Problem Set 4",
      dueDate: new Date(now.getTime() + 28 * 60 * 60 * 1000).toISOString(),
      priority: "high",
      completed: false
    },
    {
      id: "2",
      course: "Operating Systems",
      task: "Lab 3",
      dueDate: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
      priority: "critical",
      completed: false
    },
    {
      id: "3",
      course: "Databases",
      task: "Schema Design Report",
      dueDate: new Date(now.getTime() + 54 * 60 * 60 * 1000).toISOString(),
      priority: "medium",
      completed: false
    }
  ];
}

export function loadDeadlines(): Deadline[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.deadlines);
    if (raw) return JSON.parse(raw) as Deadline[];
  } catch {
    // corrupted — fall through
  }
  const deadlines = getDefaultDeadlines();
  saveDeadlines(deadlines);
  return deadlines;
}

export function saveDeadlines(deadlines: Deadline[]): void {
  localStorage.setItem(STORAGE_KEYS.deadlines, JSON.stringify(deadlines));
  localStorage.setItem(STORAGE_KEYS.deadlinesCachedAt, new Date().toISOString());
}

export function loadDeadlinesCachedAt(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.deadlinesCachedAt);
  } catch {
    return null;
  }
}

export function loadStudyPlanCache(): StudyPlan | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.studyPlan);
    if (!raw) return null;
    return JSON.parse(raw) as StudyPlan;
  } catch {
    return null;
  }
}

export function saveStudyPlanCache(plan: StudyPlan): void {
  localStorage.setItem(STORAGE_KEYS.studyPlan, JSON.stringify(plan));
  localStorage.setItem(STORAGE_KEYS.studyPlanCachedAt, new Date().toISOString());
}

export function loadStudyPlanCachedAt(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.studyPlanCachedAt);
  } catch {
    return null;
  }
}

export function loadSocialMediaCache(): SocialMediaFeed | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.socialMediaCache);
    if (!raw) return null;
    return JSON.parse(raw) as SocialMediaFeed;
  } catch {
    return null;
  }
}

export function saveSocialMediaCache(feed: SocialMediaFeed): void {
  localStorage.setItem(STORAGE_KEYS.socialMediaCache, JSON.stringify(feed));
  localStorage.setItem(STORAGE_KEYS.socialMediaCachedAt, new Date().toISOString());
}

export function loadSocialMediaCachedAt(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.socialMediaCachedAt);
  } catch {
    return null;
  }
}

const LEGACY_GOAL_SIGNATURES = [
  "finish algorithms pset|daily|6",
  "publish portfolio draft|daily|10"
];

function isLegacySeedHabits(habits: Habit[]): boolean {
  if (habits.length !== 3) {
    return false;
  }

  const signatures = new Set(
    habits
    .map((habit) => {
      return `${habit.name.trim().toLowerCase()}|${habit.cadence}|${habit.targetPerWeek}`;
    })
  );

  return (
    signatures.has("morning run|daily|5") &&
    signatures.has("wind-down reading|weekly|4") &&
    (signatures.has("study sprint|daily|6") || signatures.has("deep work block|daily|6"))
  );
}

function isLegacySeedGoals(goals: Goal[]): boolean {
  if (goals.length !== LEGACY_GOAL_SIGNATURES.length) {
    return false;
  }

  const signatures = goals
    .map((goal) => {
      return `${goal.title.trim().toLowerCase()}|${goal.cadence}|${goal.targetCount}`;
    })
    .sort();

  return JSON.stringify(signatures) === JSON.stringify([...LEGACY_GOAL_SIGNATURES].sort());
}

export function loadHabits(): Habit[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.habits);
    if (raw) {
      const parsed = JSON.parse(raw) as Habit[];
      if (Array.isArray(parsed) && isLegacySeedHabits(parsed)) {
        saveHabits([]);
        return [];
      }
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    // corrupted — fall through
  }
  saveHabits([]);
  return [];
}

export function saveHabits(habits: Habit[]): void {
  localStorage.setItem(STORAGE_KEYS.habits, JSON.stringify(habits));
}

export function loadGoals(): Goal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.goals);
    if (raw) {
      const parsed = JSON.parse(raw) as Goal[];
      if (Array.isArray(parsed) && isLegacySeedGoals(parsed)) {
        saveGoals([]);
        return [];
      }
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    // corrupted — fall through
  }
  saveGoals([]);
  return [];
}

export function saveGoals(goals: Goal[]): void {
  localStorage.setItem(STORAGE_KEYS.goals, JSON.stringify(goals));
}

// Sync Queue management
export function loadSyncQueue(): SyncQueueItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.syncQueue);
    if (raw) return JSON.parse(raw) as SyncQueueItem[];
  } catch {
    // corrupted
  }
  return [];
}

export function saveSyncQueue(items: SyncQueueItem[]): void {
  localStorage.setItem(STORAGE_KEYS.syncQueue, JSON.stringify(items));
}

export function enqueueSyncOperation(
  operationType: SyncQueueItem["operationType"],
  payload: Record<string, unknown>,
  options: { dedupeKey?: string } = {}
): void {
  const queue = loadSyncQueue();
  const dedupeKey = options.dedupeKey?.trim();

  if (dedupeKey) {
    const existingIndex = queue.findIndex(
      (item) => item.operationType === operationType && item.dedupeKey === dedupeKey
    );
    if (existingIndex >= 0) {
      const existing = queue[existingIndex]!;
      queue[existingIndex] = {
        ...existing,
        payload,
        createdAt: new Date().toISOString(),
        dedupeKey
      };
      saveSyncQueue(queue);
      return;
    }
  }

  queue.push({
    id: crypto.randomUUID(),
    operationType,
    payload,
    ...(dedupeKey ? { dedupeKey } : {}),
    createdAt: new Date().toISOString()
  });
  saveSyncQueue(queue);
}

export function removeSyncQueueItem(id: string): void {
  const queue = loadSyncQueue().filter((item) => item.id !== id);
  saveSyncQueue(queue);
}

export function clearSyncQueue(): void {
  saveSyncQueue([]);
}
