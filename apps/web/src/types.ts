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

export interface JournalPhoto {
  id?: string;
  dataUrl: string;
  fileName?: string;
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
  tags?: string[];
  photos?: JournalPhoto[];
}

export interface WeeklySummary {
  windowStart: string;
  windowEnd: string;
  deadlinesDue: number;
  deadlinesCompleted: number;
  completionRate: number;
  journalHighlights: JournalEntry[];
}

export interface JournalSyncPayload {
  clientEntryId: string;
  content: string;
  timestamp: string;
  baseVersion?: number;
  tags?: string[];
  photos?: JournalPhoto[];
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

export interface DeadlineReminderState {
  deadlineId: string;
  reminderCount: number;
  lastReminderAt: string;
  lastConfirmationAt: string | null;
  lastConfirmedCompleted: boolean | null;
}

export interface DeadlineStatusConfirmation {
  deadline: Deadline;
  reminder: DeadlineReminderState;
}

export type Cadence = "daily" | "weekly";

export interface CheckInDay {
  date: string;
  completed: boolean;
}

export interface Habit {
  id: string;
  name: string;
  cadence: Cadence;
  targetPerWeek: number;
  motivation?: string;
  streak: number;
  completionRate7d: number;
  todayCompleted: boolean;
  recentCheckIns: CheckInDay[];
}

export interface Goal {
  id: string;
  title: string;
  cadence: Cadence;
  targetCount: number;
  dueDate: string | null;
  motivation?: string;
  progressCount: number;
  remaining: number;
  streak: number;
  completionRate7d: number;
  todayCompleted: boolean;
  recentCheckIns: CheckInDay[];
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

export type ThemePreference = "light" | "dark" | "system";

export type NotificationInteractionType = "tap" | "dismiss" | "action";

export interface NotificationInteraction {
  id: string;
  notificationId: string;
  notificationTitle: string;
  notificationSource: AgentName;
  notificationPriority: Priority;
  interactionType: NotificationInteractionType;
  timestamp: string;
  actionType?: string;
  timeToInteractionMs?: number;
}

export type SyncOperationType = "journal" | "deadline" | "context";

export type SyncOperationStatus = "pending" | "processing" | "completed" | "failed";

export interface ServerSyncQueueItem {
  id: string;
  operationType: SyncOperationType;
  payload: Record<string, unknown>;
  status: SyncOperationStatus;
  attempts: number;
  lastAttemptAt: string | null;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface SyncQueueStatus {
  pending: number;
  processing: number;
  failed: number;
  recentItems: ServerSyncQueueItem[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  streaming?: boolean;
}

export interface SendChatMessageRequest {
  message: string;
}

export interface SendChatMessageResponse {
  message: ChatMessage;
}

export interface GetChatHistoryResponse {
  messages: ChatMessage[];
  hasMore: boolean;
}
