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
  | "update-schedule-block"
  | "delete-schedule-block"
  | "clear-schedule-window"
  | "create-routine-preset"
  | "update-routine-preset"
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

export type ChatCitationType =
  | "schedule"
  | "deadline"
  | "habit"
  | "goal"
  | "nutrition-meal"
  | "nutrition-custom-food"
  | "email"
  | "withings-weight"
  | "withings-sleep"
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

export type ChatMood = "neutral" | "encouraging" | "focused" | "celebratory" | "empathetic" | "urgent";

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
  mood?: ChatMood;
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

export interface ChatLongTermMemory {
  summary: string;
  sourceMessageCount: number;
  totalMessagesAtCompression: number;
  compressedMessageCount: number;
  preservedMessageCount: number;
  fromTimestamp?: string;
  toTimestamp?: string;
  usedModelMode: "live" | "standard" | "fallback";
  updatedAt: string;
}

export type JournalMemoryEntryType =
  | "reflection"
  | "event"
  | "decision"
  | "commitment"
  | "outcome"
  | "health"
  | "food"
  | "schedule-change"
  | "deadline"
  | "email"
  | "habit-goal";

export interface ReflectionEntry {
  id: string;
  entryType: JournalMemoryEntryType;
  event: string;
  feelingStress: string;
  intent: string;
  commitment: string;
  outcome: string;
  salience: number;
  captureReason: string;
  timestamp: string;
  evidenceSnippet: string;
  sourceMessageId: string;
  updatedAt: string;
}

export type AuthRole = "admin" | "user";

export interface AuthUser {
  id: string;
  email: string;
  role: AuthRole;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUserWithPassword extends AuthUser {
  passwordHash: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string;
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
    growthStreak: number;
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
  location?: string;
  startTime: string;
  durationMinutes: number;
  workload: "low" | "medium" | "high";
  recurrence?: RecurrenceRule;
  recurrenceParentId?: string;
}

export interface ScheduleSuggestionMute {
  id: string;
  startTime: string;
  endTime: string;
  createdAt: string;
}

export interface RoutinePreset {
  id: string;
  title: string;
  preferredStartTime: string; // HH:mm (24h)
  durationMinutes: number;
  workload: "low" | "medium" | "high";
  weekdays: number[]; // 0=Sunday ... 6=Saturday
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Deadline {
  id: string;
  course: string;
  task: string;
  dueDate: string;
  sourceDueDate?: string;
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
  streakGraceUsed: boolean;
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
  streakGraceUsed: boolean;
  completionRate7d: number;
  recentCheckIns: Array<{ date: string; completed: boolean }>;
}

export type NutritionMealType = "breakfast" | "lunch" | "dinner" | "snack" | "other";

export interface NutritionMacros {
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
}

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

export interface NutritionMeal extends NutritionMacros {
  id: string;
  name: string;
  mealType: NutritionMealType;
  consumedAt: string;
  items: NutritionMealItem[];
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
  proteinGramsPerLb?: number;
  fatGramsPerLb?: number;
  createdAt: string;
  updatedAt: string;
}

export interface NutritionPlanSnapshotTarget {
  weightKg?: number;
  maintenanceCalories?: number;
  surplusCalories?: number;
  targetCalories?: number;
  targetProteinGrams?: number;
  targetCarbsGrams?: number;
  targetFatGrams?: number;
}

export interface NutritionPlanSnapshotMeal {
  name: string;
  mealType: NutritionMealType;
  consumedTime: string;
  items: Array<Omit<NutritionMealItem, "id">>;
  calories?: number;
  proteinGrams?: number;
  carbsGrams?: number;
  fatGrams?: number;
  notes?: string;
}

export interface NutritionPlanSnapshot {
  id: string;
  name: string;
  sourceDate: string;
  targetProfile: NutritionPlanSnapshotTarget | null;
  meals: NutritionPlanSnapshotMeal[];
  createdAt: string;
  updatedAt: string;
}

export interface NutritionPlanSettings {
  defaultSnapshotId: string | null;
  defaultSnapshotName: string | null;
  updatedAt: string | null;
}

export interface NutritionDailySummary {
  date: string;
  totals: NutritionMacros;
  targetProfile: NutritionTargetProfile | null;
  remainingToTarget: NutritionMacros | null;
  mealsLogged: number;
  meals: NutritionMeal[];
}

export interface NutritionDayHistoryEntry {
  date: string;
  totals: NutritionMacros;
  targets: NutritionMacros | null;
  mealsLogged: number;
  weightKg: number | null;
  fatRatioPercent: number | null;
  muscleMassKg: number | null;
  gymCheckedIn: boolean;
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
  reflectionHighlights: string[];
}

export interface DailyGrowthSummary {
  date: string;
  generatedAt: string;
  summary: string;
  highlights: string[];
  journalEntryCount: number;
  reflectionEntryCount: number;
  chatMessageCount: number;
  visual?: GrowthNarrativeVisual;
}

export interface GrowthNarrativeVisual {
  dataUrl: string;
  mimeType: string;
  alt: string;
  model: string;
  generatedAt: string;
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
  reflectionEntries: number;
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
  visual?: GrowthNarrativeVisual;
}

export interface WeeklyGrowthReview {
  periodDays: 7;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  source: "gemini" | "fallback";
  summary: string;
  strengths: string[];
  risks: string[];
  commitments: string[];
  momentum: {
    scheduleAdherence: number;
    deadlineCompletionRate: number;
    habitCompletionRate: number;
  };
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

export type SyncOperationType =
  | "deadline"
  | "context"
  | "habit-checkin"
  | "goal-checkin"
  | "schedule-update";

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

export type IntegrationSyncName = "tp" | "canvas" | "gmail" | "withings";
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

export interface WithingsWeightEntry {
  measuredAt: string;
  weightKg: number;
  fatRatioPercent?: number;
  fatMassKg?: number;
  muscleMassKg?: number;
}

export interface WithingsSleepSummaryEntry {
  date: string;
  totalSleepSeconds: number;
  deepSleepSeconds?: number;
  lightSleepSeconds?: number;
  remSleepSeconds?: number;
  awakeSeconds?: number;
  sleepEfficiency?: number;
  hrAverage?: number;
  hrMin?: number;
  hrMax?: number;
}

export interface WithingsData {
  weight: WithingsWeightEntry[];
  sleepSummary: WithingsSleepSummaryEntry[];
  lastSyncedAt: string | null;
}

export interface WithingsSyncResult {
  success: boolean;
  weightsCount: number;
  sleepDaysCount: number;
  error?: string;
}
