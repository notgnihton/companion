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

export interface StudyPlanGeneratePayload {
  horizonDays?: number;
  minSessionMinutes?: number;
  maxSessionMinutes?: number;
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
  canvasToken?: string;
  tpCredentials?: {
    courseIds: string[];
    semester: string;
  };
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
  history: {
    messages: ChatMessage[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
  workflow_state: "available" | "completed" | "unpublished" | "deleted";
}

export interface CanvasStatus {
  baseUrl: string;
  lastSyncedAt: string | null;
  courses: CanvasCourse[];
}

export interface CanvasSettings {
  baseUrl: string;
  token: string;
}

export interface CanvasSyncResult {
  success: boolean;
  coursesCount: number;
  assignmentsCount: number;
  modulesCount: number;
  announcementsCount: number;
  error?: string;
}

export interface TPStatus {
  lastSyncedAt: string | null;
  eventsCount: number;
  isSyncing: boolean;
  error?: string;
}

export interface TPSyncResult {
  success: boolean;
  eventsProcessed: number;
  lecturesCreated: number;
  lecturesUpdated: number;
  lecturesDeleted: number;
  error?: string;
}

export interface GeminiStatus {
  apiConfigured: boolean;
  model: string;
  rateLimitRemaining: number;
  lastRequestAt: string | null;
  error?: string;
}

export interface SocialVideo {
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
}

export interface SocialTweet {
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
}

export interface SocialMediaFeed {
  youtube: {
    videos: SocialVideo[];
    lastSyncedAt: string | null;
  };
  x: {
    tweets: SocialTweet[];
    lastSyncedAt: string | null;
  };
}

export interface SocialMediaSyncStatus {
  success: boolean;
  videosCount?: number;
  tweetsCount?: number;
  error?: string;
}

export interface SocialMediaSyncResult {
  youtube: SocialMediaSyncStatus;
  x: SocialMediaSyncStatus;
  syncedAt: string;
}

export interface ContentRecommendationTarget {
  type: "deadline" | "lecture";
  id: string;
  course: string;
  title: string;
  dueDate?: string;
  startTime?: string;
  priority?: Priority;
}

export interface ContentRecommendationItem {
  platform: "youtube" | "x";
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
  content: ContentRecommendationItem;
  score: number;
  matchedKeywords: string[];
  reason: string;
}

export interface ContentRecommendationsResponse {
  generatedAt: string;
  horizonDays: number;
  summary: {
    targetsConsidered: number;
    candidatesConsidered: number;
    recommendationsReturned: number;
  };
  recommendations: ContentRecommendation[];
}
