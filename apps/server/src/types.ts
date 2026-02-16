export type AgentName =
  | "notes"
  | "lecture-plan"
  | "assignment-tracker"
  | "orchestrator";

export type Priority = "low" | "medium" | "high" | "critical";

export interface AgentEvent<T = unknown> {
  id: string;
  source: AgentName;
  eventType: string;
  priority: Priority;
  timestamp: string;
  payload: T;
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
  lastEvent?: AgentEvent;
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

export interface RuntimeConfig {
  timezone: string;
  userName: string;
}

export interface UserContext {
  stressLevel: "low" | "medium" | "high";
  energyLevel: "low" | "medium" | "high";
  mode: "focus" | "balanced" | "recovery";
}

export interface JournalEntry {
  id: string;
  content: string;
  timestamp: string;
  updatedAt: string;
  version: number;
  clientEntryId?: string;
}

export interface JournalSyncPayload {
  id?: string;
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

export interface PushSubscriptionRecord {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}


export interface PushDeliveryFailureRecord {
  id: string;
  endpoint: string;
  notificationId: string;
  notificationTitle: string;
  source: AgentName;
  priority: Priority;
  statusCode?: number;
  error: string;
  attempts: number;
  failedAt: string;
}

export interface PushDeliveryMetrics {
  attempted: number;
  delivered: number;
  failed: number;
  droppedSubscriptions: number;
  totalRetries: number;
  recentFailures: PushDeliveryFailureRecord[];
}

export type NotificationCategory = AgentName;

export interface NotificationPreferences {
  quietHours: {
    enabled: boolean;
    startHour: number;
    endHour: number;
  };
  minimumPriority: Priority;
  allowCriticalInQuietHours: boolean;
  categoryToggles: Record<NotificationCategory, boolean>;
}

export interface NotificationPreferencesPatch {
  quietHours?: Partial<NotificationPreferences["quietHours"]>;
  minimumPriority?: Priority;
  allowCriticalInQuietHours?: boolean;
  categoryToggles?: Partial<Record<NotificationCategory, boolean>>;
}

export interface WeeklySummary {
  windowStart: string;
  windowEnd: string;
  deadlinesDue: number;
  deadlinesCompleted: number;
  completionRate: number;
  journalHighlights: JournalEntry[];
}

export interface CanvasCourse {
  id: number;
  name: string;
  courseCode: string;
  enrollmentType: string;
}

export interface CanvasAssignment {
  id: number;
  courseId: number;
  name: string;
  dueAt: string | null;
  pointsPossible: number;
  submissionStatus: "submitted" | "unsubmitted" | "graded" | "pending_review" | null;
  grade: string | null;
  score: number | null;
}

export interface CanvasModule {
  id: number;
  courseId: number;
  name: string;
  position: number;
  itemsCount: number;
  completedCount: number;
}

export interface CanvasAnnouncement {
  id: number;
  courseId: number;
  title: string;
  message: string;
  postedAt: string;
  author: string;
}

export interface CanvasData {
  courses: CanvasCourse[];
  assignments: CanvasAssignment[];
  modules: CanvasModule[];
  announcements: CanvasAnnouncement[];
  lastSync: string | null;
}
