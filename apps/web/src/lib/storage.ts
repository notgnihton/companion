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
  NotificationPreferences,
  OnboardingProfile,
  ThemePreference,
  UserContext
} from "../types";

// Storage version - increment when data structures change to auto-clear cache
const STORAGE_VERSION = "1.0.0";
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
  journalQueue: "companion:journal-queue",
  syncQueue: "companion:sync-queue",
  schedule: "companion:schedule",
  deadlines: "companion:deadlines",
  habits: "companion:habits",
  goals: "companion:goals",
  onboarding: "companion:onboarding",
  notificationPreferences: "companion:notification-preferences",
  theme: "companion:theme",
  canvasSettings: "companion:canvas-settings",
  canvasStatus: "companion:canvas-status"
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
  operationType: "journal" | "deadline" | "context";
  payload: Record<string, unknown>;
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
}

function buildRecentCheckIns(offsets: number[]): Array<{ date: string; completed: boolean }> {
  const recent: Array<{ date: string; completed: boolean }> = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - offset);
    const date = day.toISOString().slice(0, 10);
    recent.push({
      date,
      completed: offsets.includes(offset)
    });
  }
  return recent;
}

function completionRate(recent: Array<{ completed: boolean }>): number {
  return recent.length === 0 ? 0 : Math.round((recent.filter((c) => c.completed).length / recent.length) * 100);
}

function streakFromRecent(recent: Array<{ completed: boolean }>): number {
  let streak = 0;
  let graceUsed = false;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const offsetFromToday = recent.length - 1 - i;
    if (recent[i].completed) {
      streak += 1;
      continue;
    }
    if (!graceUsed && streak > 0 && offsetFromToday <= 1) {
      graceUsed = true;
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

function defaultHabits(): Habit[] {
  const seed = [
    {
      id: "habit-seed-1",
      name: "Morning run",
      cadence: "daily",
      targetPerWeek: 5,
      motivation: "Energy before lectures",
      offsets: [0, 1, 2, 4]
    },
    {
      id: "habit-seed-2",
      name: "Deep work block",
      cadence: "daily",
      targetPerWeek: 6,
      motivation: "Keep assignments moving",
      offsets: [0, 1, 3]
    },
    {
      id: "habit-seed-3",
      name: "Wind-down reading",
      cadence: "weekly",
      targetPerWeek: 4,
      motivation: "Better sleep and focus",
      offsets: [1, 3, 5]
    }
  ];

  return seed.map((habit) => {
    const recentCheckIns = buildRecentCheckIns(habit.offsets);
    const streak = streakFromRecent(recentCheckIns);
    return {
      id: habit.id,
      name: habit.name,
      cadence: habit.cadence as Habit["cadence"],
      targetPerWeek: habit.targetPerWeek,
      motivation: habit.motivation,
      recentCheckIns,
      completionRate7d: completionRate(recentCheckIns),
      streak,
      todayCompleted: recentCheckIns[recentCheckIns.length - 1]?.completed ?? false
    };
  });
}

function defaultGoals(): Goal[] {
  const seed = [
    {
      id: "goal-seed-1",
      title: "Publish portfolio draft",
      cadence: "daily",
      targetCount: 10,
      dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      motivation: "Prepare for internship interviews",
      offsets: [0, 1, 2, 3]
    },
    {
      id: "goal-seed-2",
      title: "Finish algorithms PSET",
      cadence: "daily",
      targetCount: 6,
      dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      motivation: "Stay ahead of class pace",
      offsets: [0, 2, 4]
    }
  ];

  return seed.map((goal) => {
    const recentCheckIns = buildRecentCheckIns(goal.offsets);
    const progressCount = goal.offsets.length;
    const streak = streakFromRecent(recentCheckIns);
    return {
      id: goal.id,
      title: goal.title,
      cadence: goal.cadence as Goal["cadence"],
      targetCount: goal.targetCount,
      dueDate: goal.dueDate,
      motivation: goal.motivation,
      progressCount,
      remaining: Math.max(goal.targetCount - progressCount, 0),
      recentCheckIns,
      completionRate7d: completionRate(recentCheckIns),
      streak,
      todayCompleted: recentCheckIns[recentCheckIns.length - 1]?.completed ?? false
    };
  });
}

export function loadHabits(): Habit[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.habits);
    if (raw) return JSON.parse(raw) as Habit[];
  } catch {
    // corrupted — fall through
  }
  const habits = defaultHabits();
  saveHabits(habits);
  return habits;
}

export function saveHabits(habits: Habit[]): void {
  localStorage.setItem(STORAGE_KEYS.habits, JSON.stringify(habits));
}

export function loadGoals(): Goal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.goals);
    if (raw) return JSON.parse(raw) as Goal[];
  } catch {
    // corrupted — fall through
  }
  const goals = defaultGoals();
  saveGoals(goals);
  return goals;
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
  operationType: "journal" | "deadline" | "context",
  payload: Record<string, unknown>
): void {
  const queue = loadSyncQueue();
  queue.push({
    id: crypto.randomUUID(),
    operationType,
    payload,
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
