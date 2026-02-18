export type AgentName =
  | "notes"
  | "lecture-plan"
  | "assignment-tracker"
  | "orchestrator";

export type Priority = "low" | "medium" | "high" | "critical";
export type EffortConfidence = "low" | "medium" | "high";

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
  location?: string;
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
  effortHoursRemaining?: number;
  effortConfidence?: EffortConfidence;
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

export type NutritionMealType = "breakfast" | "lunch" | "dinner" | "snack" | "other";

export interface NutritionMealItem {
  id?: string;
  name: string;
  quantity: number;
  unitLabel: string;
  caloriesPerUnit: number;
  proteinGramsPerUnit: number;
  carbsGramsPerUnit: number;
  fatGramsPerUnit: number;
  customFoodId?: string;
}

export interface NutritionMeal {
  id: string;
  name: string;
  mealType: NutritionMealType;
  consumedAt: string;
  items: NutritionMealItem[];
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  notes?: string;
  createdAt: string;
}

export interface NutritionCustomFood {
  id: string;
  name: string;
  unitLabel: string;
  caloriesPerUnit: number;
  proteinGramsPerUnit: number;
  carbsGramsPerUnit: number;
  fatGramsPerUnit: number;
  createdAt: string;
  updatedAt: string;
}

export interface NutritionTargetProfile {
  date: string;
  weightKg?: number;
  maintenanceCalories?: number;
  surplusCalories?: number;
  targetCalories?: number;
  targetProteinGrams?: number;
  targetCarbsGrams?: number;
  targetFatGrams?: number;
  createdAt: string;
  updatedAt: string;
}

export interface NutritionDailySummary {
  date: string;
  totals: {
    calories: number;
    proteinGrams: number;
    carbsGrams: number;
    fatGrams: number;
  };
  targetProfile: NutritionTargetProfile | null;
  remainingToTarget: {
    calories: number;
    proteinGrams: number;
    carbsGrams: number;
    fatGrams: number;
  } | null;
  mealsLogged: number;
  meals: NutritionMeal[];
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
  timezone?: string;
  nudgeTone?: "gentle" | "balanced" | "direct";
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

export type SyncOperationType =
  | "journal"
  | "deadline"
  | "context"
  | "habit-checkin"
  | "goal-checkin"
  | "schedule-update";

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

export type ChatCitationType =
  | "schedule"
  | "deadline"
  | "journal"
  | "habit"
  | "goal"
  | "nutrition-meal"
  | "nutrition-custom-food"
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

export type ChatActionType =
  | "complete-deadline"
  | "snooze-deadline"
  | "create-schedule-block"
  | "update-schedule-block"
  | "delete-schedule-block"
  | "clear-schedule-window"
  | "create-journal-draft"
  | "create-habit"
  | "update-habit"
  | "create-goal"
  | "update-goal";

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

export interface ChatMessageMetadata {
  pendingActions?: ChatPendingAction[];
  actionExecution?: ChatActionExecution;
  citations?: ChatCitation[];
  attachments?: ChatImageAttachment[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  streaming?: boolean;
  metadata?: ChatMessageMetadata;
}

export interface SendChatMessageRequest {
  message: string;
  attachments?: ChatImageAttachment[];
}

export interface SendChatMessageResponse {
  message: ChatMessage;
  citations?: ChatCitation[];
}

export interface SendChatMessageStreamDoneResponse {
  reply: string;
  message: ChatMessage;
  userMessage: ChatMessage;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  citations?: ChatCitation[];
}

export type AuthRole = "admin" | "user";

export interface AuthUser {
  id: string;
  email: string;
  role: AuthRole;
  createdAt: string;
  updatedAt: string;
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
  appliedScope?: {
    semester: string;
    courseIds: string[];
    pastDays: number;
    futureDays: number;
  };
  error?: string;
}

export interface IntegrationScopeSettings {
  semester: string;
  tpCourseIds: string[];
  canvasCourseIds: number[];
  pastDays: number;
  futureDays: number;
}

export interface IntegrationScopePreview {
  window: {
    pastDays: number;
    futureDays: number;
    start: string;
    end: string;
  };
  canvas: {
    coursesMatched: number;
    coursesTotal: number;
    assignmentsMatched: number;
    assignmentsTotal: number;
  };
  tp: {
    semester: string;
    courseIdsApplied: string[];
    eventsMatched: number;
    eventsTotal: number;
  };
}

export interface GeminiStatus {
  apiConfigured: boolean;
  model: string;
  rateLimitRemaining: number | null;
  rateLimitSource?: "provider";
  lastRequestAt: string | null;
  error?: string;
}

export type IntegrationSyncName = "tp" | "canvas" | "gmail";
export type IntegrationSyncAttemptStatus = "success" | "failure";
export type IntegrationSyncRootCause = "none" | "auth" | "network" | "rate_limit" | "validation" | "provider" | "unknown";

export interface IntegrationHealthAttempt {
  id: string;
  integration: IntegrationSyncName;
  status: IntegrationSyncAttemptStatus;
  latencyMs: number;
  rootCause: IntegrationSyncRootCause;
  errorMessage: string | null;
  attemptedAt: string;
}

export interface IntegrationHealthSummary {
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
  channelsCount?: number;
  videosCount?: number;
  tweetsCount?: number;
  error?: string;
  errorCode?: string;
  lastSyncedAt?: string | null;
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
