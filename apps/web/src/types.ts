export type AgentName =
  | "notes"
  | "lecture-plan"
  | "assignment-tracker"
  | "orchestrator";

export type Priority = "low" | "medium" | "high" | "critical";

export interface AgentEvent {
  id: string;
  source: AgentName;
  eventType: string;
  priority: Priority;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  priority: Priority;
  source: AgentName;
  timestamp: string;
}

export interface AgentState {
  name: AgentName;
  status: "idle" | "running" | "error";
  lastRunAt: string | null;
}

export interface DashboardSnapshot {
  generatedAt: string;
  summary: {
    todayFocus: string;
    pendingDeadlines: number;
    activeAgents: number;
    journalStreak: number;
  };
  agentStates: AgentState[];
  notifications: Notification[];
  events: AgentEvent[];
}

export interface UserContext {
  stressLevel: "low" | "medium" | "high";
  energyLevel: "low" | "medium" | "high";
  mode: "focus" | "balanced" | "recovery";
}

export interface JournalEntry {
  id: string;
  text: string;
  content: string;
  timestamp: string;
  updatedAt?: string;
  version?: number;
  clientEntryId?: string;
  syncStatus?: "queued" | "synced";
}

export interface JournalSyncPayload {
  clientEntryId: string;
  content: string;
  timestamp: string;
  baseVersion?: number;
}

export interface LectureEvent {
  id: string;
  title: string;
  startTime: string;
  durationMinutes: number;
  workload: "low" | "medium" | "high";
}

export interface Deadline {
  id: string;
  course: string;
  task: string;
  dueDate: string;
  priority: Priority;
  completed: boolean;
}

export interface CalendarImportPayload {
  ics?: string;
  url?: string;
}

export interface CalendarImportPreview {
  importedEvents: number;
  lecturesPlanned: number;
  deadlinesPlanned: number;
  lectures: Array<Omit<LectureEvent, "id">>;
  deadlines: Array<Omit<Deadline, "id">>;
}

export interface CalendarImportResult {
  importedEvents: number;
  lecturesCreated: number;
  deadlinesCreated: number;
  lectures: LectureEvent[];
  deadlines: Deadline[];
}

export interface OnboardingProfile {
  name: string;
  timezone: string;
  baselineSchedule: string;
  nudgeTone: "gentle" | "balanced" | "direct";
  completedAt: string;
}

export interface NotificationPreferences {
  quietHours: {
    enabled: boolean;
    startHour: number;
    endHour: number;
  };
  minimumPriority: Priority;
  allowCriticalInQuietHours: boolean;
  categoryToggles: Record<AgentName, boolean>;
}
