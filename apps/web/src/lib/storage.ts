import { DashboardSnapshot, UserContext, JournalEntry, LectureEvent, Deadline } from "../types";

const STORAGE_KEYS = {
  dashboard: "companion:dashboard",
  context: "companion:context",
  journal: "companion:journal",
  schedule: "companion:schedule",
  deadlines: "companion:deadlines",
} as const;

const defaultContext: UserContext = {
  stressLevel: "medium",
  energyLevel: "medium",
  mode: "balanced",
};

function defaultDashboard(): DashboardSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      todayFocus: "Welcome to Companion! Set your context below.",
      pendingDeadlines: 0,
      activeAgents: 0,
      journalStreak: 0,
    },
    agentStates: [
      { name: "notes", status: "idle", lastRunAt: null },
      { name: "lecture-plan", status: "idle", lastRunAt: null },
      { name: "assignment-tracker", status: "idle", lastRunAt: null },
      { name: "orchestrator", status: "idle", lastRunAt: null },
    ],
    notifications: [],
    events: [],
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
  const entry: JournalEntry = {
    id: crypto.randomUUID(),
    text,
    timestamp: new Date().toISOString(),
  };
  const entries = loadJournalEntries();
  entries.unshift(entry); // newest first
  saveJournalEntries(entries);
  return entry;
}

// Mock schedule data for demo
function getDefaultSchedule(): LectureEvent[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  return [
    {
      id: "1",
      title: "Data Structures",
      startTime: new Date(today.getTime() + 10 * 60 * 60 * 1000).toISOString(), // 10 AM today
      durationMinutes: 90,
      workload: "medium"
    },
    {
      id: "2",
      title: "Linear Algebra",
      startTime: new Date(today.getTime() + 14 * 60 * 60 * 1000).toISOString(), // 2 PM today
      durationMinutes: 75,
      workload: "high"
    },
    {
      id: "3",
      title: "Systems Design",
      startTime: new Date(today.getTime() + 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000).toISOString(), // 9 AM tomorrow
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

// Mock deadline data for demo
function getDefaultDeadlines(): Deadline[] {
  const now = new Date();
  
  return [
    {
      id: "1",
      course: "Algorithms",
      task: "Problem Set 4",
      dueDate: new Date(now.getTime() + 28 * 60 * 60 * 1000).toISOString(), // 28 hours from now
      priority: "high",
      completed: false
    },
    {
      id: "2",
      course: "Operating Systems",
      task: "Lab 3",
      dueDate: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(), // 12 hours from now
      priority: "critical",
      completed: false
    },
    {
      id: "3",
      course: "Databases",
      task: "Schema Design Report",
      dueDate: new Date(now.getTime() + 54 * 60 * 60 * 1000).toISOString(), // 54 hours from now
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
