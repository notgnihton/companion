export type AgentName =
  | "notes"
  | "lecture-plan"
  | "assignment-tracker"
  | "orchestrator";

export type Priority = "low" | "medium" | "high" | "critical";
export type EffortConfidence = "low" | "medium" | "high";

export interface AgentEvent<T = unknown> {
  id: string;
  source: AgentName;
  eventType: string;
  priority: Priority;
  timestamp: string;
  payload: T;
}

export type NotificationAction = "complete" | "working" | "snooze" | "view";

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

export type ChatRole = "user" | "assistant";

export type ChatActionType =
  | "complete-deadline"
  | "snooze-deadline"
  | "create-schedule-block"
  | "create-journal-draft";

export interface ChatPendingAction {
  id: string;
  actionType: ChatActionType;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

export interface ChatActionExecution {
  actionId: string;
  actionType: ChatActionType;
  status: "confirmed" | "cancelled" | "failed";
  message: string;
}

export type ChatCitationType =
  | "schedule"
  | "deadline"
  | "journal"
  | "habit"
  | "goal"
  | "email"
  | "social-youtube"
  | "social-x"
  | "github-course-doc";

export interface ChatCitation {
  id: string;
  type: ChatCitationType;
  label: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatImageAttachment {
  id: string;
  dataUrl: string;
  mimeType?: string;
  fileName?: string;
}

export interface ChatMessageMetadata {
  contextWindow?: string;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    responseTokens?: number;
    totalTokens?: number;
  };
  pendingActions?: ChatPendingAction[];
  actionExecution?: ChatActionExecution;
  citations?: ChatCitation[];
  attachments?: ChatImageAttachment[];
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: string;
  metadata?: ChatMessageMetadata;
}

export interface ChatHistoryPage {
  messages: ChatMessage[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
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
  canvasAssignmentId?: number;
  effortHoursRemaining?: number;
  effortConfidence?: EffortConfidence;
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

export interface StudyPlanSession {
  id: string;
  deadlineId: string;
  course: string;
  task: string;
  priority: Priority;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  score: number;
  rationale: string;
}

export interface StudyPlanUnallocatedItem {
  deadlineId: string;
  course: string;
  task: string;
  priority: Priority;
  dueDate: string;
  remainingMinutes: number;
  reason: string;
}

export interface StudyPlan {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  summary: {
    horizonDays: number;
    deadlinesConsidered: number;
    deadlinesCovered: number;
    totalSessions: number;
    totalPlannedMinutes: number;
  };
  sessions: StudyPlanSession[];
  unallocated: StudyPlanUnallocatedItem[];
}

export type StudyPlanSessionStatus = "pending" | "done" | "skipped";

export interface StudyPlanSessionRecord extends StudyPlanSession {
  generatedAt: string;
  status: StudyPlanSessionStatus;
  checkedAt: string | null;
  energyLevel: number | null;
  focusLevel: number | null;
  checkInNote: string | null;
}

export interface StudyPlanCheckInNoteRecord {
  sessionId: string;
  course: string;
  task: string;
  status: Exclude<StudyPlanSessionStatus, "pending">;
  checkedAt: string;
  note: string;
}

export interface StudyPlanSessionCheckInTrends {
  sessionsChecked: number;
  sessionsWithEnergy: number;
  sessionsWithFocus: number;
  sessionsWithNotes: number;
  averageEnergy: number | null;
  averageFocus: number | null;
  lowEnergyCount: number;
  highEnergyCount: number;
  lowFocusCount: number;
  highFocusCount: number;
  recentNotes: StudyPlanCheckInNoteRecord[];
}

export interface StudyPlanAdherenceMetrics {
  windowStart: string;
  windowEnd: string;
  sessionsPlanned: number;
  sessionsDone: number;
  sessionsSkipped: number;
  sessionsPending: number;
  completionRate: number;
  adherenceRate: number;
  totalPlannedMinutes: number;
  completedMinutes: number;
  skippedMinutes: number;
  pendingMinutes: number;
  checkInTrends: StudyPlanSessionCheckInTrends;
}

export type ContentRecommendationTargetType = "deadline" | "lecture";
export type ContentRecommendationPlatform = "youtube" | "x";

export interface ContentRecommendationTarget {
  type: ContentRecommendationTargetType;
  id: string;
  course: string;
  title: string;
  dueDate?: string;
  startTime?: string;
  priority?: Priority;
}

export interface ContentRecommendationContent {
  platform: ContentRecommendationPlatform;
  id: string;
  title: string;
  description: string;
  author: string;
  url: string;
  publishedAt: string;
  engagement: number;
}

export interface ContentRecommendation {
  id: string;
  target: ContentRecommendationTarget;
  content: ContentRecommendationContent;
  score: number;
  matchedKeywords: string[];
  reason: string;
}

export interface ContentRecommendationsResult {
  generatedAt: string;
  horizonDays: number;
  summary: {
    targetsConsidered: number;
    candidatesConsidered: number;
    recommendationsReturned: number;
  };
  recommendations: ContentRecommendation[];
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

export interface DailyJournalSummary {
  date: string;
  generatedAt: string;
  summary: string;
  highlights: string[];
  journalEntryCount: number;
  chatMessageCount: number;
}

export interface AnalyticsCoachMetrics {
  deadlinesDue: number;
  deadlinesCompleted: number;
  openHighPriorityDeadlines: number;
  habitsTracked: number;
  habitsCompletedToday: number;
  averageHabitCompletion7d: number;
  goalsTracked: number;
  goalsCompletedToday: number;
  journalEntries: number;
  userReflections: number;
  studySessionsPlanned: number;
  studySessionsDone: number;
  studyCompletionRate: number;
  dominantEnergy: UserContext["energyLevel"] | null;
  dominantStress: UserContext["stressLevel"] | null;
}

export interface AnalyticsCoachInsight {
  periodDays: 7 | 14 | 30;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  source: "gemini" | "fallback";
  summary: string;
  strengths: string[];
  risks: string[];
  recommendations: string[];
  metrics: AnalyticsCoachMetrics;
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

export type IntegrationSyncName = "tp" | "canvas" | "gmail";
export type IntegrationSyncAttemptStatus = "success" | "failure";
export type IntegrationSyncRootCause = "none" | "auth" | "network" | "rate_limit" | "validation" | "provider" | "unknown";

export interface IntegrationSyncAttempt {
  id: string;
  integration: IntegrationSyncName;
  status: IntegrationSyncAttemptStatus;
  latencyMs: number;
  rootCause: IntegrationSyncRootCause;
  errorMessage: string | null;
  attemptedAt: string;
}

export interface IntegrationSyncSummary {
  generatedAt: string;
  windowHours: number;
  totals: {
    attempts: number;
    successes: number;
    failures: number;
    successRate: number;
  };
  integrations: Array<{
    integration: IntegrationSyncName;
    attempts: number;
    successes: number;
    failures: number;
    successRate: number;
    averageLatencyMs: number;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    failuresByRootCause: Record<IntegrationSyncRootCause, number>;
  }>;
}

// Canvas LMS types
export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
  workflow_state: "available" | "completed" | "unpublished" | "deleted";
  enrollments?: Array<{ type: string; role: string }>;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  description: string | null;
  due_at: string | null;
  points_possible: number | null;
  course_id: number;
  submission_types: string[];
  has_submitted_submissions: boolean;
  submission?: {
    workflow_state: "submitted" | "unsubmitted" | "graded" | "pending_review";
    score: number | null;
    grade: string | null;
    submitted_at: string | null;
  };
}

export interface CanvasModule {
  id: number;
  name: string;
  position: number;
  unlock_at: string | null;
  require_sequential_progress: boolean;
  state: "locked" | "unlocked" | "started" | "completed";
}

export interface CanvasAnnouncement {
  id: number;
  title: string;
  message: string;
  posted_at: string;
  author: {
    display_name: string;
  };
  context_code: string;
}

export interface CanvasData {
  courses: CanvasCourse[];
  assignments: CanvasAssignment[];
  modules: CanvasModule[];
  announcements: CanvasAnnouncement[];
  lastSyncedAt: string | null;
}

export interface GitHubCourseRepository {
  owner: string;
  repo: string;
  courseCode: string;
}

export interface GitHubCourseDocument {
  id: string;
  courseCode: string;
  owner: string;
  repo: string;
  path: string;
  url: string;
  title: string;
  summary: string;
  highlights: string[];
  snippet: string;
  syncedAt: string;
}

export interface GitHubCourseData {
  repositories: GitHubCourseRepository[];
  documents: GitHubCourseDocument[];
  deadlinesSynced: number;
  lastSyncedAt: string | null;
}

// Gmail types
export interface GmailMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  labels: string[];
  isRead: boolean;
}

export interface GmailData {
  messages: GmailMessage[];
  lastSyncedAt: string;
}

export interface GmailSyncResult {
  success: boolean;
  messagesCount: number;
  error?: string;
}

export interface YouTubeData {
  channels: Array<{
    id: string;
    title: string;
    description: string;
    thumbnailUrl: string;
    subscriberCount: number;
  }>;
  videos: Array<{
    id: string;
    channelId: string;
    channelTitle: string;
    title: string;
    description: string;
    publishedAt: string;
    thumbnailUrl: string;
    duration: string;
    viewCount: number;
    likeCount: number;
    commentCount: number;
  }>;
  lastSyncedAt: string | null;
}

export interface XData {
  tweets: Array<{
    id: string;
    text: string;
    authorId: string;
    authorUsername: string;
    authorName: string;
    createdAt: string;
    likeCount: number;
    retweetCount: number;
    replyCount: number;
    conversationId: string;
  }>;
  lastSyncedAt: string | null;
}
