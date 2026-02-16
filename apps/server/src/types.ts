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

export type NotificationAction = "complete" | "snooze" | "view";

export interface Notification {
  id: string;
  title: string;
  message: string;
  priority: Priority;
  source: AgentName;
  timestamp: string;
  metadata?: Record<string, unknown>;
  actions?: NotificationAction[];
  url?: string;
}

export type EmailDigestType = "daily" | "weekly";

export type EmailDigestReason = "push-failures" | "inactivity";

export interface EmailDigest {
  id: string;
  type: EmailDigestType;
  reason: EmailDigestReason;
  recipient: string;
  subject: string;
  body: string;
  timeframeStart: string;
  timeframeEnd: string;
  generatedAt: string;
}

export interface ScheduledNotification {
  id: string;
  notification: Omit<Notification, "id" | "timestamp">;
  scheduledFor: string;
  createdAt: string;
  eventId?: string;
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

export interface Tag {
  id: string;
  name: string;
}

export interface JournalPhoto {
  id?: string;
  dataUrl: string;
  fileName?: string;
}

export interface JournalEntry {
  id: string;
  content: string;
  timestamp: string;
  updatedAt: string;
  version: number;
  clientEntryId?: string;
  tags?: string[];
  photos?: JournalPhoto[];
}

export interface JournalSyncPayload {
  id?: string;
  clientEntryId: string;
  content: string;
  timestamp: string;
  baseVersion?: number;
  tags?: string[];
  photos?: JournalPhoto[];
}

export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval?: number;
  count?: number;
  until?: string;
  byWeekDay?: number[];
  byMonthDay?: number;
}

export interface LectureEvent {
  id: string;
  title: string;
  startTime: string;
  durationMinutes: number;
  workload: "low" | "medium" | "high";
  recurrence?: RecurrenceRule;
  recurrenceParentId?: string;
}

export interface Deadline {
  id: string;
  course: string;
  task: string;
  dueDate: string;
  priority: Priority;
  completed: boolean;
  source?: string; // "manual", "github-dat520", "github-dat560", "canvas", etc.
  externalId?: string; // External identifier for deduplication
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

export interface WorkBlockSuggestion {
  deadline: Deadline;
  suggestedStartTime: string;
  suggestedEndTime: string;
  durationMinutes: number;
  gapQualityScore: number;
  priorityScore: number;
  overallScore: number;
  rationale: string;
}

export type Cadence = "daily" | "weekly";

export interface Habit {
  id: string;
  name: string;
  cadence: Cadence;
  targetPerWeek: number;
  motivation?: string;
  createdAt: string;
}

export interface HabitCheckIn {
  id: string;
  habitId: string;
  date: string;
  completed: boolean;
  note?: string;
}

export interface HabitWithStatus extends Habit {
  todayCompleted: boolean;
  streak: number;
  completionRate7d: number;
  recentCheckIns: Array<{ date: string; completed: boolean }>;
}

export interface Goal {
  id: string;
  title: string;
  cadence: Cadence;
  targetCount: number;
  dueDate: string | null;
  motivation?: string;
  createdAt: string;
}

export interface GoalCheckIn {
  id: string;
  goalId: string;
  date: string;
  completed: boolean;
}

export interface GoalWithStatus extends Goal {
  progressCount: number;
  remaining: number;
  todayCompleted: boolean;
  streak: number;
  completionRate7d: number;
  recentCheckIns: Array<{ date: string; completed: boolean }>;
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

export interface ContextTrendBucket {
  total: number;
  energyLevels: Record<UserContext["energyLevel"], number>;
  stressLevels: Record<UserContext["stressLevel"], number>;
  dominantEnergy: UserContext["energyLevel"] | null;
  dominantStress: UserContext["stressLevel"] | null;
}

export interface ContextTrends {
  sampleSize: number;
  byHour: Array<
    {
      hour: number;
    } & ContextTrendBucket
  >;
  byDayOfWeek: Array<
    {
      dayOfWeek: number;
    } & ContextTrendBucket
  >;
  recommendations: {
    bestNotificationHours: number[];
    cautionHours: number[];
    bestDays: number[];
  };
  latestContext: UserContext;
}

export interface ExportData {
  exportedAt: string;
  version: string;
  journals: JournalEntry[];
  tags: Tag[];
  schedule: LectureEvent[];
  deadlines: Deadline[];
   habits: HabitWithStatus[];
   goals: GoalWithStatus[];
  userContext: UserContext;
  notificationPreferences: NotificationPreferences;
}

export interface ImportData {
  version?: string;
  journals?: JournalEntry[];
  schedule?: LectureEvent[];
  deadlines?: Deadline[];
  habits?: Habit[];
  goals?: Goal[];
  userContext?: Partial<UserContext>;
  notificationPreferences?: NotificationPreferencesPatch;
}

export interface ImportResult {
  imported: {
    journals: number;
    schedule: number;
    deadlines: number;
    habits: number;
    goals: number;
  };
  conflicts: {
    journals: JournalEntry[];
  };
  warnings: string[];
}

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

export interface NotificationInteractionMetrics {
  totalInteractions: number;
  tapCount: number;
  dismissCount: number;
  actionCount: number;
  averageTimeToInteractionMs: number;
  interactionsByHour: Record<number, number>;
  interactionsBySource: Record<AgentName, number>;
  recentInteractions: NotificationInteraction[];
}

export interface Location {
  id: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: string;
  label?: string;
}

export interface LocationHistory {
  id: string;
  locationId: string;
  timestamp: string;
  stressLevel?: "low" | "medium" | "high";
  energyLevel?: "low" | "medium" | "high";
  context?: string;
}

export type SyncOperationType = "journal" | "deadline" | "context";

export type SyncOperationStatus = "pending" | "processing" | "completed" | "failed";

export interface SyncQueueItem {
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
  recentItems: SyncQueueItem[];
}
