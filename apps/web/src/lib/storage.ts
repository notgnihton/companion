import {
  DashboardSnapshot,
  Deadline,
  JournalEntry,
  LectureEvent,
  NotificationPreferences,
  OnboardingProfile,
  ThemePreference,
  UserContext
} from "../types";

const STORAGE_KEYS = {
  dashboard: "companion:dashboard",
  context: "companion:context",
  journal: "companion:journal",
  journalQueue: "companion:journal-queue",
  schedule: "companion:schedule",
  deadlines: "companion:deadlines",
  onboarding: "companion:onboarding",
  notificationPreferences: "companion:notification-preferences",
  theme: "companion:theme"
} as const;

export interface JournalQueueItem {
  id: string;
  clientEntryId: string;
  content: string;
  timestamp: string;
  baseVersion?: number;
}

const defaultContext: UserContext = {
  stressLevel: "medium",
  energyLevel: "medium",
  mode: "balanced"
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

export function addJournalEntry(text: string): JournalEntry {
  const clientEntryId = crypto.randomUUID();
  const entry: JournalEntry = {
    id: clientEntryId,
    clientEntryId,
    text,
    content: text,
    timestamp: new Date().toISOString(),
    syncStatus: navigator.onLine ? "synced" : "queued"
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
    baseVersion: entry.version
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
