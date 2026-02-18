import {
  CalendarImportPayload,
  CalendarImportPreview,
  CalendarImportResult,
  ChatMessage,
  DashboardSnapshot,
  LectureEvent,
  Deadline,
  StudyPlan,
  StudyPlanSessionRecord,
  StudyPlanSessionStatus,
  StudyPlanAdherenceMetrics,
  StudyPlanGeneratePayload,
  Goal,
  Habit,
  NutritionCustomFood,
  NutritionDailySummary,
  NutritionMealItem,
  NutritionMeal,
  NutritionTargetProfile,
  DeadlineStatusConfirmation,
  JournalEntry,
  JournalSyncPayload,
  NotificationInteraction,
  NotificationPreferences,
  SendChatMessageRequest,
  SendChatMessageResponse,
  SendChatMessageStreamDoneResponse,
  GetChatHistoryResponse,
  AuthUser,
  UserContext,
  WeeklySummary,
  SyncQueueStatus,
  CanvasSettings,
  CanvasStatus,
  CanvasSyncResult,
  TPSyncResult,
  IntegrationScopePreview,
  GeminiStatus,
  IntegrationHealthAttempt,
  IntegrationHealthSummary,
  IntegrationSyncAttemptStatus,
  IntegrationSyncName,
  SocialMediaFeed,
  SocialMediaSyncResult,
  ContentRecommendationsResponse,
  DailyJournalSummary,
  AnalyticsCoachInsight
} from "../types";
import {
  JournalQueueItem,
  SyncQueueItem,
  enqueueSyncOperation,
  loadCanvasSettings,
  loadCanvasStatus,
  loadContext,
  loadDashboard,
  loadDeadlines,
  loadSchedule,
  loadSocialMediaCache,
  loadStudyPlanCache,
  loadGoals,
  loadHabits,
  loadJournalEntries,
  loadNotificationPreferences,
  loadSyncQueue,
  removeJournalQueueItem,
  removeSyncQueueItem,
  saveCanvasSettings,
  saveCanvasStatus,
  clearAuthToken,
  loadAuthToken,
  saveAuthToken,
  saveContext,
  saveDashboard,
  saveDeadlines,
  saveSchedule,
  saveSocialMediaCache,
  saveStudyPlanCache,
  saveGoals,
  saveHabits,
  saveJournalEntries,
  saveNotificationPreferences
} from "./storage";
import { apiUrl } from "./config";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export interface AuthStatusResponse {
  required: boolean;
}

export interface AuthSessionResponse {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

export interface AuthMeResponse {
  user: AuthUser;
}

function buildRequestHeaders(existing?: HeadersInit): HeadersInit {
  const token = loadAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (!existing) {
    return headers;
  }

  return {
    ...headers,
    ...(Array.isArray(existing)
      ? Object.fromEntries(existing)
      : existing instanceof Headers
        ? Object.fromEntries(existing.entries())
        : existing)
  };
}

async function jsonOrThrow<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const url = typeof input === "string" ? apiUrl(input) : input;
  const response = await fetch(url, {
    ...init,
    headers: buildRequestHeaders(init?.headers)
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) {
      throw new UnauthorizedError(body || "Unauthorized");
    }
    throw new Error(body || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body = await response.text();
  if (!body) {
    return undefined as T;
  }

  return JSON.parse(body) as T;
}

function normalizeJournalEntry(entry: JournalEntry): JournalEntry {
  return {
    ...entry,
    text: entry.text ?? entry.content,
    photos: entry.photos ?? []
  };
}

function saveMergedJournalEntry(entry: JournalEntry): void {
  const normalized = normalizeJournalEntry(entry);
  const existing = loadJournalEntries();
  const byClientId = new Map<string, JournalEntry>();

  existing.forEach((item) => {
    byClientId.set(item.clientEntryId ?? item.id, normalizeJournalEntry(item));
  });
  byClientId.set(normalized.clientEntryId ?? normalized.id, normalized);

  saveJournalEntries(
    Array.from(byClientId.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  );
}

export interface SyncableMutationResult<T> {
  item: T | null;
  queued: boolean;
}

export async function getAuthStatus(): Promise<AuthStatusResponse> {
  return await jsonOrThrow<AuthStatusResponse>("/api/auth/status", {
    method: "GET"
  });
}

export async function login(email: string, password: string): Promise<AuthSessionResponse> {
  const session = await jsonOrThrow<AuthSessionResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      password
    })
  });
  saveAuthToken(session.token);
  return session;
}

export async function getAuthMe(): Promise<AuthMeResponse> {
  return await jsonOrThrow<AuthMeResponse>("/api/auth/me", {
    method: "GET"
  });
}

export async function logout(): Promise<void> {
  try {
    await jsonOrThrow<unknown>("/api/auth/logout", {
      method: "POST"
    });
  } finally {
    clearAuthToken();
  }
}

export async function getDashboard(): Promise<DashboardSnapshot> {
  try {
    const snapshot = await jsonOrThrow<DashboardSnapshot>("/api/dashboard");
    saveDashboard(snapshot);
    return snapshot;
  } catch {
    return loadDashboard();
  }
}

export async function updateContext(payload: Partial<UserContext>): Promise<{ context: UserContext }> {
  try {
    return await jsonOrThrow<{ context: UserContext }>("/api/context", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  } catch {
    // Queue for background sync
    enqueueSyncOperation("context", payload);

    const current = loadContext();
    const merged = { ...current, ...payload };
    saveContext(merged);
    return { context: merged };
  }
}

export async function submitJournalEntry(
  content: string,
  clientEntryId: string,
  tags?: string[],
  photos?: JournalSyncPayload["photos"]
): Promise<JournalEntry | null> {
  try {
    const response = await jsonOrThrow<{ entry: JournalEntry }>("/api/journal", {
      method: "POST",
      body: JSON.stringify({ content, clientEntryId, tags, photos })
    });
    saveMergedJournalEntry(response.entry);
    return normalizeJournalEntry(response.entry);
  } catch {
    return null;
  }
}

export async function getJournalEntries(limit?: number): Promise<JournalEntry[] | null> {
  const params = new URLSearchParams();
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    params.set("limit", String(Math.round(limit)));
  }

  const query = params.toString();
  const endpoint = query ? `/api/journal?${query}` : "/api/journal";

  try {
    const response = await jsonOrThrow<{ entries: JournalEntry[] }>(endpoint);
    const normalized = response.entries.map((entry) => normalizeJournalEntry(entry));
    saveJournalEntries(normalized);
    return normalized;
  } catch {
    return null;
  }
}

export async function getDailyJournalSummary(options: { date?: string; forceRefresh?: boolean } = {}): Promise<DailyJournalSummary | null> {
  const params = new URLSearchParams();
  if (options.date) {
    params.set("date", options.date);
  }
  if (options.forceRefresh) {
    params.set("force", "1");
  }
  const query = params.toString();
  const endpoint = query ? `/api/journal/daily-summary?${query}` : "/api/journal/daily-summary";

  try {
    const response = await jsonOrThrow<{ summary: DailyJournalSummary }>(endpoint);
    return response.summary;
  } catch {
    return null;
  }
}

export async function getAnalyticsCoachInsight(
  periodDays: 7 | 14 | 30,
  options: { forceRefresh?: boolean } = {}
): Promise<AnalyticsCoachInsight | null> {
  const params = new URLSearchParams();
  params.set("periodDays", String(periodDays));
  if (options.forceRefresh) {
    params.set("force", "1");
  }
  const endpoint = `/api/analytics/coach?${params.toString()}`;

  try {
    const response = await jsonOrThrow<{ insight: AnalyticsCoachInsight }>(endpoint);
    return response.insight;
  } catch {
    return null;
  }
}

export async function syncQueuedJournalEntries(queue: JournalQueueItem[]): Promise<number> {
  if (queue.length === 0) {
    return 0;
  }

  try {
    const payload: JournalSyncPayload[] = queue.map((item) => ({
      clientEntryId: item.clientEntryId,
      content: item.content,
      timestamp: item.timestamp,
      baseVersion: item.baseVersion,
      tags: item.tags,
      photos: item.photos
    }));

    const response = await jsonOrThrow<{ applied: Array<JournalEntry>; conflicts: Array<JournalEntry> }>(
      "/api/journal/sync",
      {
        method: "POST",
        body: JSON.stringify({ entries: payload })
      }
    );

    for (const entry of response.applied) {
      removeJournalQueueItem(entry.clientEntryId ?? "");
    }

    if (response.applied.length > 0) {
      const current = loadJournalEntries();
      const byClientId = new Map(current.map((entry) => [entry.clientEntryId, entry]));

      for (const applied of response.applied) {
        if (applied.clientEntryId) {
          byClientId.set(applied.clientEntryId, {
            ...applied,
            text: applied.content,
            photos: applied.photos ?? []
          });
        }
      }

      saveJournalEntries(
        Array.from(byClientId.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      );
    }

    return response.applied.length;
  } catch {
    return 0;
  }
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    const response = await jsonOrThrow<{ preferences: NotificationPreferences }>("/api/notification-preferences");
    saveNotificationPreferences(response.preferences);
    return response.preferences;
  } catch {
    return loadNotificationPreferences();
  }
}

export async function updateNotificationPreferences(
  payload: Partial<NotificationPreferences>
): Promise<NotificationPreferences> {
  try {
    const response = await jsonOrThrow<{ preferences: NotificationPreferences }>("/api/notification-preferences", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    saveNotificationPreferences(response.preferences);
    return response.preferences;
  } catch {
    const current = loadNotificationPreferences();
    const merged: NotificationPreferences = {
      ...current,
      ...payload,
      quietHours: {
        ...current.quietHours,
        ...(payload.quietHours ?? {})
      },
      categoryToggles: {
        ...current.categoryToggles,
        ...(payload.categoryToggles ?? {})
      }
    };
    saveNotificationPreferences(merged);
    return merged;
  }
}

export async function previewCalendarImport(payload: CalendarImportPayload): Promise<CalendarImportPreview> {
  return await jsonOrThrow<CalendarImportPreview>("/api/calendar/import/preview", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function applyCalendarImport(payload: CalendarImportPayload): Promise<CalendarImportResult> {
  return await jsonOrThrow<CalendarImportResult>("/api/calendar/import", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getSchedule(): Promise<LectureEvent[]> {
  try {
    const response = await jsonOrThrow<{ schedule: LectureEvent[] }>("/api/schedule");
    saveSchedule(response.schedule);
    return response.schedule;
  } catch {
    return loadSchedule();
  }
}

export interface ScheduleUpdatePayload {
  title?: string;
  location?: string | null;
  startTime?: string;
  durationMinutes?: number;
  workload?: "low" | "medium" | "high";
}

export async function updateScheduleBlock(
  scheduleId: string,
  payload: ScheduleUpdatePayload
): Promise<SyncableMutationResult<LectureEvent>> {
  try {
    const response = await jsonOrThrow<{ lecture: LectureEvent }>(`/api/schedule/${scheduleId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    const merged = loadSchedule().map((event) => (event.id === scheduleId ? response.lecture : event));
    saveSchedule(merged);
    return { item: response.lecture, queued: false };
  } catch {
    const schedule = loadSchedule();
    const index = schedule.findIndex((event) => event.id === scheduleId);

    let optimistic: LectureEvent | null = null;
    if (index >= 0) {
      optimistic = {
        ...schedule[index],
        ...(payload.title !== undefined ? { title: payload.title } : {}),
        ...(payload.startTime !== undefined ? { startTime: payload.startTime } : {}),
        ...(payload.durationMinutes !== undefined ? { durationMinutes: payload.durationMinutes } : {}),
        ...(payload.workload !== undefined ? { workload: payload.workload } : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, "location")
          ? { location: payload.location ?? undefined }
          : {})
      };
      const next = [...schedule];
      next[index] = optimistic;
      saveSchedule(next);
    }

    enqueueSyncOperation(
      "schedule-update",
      {
        scheduleId,
        patch: payload
      },
      { dedupeKey: `schedule-update:${scheduleId}` }
    );

    return { item: optimistic, queued: true };
  }
}

export async function getDeadlines(): Promise<Deadline[]> {
  try {
    const response = await jsonOrThrow<{ deadlines: Deadline[] }>("/api/deadlines");
    saveDeadlines(response.deadlines);
    return response.deadlines;
  } catch {
    return loadDeadlines();
  }
}

export async function generateStudyPlan(payload: StudyPlanGeneratePayload): Promise<StudyPlan> {
  try {
    const response = await jsonOrThrow<{ plan: StudyPlan }>("/api/study-plan/generate", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    saveStudyPlanCache(response.plan);
    return response.plan;
  } catch (error) {
    const cachedPlan = loadStudyPlanCache();
    if (cachedPlan) {
      return cachedPlan;
    }
    throw error;
  }
}

export async function getStudyPlanSessions(options?: {
  windowStart?: string;
  windowEnd?: string;
  status?: StudyPlanSessionStatus;
  limit?: number;
}): Promise<StudyPlanSessionRecord[]> {
  const params = new URLSearchParams();
  if (options?.windowStart) {
    params.set("windowStart", options.windowStart);
  }
  if (options?.windowEnd) {
    params.set("windowEnd", options.windowEnd);
  }
  if (options?.status) {
    params.set("status", options.status);
  }
  if (options?.limit !== undefined) {
    params.set("limit", String(options.limit));
  }

  const query = params.toString();
  const endpoint = query ? `/api/study-plan/sessions?${query}` : "/api/study-plan/sessions";

  try {
    const response = await jsonOrThrow<{ sessions: StudyPlanSessionRecord[] }>(endpoint);
    return response.sessions;
  } catch {
    return [];
  }
}

export async function checkInStudyPlanSession(
  sessionId: string,
  status: Exclude<StudyPlanSessionStatus, "pending">,
  payload?: {
    checkedAt?: string;
    energyLevel?: number;
    focusLevel?: number;
    checkInNote?: string;
  }
): Promise<StudyPlanSessionRecord | null> {
  try {
    const response = await jsonOrThrow<{ session: StudyPlanSessionRecord }>(
      `/api/study-plan/sessions/${encodeURIComponent(sessionId)}/check-in`,
      {
        method: "POST",
        body: JSON.stringify({
          status,
          checkedAt: payload?.checkedAt,
          energyLevel: payload?.energyLevel,
          focusLevel: payload?.focusLevel,
          checkInNote: payload?.checkInNote
        })
      }
    );
    return response.session;
  } catch {
    return null;
  }
}

export async function getStudyPlanAdherence(options?: {
  windowStart?: string;
  windowEnd?: string;
}): Promise<StudyPlanAdherenceMetrics | null> {
  const params = new URLSearchParams();
  if (options?.windowStart) {
    params.set("windowStart", options.windowStart);
  }
  if (options?.windowEnd) {
    params.set("windowEnd", options.windowEnd);
  }

  const query = params.toString();
  const endpoint = query ? `/api/study-plan/adherence?${query}` : "/api/study-plan/adherence";

  try {
    const response = await jsonOrThrow<{ metrics: StudyPlanAdherenceMetrics }>(endpoint);
    return response.metrics;
  } catch {
    return null;
  }
}

export async function confirmDeadlineStatus(
  deadlineId: string,
  completed: boolean
): Promise<DeadlineStatusConfirmation | null> {
  try {
    const response = await jsonOrThrow<DeadlineStatusConfirmation>(`/api/deadlines/${deadlineId}/confirm-status`, {
      method: "POST",
      body: JSON.stringify({ completed })
    });

    const next = loadDeadlines().map((deadline) =>
      deadline.id === response.deadline.id ? response.deadline : deadline
    );
    saveDeadlines(next);

    return response;
  } catch {
    return null;
  }
}

export async function updateDeadline(
  deadlineId: string,
  payload: Partial<
    Pick<Deadline, "course" | "task" | "dueDate" | "priority" | "completed" | "effortHoursRemaining" | "effortConfidence">
  >
): Promise<Deadline | null> {
  try {
    const response = await jsonOrThrow<{ deadline: Deadline }>(`/api/deadlines/${deadlineId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });

    const next = loadDeadlines().map((deadline) =>
      deadline.id === response.deadline.id ? response.deadline : deadline
    );
    saveDeadlines(next);
    return response.deadline;
  } catch {
    return null;
  }
}

export async function getWeeklySummary(referenceDate?: string): Promise<WeeklySummary | null> {
  const params = new URLSearchParams();
  if (referenceDate) {
    params.set("referenceDate", referenceDate);
  }

  const query = params.toString();
  const endpoint = query ? `/api/weekly-review?${query}` : "/api/weekly-review";

  try {
    const response = await jsonOrThrow<{ summary: WeeklySummary }>(endpoint);
    return response.summary;
  } catch {
    return null;
  }
}

export async function searchJournalEntries(
  query?: string,
  startDate?: string,
  endDate?: string,
  tags?: string[]
): Promise<JournalEntry[] | null> {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  if (startDate) {
    params.set("startDate", startDate);
  }
  if (endDate) {
    params.set("endDate", endDate);
  }
  if (tags && tags.length > 0) {
    params.set("tags", tags.join(","));
  }

  const queryString = params.toString();
  const endpoint = queryString ? `/api/journal/search?${queryString}` : "/api/journal/search";

  try {
    const response = await jsonOrThrow<{ entries: JournalEntry[] }>(endpoint);
    return response.entries;
  } catch {
    return null;
  }
}

export async function getAllJournalTags(): Promise<string[]> {
  try {
    const response = await jsonOrThrow<{ tags: string[] }>("/api/journal/tags");
    return response.tags;
  } catch {
    return [];
  }
}

export async function deleteJournalEntry(entryId: string): Promise<boolean> {
  try {
    const response = await fetch(apiUrl(`/api/journal/${entryId}`), {
      method: "DELETE"
    });
    return response.ok;
  } catch {
    return false;
  }
}

function completionRate(recent: Array<{ completed: boolean }>): number {
  return recent.length === 0 ? 0 : Math.round((recent.filter((c) => c.completed).length / recent.length) * 100);
}

function streakFromRecent(recent: Array<{ completed: boolean }>): number {
  let streak = 0;
  let graceUsed = false;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const offsetFromToday = recent.length - 1 - i;
    if (recent[i].completed) {
      streak += 1;
      continue;
    }
    if (!graceUsed && streak > 0 && offsetFromToday <= 1) {
      graceUsed = true;
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

export async function getHabits(): Promise<Habit[]> {
  try {
    const response = await jsonOrThrow<{ habits: Habit[] }>("/api/habits");
    saveHabits(response.habits);
    return response.habits;
  } catch {
    return loadHabits();
  }
}

export interface HabitUpdatePayload {
  name?: string;
  cadence?: "daily" | "weekly";
  targetPerWeek?: number;
  motivation?: string | null;
}

export async function updateHabit(habitId: string, payload: HabitUpdatePayload): Promise<Habit | null> {
  try {
    const response = await jsonOrThrow<{ habit: Habit }>(`/api/habits/${habitId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    const nextHabits = loadHabits();
    const merged = nextHabits.map((habit) => (habit.id === habitId ? response.habit : habit));
    if (!merged.find((habit) => habit.id === habitId)) {
      merged.push(response.habit);
    }
    saveHabits(merged);
    return response.habit;
  } catch {
    const habits = loadHabits();
    const index = habits.findIndex((habit) => habit.id === habitId);
    if (index === -1) return null;

    const updatedHabit: Habit = {
      ...habits[index],
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.cadence !== undefined ? { cadence: payload.cadence } : {}),
      ...(payload.targetPerWeek !== undefined ? { targetPerWeek: payload.targetPerWeek } : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, "motivation")
        ? { motivation: payload.motivation ?? undefined }
        : {})
    };
    const next = [...habits];
    next[index] = updatedHabit;
    saveHabits(next);
    return updatedHabit;
  }
}

export async function deleteHabit(habitId: string): Promise<boolean> {
  try {
    const response = await fetch(apiUrl(`/api/habits/${habitId}`), {
      method: "DELETE"
    });
    if (!response.ok) {
      return false;
    }
    saveHabits(loadHabits().filter((habit) => habit.id !== habitId));
    return true;
  } catch {
    saveHabits(loadHabits().filter((habit) => habit.id !== habitId));
    return true;
  }
}

export async function toggleHabitCheckIn(
  habitId: string,
  completed?: boolean
): Promise<SyncableMutationResult<Habit>> {
  const body: Record<string, boolean> = {};
  if (completed !== undefined) {
    body.completed = completed;
  }

  try {
    const response = await jsonOrThrow<{ habit: Habit }>(`/api/habits/${habitId}/check-ins`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    const nextHabits = loadHabits();
    const merged = nextHabits.map((habit) => (habit.id === habitId ? response.habit : habit));
    if (!merged.find((h) => h.id === habitId)) {
      merged.push(response.habit);
    }
    saveHabits(merged);
    return { item: response.habit, queued: false };
  } catch {
    const habits = loadHabits();
    const index = habits.findIndex((habit) => habit.id === habitId);
    if (index === -1) {
      return { item: null, queued: false };
    }

    const habit = habits[index];
    const desired = completed ?? !habit.todayCompleted;
    const recentCheckIns = habit.recentCheckIns.map((day, idx) =>
      idx === habit.recentCheckIns.length - 1 ? { ...day, completed: desired } : day
    );
    const offline: Habit = {
      ...habit,
      todayCompleted: desired,
      recentCheckIns,
      completionRate7d: completionRate(recentCheckIns),
      streak: streakFromRecent(recentCheckIns)
    };
    const updated = [...habits];
    updated[index] = offline;
    saveHabits(updated);

    const dateKey = recentCheckIns[recentCheckIns.length - 1]?.date ?? new Date().toISOString().slice(0, 10);
    enqueueSyncOperation(
      "habit-checkin",
      {
        habitId,
        completed: desired,
        date: dateKey
      },
      { dedupeKey: `habit-checkin:${habitId}:${dateKey}` }
    );

    return { item: offline, queued: true };
  }
}

export async function getGoals(): Promise<Goal[]> {
  try {
    const response = await jsonOrThrow<{ goals: Goal[] }>("/api/goals");
    saveGoals(response.goals);
    return response.goals;
  } catch {
    return loadGoals();
  }
}

export interface GoalUpdatePayload {
  title?: string;
  cadence?: "daily" | "weekly";
  targetCount?: number;
  dueDate?: string | null;
  motivation?: string | null;
}

export async function updateGoal(goalId: string, payload: GoalUpdatePayload): Promise<Goal | null> {
  try {
    const response = await jsonOrThrow<{ goal: Goal }>(`/api/goals/${goalId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    const nextGoals = loadGoals();
    const merged = nextGoals.map((goal) => (goal.id === goalId ? response.goal : goal));
    if (!merged.find((goal) => goal.id === goalId)) {
      merged.push(response.goal);
    }
    saveGoals(merged);
    return response.goal;
  } catch {
    const goals = loadGoals();
    const index = goals.findIndex((goal) => goal.id === goalId);
    if (index === -1) return null;

    const updatedGoal: Goal = {
      ...goals[index],
      ...(payload.title !== undefined ? { title: payload.title } : {}),
      ...(payload.cadence !== undefined ? { cadence: payload.cadence } : {}),
      ...(payload.targetCount !== undefined ? { targetCount: payload.targetCount } : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, "dueDate")
        ? { dueDate: payload.dueDate ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, "motivation")
        ? { motivation: payload.motivation ?? undefined }
        : {})
    };

    if (payload.targetCount !== undefined) {
      updatedGoal.remaining = Math.max(payload.targetCount - updatedGoal.progressCount, 0);
    }

    const next = [...goals];
    next[index] = updatedGoal;
    saveGoals(next);
    return updatedGoal;
  }
}

export async function deleteGoal(goalId: string): Promise<boolean> {
  try {
    const response = await fetch(apiUrl(`/api/goals/${goalId}`), {
      method: "DELETE"
    });
    if (!response.ok) {
      return false;
    }
    saveGoals(loadGoals().filter((goal) => goal.id !== goalId));
    return true;
  } catch {
    saveGoals(loadGoals().filter((goal) => goal.id !== goalId));
    return true;
  }
}

export async function toggleGoalCheckIn(
  goalId: string,
  completed?: boolean
): Promise<SyncableMutationResult<Goal>> {
  const body: Record<string, boolean> = {};
  if (completed !== undefined) {
    body.completed = completed;
  }

  try {
    const response = await jsonOrThrow<{ goal: Goal }>(`/api/goals/${goalId}/check-ins`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    const nextGoals = loadGoals();
    const merged = nextGoals.map((goal) => (goal.id === goalId ? response.goal : goal));
    if (!merged.find((g) => g.id === goalId)) {
      merged.push(response.goal);
    }
    saveGoals(merged);
    return { item: response.goal, queued: false };
  } catch {
    const goals = loadGoals();
    const index = goals.findIndex((goal) => goal.id === goalId);
    if (index === -1) {
      return { item: null, queued: false };
    }

    const goal = goals[index];
    const desired = completed ?? !goal.todayCompleted;
    const progressDelta = desired === goal.todayCompleted ? 0 : desired ? 1 : -1;
    const recentCheckIns = goal.recentCheckIns.map((day, idx) =>
      idx === goal.recentCheckIns.length - 1 ? { ...day, completed: desired } : day
    );
    const progressCount = Math.max(0, goal.progressCount + progressDelta);
    const offline: Goal = {
      ...goal,
      todayCompleted: desired,
      recentCheckIns,
      progressCount,
      remaining: Math.max(goal.targetCount - progressCount, 0),
      completionRate7d: completionRate(recentCheckIns),
      streak: streakFromRecent(recentCheckIns)
    };
    const updated = [...goals];
    updated[index] = offline;
    saveGoals(updated);

    const dateKey = recentCheckIns[recentCheckIns.length - 1]?.date ?? new Date().toISOString().slice(0, 10);
    enqueueSyncOperation(
      "goal-checkin",
      {
        goalId,
        completed: desired,
        date: dateKey
      },
      { dedupeKey: `goal-checkin:${goalId}:${dateKey}` }
    );

    return { item: offline, queued: true };
  }
}

export interface NutritionMealCreatePayload {
  name: string;
  mealType?: "breakfast" | "lunch" | "dinner" | "snack" | "other";
  consumedAt?: string;
  items: Array<Omit<NutritionMealItem, "id">>;
  calories?: number;
  proteinGrams?: number;
  carbsGrams?: number;
  fatGrams?: number;
  notes?: string;
}

export interface NutritionMealUpdatePayload {
  name?: string;
  mealType?: "breakfast" | "lunch" | "dinner" | "snack" | "other";
  consumedAt?: string;
  items?: Array<Omit<NutritionMealItem, "id">>;
  calories?: number;
  proteinGrams?: number;
  carbsGrams?: number;
  fatGrams?: number;
  notes?: string;
}

export interface NutritionCustomFoodCreatePayload {
  name: string;
  unitLabel?: string;
  caloriesPerUnit: number;
  proteinGramsPerUnit?: number;
  carbsGramsPerUnit?: number;
  fatGramsPerUnit?: number;
}

export interface NutritionCustomFoodUpdatePayload {
  name?: string;
  unitLabel?: string;
  caloriesPerUnit?: number;
  proteinGramsPerUnit?: number;
  carbsGramsPerUnit?: number;
  fatGramsPerUnit?: number;
}

export interface NutritionTargetProfileUpsertPayload {
  date?: string;
  weightKg?: number | null;
  maintenanceCalories?: number | null;
  surplusCalories?: number | null;
  targetCalories?: number | null;
  targetProteinGrams?: number | null;
  targetCarbsGrams?: number | null;
  targetFatGrams?: number | null;
}

export async function getNutritionSummary(date?: string): Promise<NutritionDailySummary | null> {
  const params = new URLSearchParams();
  if (date) {
    params.set("date", date);
  }

  const query = params.toString();
  const endpoint = query ? `/api/nutrition/summary?${query}` : "/api/nutrition/summary";

  try {
    const response = await jsonOrThrow<{ summary: NutritionDailySummary }>(endpoint);
    return response.summary;
  } catch {
    return null;
  }
}

export async function getNutritionTargetProfile(date?: string): Promise<NutritionTargetProfile | null> {
  const params = new URLSearchParams();
  if (date) {
    params.set("date", date);
  }

  const query = params.toString();
  const endpoint = query ? `/api/nutrition/targets?${query}` : "/api/nutrition/targets";

  try {
    const response = await jsonOrThrow<{ profile: NutritionTargetProfile | null }>(endpoint);
    return response.profile;
  } catch {
    return null;
  }
}

export async function upsertNutritionTargetProfile(
  payload: NutritionTargetProfileUpsertPayload
): Promise<NutritionTargetProfile | null> {
  try {
    const response = await jsonOrThrow<{ profile: NutritionTargetProfile }>("/api/nutrition/targets", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    return response.profile;
  } catch {
    return null;
  }
}

export async function getNutritionCustomFoods(options: {
  query?: string;
  limit?: number;
} = {}): Promise<NutritionCustomFood[]> {
  const params = new URLSearchParams();
  if (options.query) params.set("query", options.query);
  if (typeof options.limit === "number") params.set("limit", String(Math.round(options.limit)));
  const query = params.toString();
  const endpoint = query ? `/api/nutrition/custom-foods?${query}` : "/api/nutrition/custom-foods";

  try {
    const response = await jsonOrThrow<{ foods: NutritionCustomFood[] }>(endpoint);
    return response.foods;
  } catch {
    return [];
  }
}

export async function createNutritionCustomFood(
  payload: NutritionCustomFoodCreatePayload
): Promise<NutritionCustomFood | null> {
  try {
    const response = await jsonOrThrow<{ food: NutritionCustomFood }>("/api/nutrition/custom-foods", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return response.food;
  } catch {
    return null;
  }
}

export async function updateNutritionCustomFood(
  foodId: string,
  payload: NutritionCustomFoodUpdatePayload
): Promise<NutritionCustomFood | null> {
  try {
    const response = await jsonOrThrow<{ food: NutritionCustomFood }>(`/api/nutrition/custom-foods/${foodId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    return response.food;
  } catch {
    return null;
  }
}

export async function deleteNutritionCustomFood(foodId: string): Promise<boolean> {
  try {
    const response = await fetch(apiUrl(`/api/nutrition/custom-foods/${foodId}`), {
      method: "DELETE"
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getNutritionMeals(options: {
  date?: string;
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<NutritionMeal[]> {
  const params = new URLSearchParams();
  if (options.date) params.set("date", options.date);
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  if (typeof options.limit === "number") params.set("limit", String(Math.round(options.limit)));
  const query = params.toString();
  const endpoint = query ? `/api/nutrition/meals?${query}` : "/api/nutrition/meals";

  try {
    const response = await jsonOrThrow<{ meals: NutritionMeal[] }>(endpoint);
    return response.meals;
  } catch {
    return [];
  }
}

export async function createNutritionMeal(payload: NutritionMealCreatePayload): Promise<NutritionMeal | null> {
  try {
    const response = await jsonOrThrow<{ meal: NutritionMeal }>("/api/nutrition/meals", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return response.meal;
  } catch {
    return null;
  }
}

export async function updateNutritionMeal(
  mealId: string,
  payload: NutritionMealUpdatePayload
): Promise<NutritionMeal | null> {
  try {
    const response = await jsonOrThrow<{ meal: NutritionMeal }>(`/api/nutrition/meals/${mealId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    return response.meal;
  } catch {
    return null;
  }
}

export async function deleteNutritionMeal(mealId: string): Promise<boolean> {
  try {
    const response = await fetch(apiUrl(`/api/nutrition/meals/${mealId}`), {
      method: "DELETE"
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getNotificationInteractions(options?: {
  since?: string;
  until?: string;
  limit?: number;
}): Promise<NotificationInteraction[]> {
  const params = new URLSearchParams();
  if (options?.since) {
    params.set("since", options.since);
  }
  if (options?.until) {
    params.set("until", options.until);
  }
  if (options?.limit) {
    params.set("limit", options.limit.toString());
  }

  const queryString = params.toString();
  const endpoint = queryString ? `/api/notification-interactions?${queryString}` : "/api/notification-interactions";

  try {
    const response = await jsonOrThrow<{ interactions: NotificationInteraction[] }>(endpoint);
    return response.interactions;
  } catch {
    return [];
  }
}

// Background Sync API
export async function processSyncQueue(): Promise<{ processed: number; failed: number }> {
  const queue = loadSyncQueue();

  if (queue.length === 0) {
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (const item of queue) {
    try {
      await jsonOrThrow("/api/sync/queue", {
        method: "POST",
        body: JSON.stringify({
          operationType: item.operationType,
          payload: item.payload
        })
      });
      removeSyncQueueItem(item.id);
      processed += 1;
    } catch {
      failed += 1;
    }
  }

  // Trigger server-side processing
  try {
    await jsonOrThrow("/api/sync/process", {
      method: "POST"
    });
  } catch {
    // Server may process on its own schedule
  }

  return { processed, failed };
}

export async function getSyncQueueStatus(): Promise<{
  status: SyncQueueStatus;
  isProcessing: boolean;
}> {
  const parseQueueStatus = (
    value: unknown
  ): { status: SyncQueueStatus; isProcessing: boolean } | null => {
    if (!value || typeof value !== "object") {
      return null;
    }

    const record = value as Record<string, unknown>;
    const status = record.status as Record<string, unknown> | undefined;
    if (!status || typeof status !== "object") {
      return null;
    }

    const pending = typeof status.pending === "number" ? status.pending : null;
    const processing = typeof status.processing === "number" ? status.processing : null;
    const failed = typeof status.failed === "number" ? status.failed : null;
    const recentItems = Array.isArray(status.recentItems) ? status.recentItems : null;
    const isProcessing = typeof record.isProcessing === "boolean" ? record.isProcessing : false;

    if (pending === null || processing === null || failed === null || recentItems === null) {
      return null;
    }

    return {
      status: {
        pending,
        processing,
        failed,
        recentItems: recentItems as SyncQueueStatus["recentItems"]
      },
      isProcessing
    };
  };

  try {
    const queueStatus = parseQueueStatus(await jsonOrThrow<unknown>("/api/sync/queue-status"));
    if (queueStatus) {
      return queueStatus;
    }
  } catch {
    // fallback to legacy endpoint
  }

  try {
    const legacyStatus = parseQueueStatus(await jsonOrThrow<unknown>("/api/sync/status"));
    if (legacyStatus) {
      return legacyStatus;
    }
  } catch {
    // fallback to local queue
  }

  const queue = loadSyncQueue();
  return {
    status: {
      pending: queue.length,
      processing: 0,
      failed: 0,
      recentItems: []
    },
    isProcessing: false
  };
}

export async function getCanvasStatus(): Promise<CanvasStatus> {
  try {
    const status = await jsonOrThrow<CanvasStatus>("/api/canvas/status");
    saveCanvasStatus(status);

    const currentSettings = loadCanvasSettings();
    if (!currentSettings.baseUrl) {
      saveCanvasSettings({ ...currentSettings, baseUrl: status.baseUrl });
    }

    return status;
  } catch {
    return loadCanvasStatus();
  }
}

export async function getGeminiStatus(): Promise<GeminiStatus> {
  try {
    return await jsonOrThrow<GeminiStatus>("/api/gemini/status");
  } catch {
    return {
      apiConfigured: false,
      model: "unknown",
      rateLimitRemaining: null,
      rateLimitSource: "provider",
      lastRequestAt: null,
      error: "Could not load Gemini status."
    };
  }
}

export interface CanvasSyncScopeOptions {
  courseIds?: number[];
  pastDays?: number;
  futureDays?: number;
}

export async function triggerCanvasSync(
  settings?: CanvasSettings,
  scope?: CanvasSyncScopeOptions
): Promise<CanvasSyncResult> {
  const payload = {
    token: settings?.token?.trim() ? settings.token : undefined,
    baseUrl: settings?.baseUrl?.trim() ? settings.baseUrl : undefined,
    courseIds: scope?.courseIds && scope.courseIds.length > 0 ? scope.courseIds : undefined,
    pastDays: scope?.pastDays,
    futureDays: scope?.futureDays
  };

  try {
    const result = await jsonOrThrow<CanvasSyncResult>("/api/canvas/sync", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await getCanvasStatus();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Canvas sync failed";
    return {
      success: false,
      coursesCount: 0,
      assignmentsCount: 0,
      modulesCount: 0,
      announcementsCount: 0,
      error: message
    };
  }
}

export interface TriggerTPSyncOptions {
  semester?: string;
  courseIds?: string[];
  pastDays?: number;
  futureDays?: number;
}

export async function triggerTPSync(options?: TriggerTPSyncOptions): Promise<TPSyncResult> {
  const payload = options
    ? {
        semester: options.semester?.trim() ? options.semester : undefined,
        courseIds: options.courseIds?.map((value) => value.trim()).filter(Boolean),
        pastDays: options.pastDays,
        futureDays: options.futureDays
      }
    : {};

  try {
    return await jsonOrThrow<TPSyncResult>("/api/sync/tp", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TP sync failed";
    return {
      success: false,
      eventsProcessed: 0,
      lecturesCreated: 0,
      lecturesUpdated: 0,
      lecturesDeleted: 0,
      error: message
    };
  }
}

export interface IntegrationScopePreviewPayload {
  semester?: string;
  tpCourseIds?: string[];
  canvasCourseIds?: number[];
  pastDays?: number;
  futureDays?: number;
}

export async function previewIntegrationScope(payload: IntegrationScopePreviewPayload): Promise<IntegrationScopePreview> {
  const response = await jsonOrThrow<{ preview: IntegrationScopePreview }>("/api/integrations/scope/preview", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.preview;
}

export async function getIntegrationHealthSummary(hours = 24 * 7): Promise<IntegrationHealthSummary> {
  const params = new URLSearchParams();
  params.set("hours", String(hours));

  try {
    return await jsonOrThrow<IntegrationHealthSummary>(`/api/integrations/health-log/summary?${params.toString()}`);
  } catch {
    return {
      generatedAt: new Date().toISOString(),
      windowHours: hours,
      totals: {
        attempts: 0,
        successes: 0,
        failures: 0,
        successRate: 0
      },
      integrations: [
        {
          integration: "tp",
          attempts: 0,
          successes: 0,
          failures: 0,
          successRate: 0,
          averageLatencyMs: 0,
          lastAttemptAt: null,
          lastSuccessAt: null,
          failuresByRootCause: {
            none: 0,
            auth: 0,
            network: 0,
            rate_limit: 0,
            validation: 0,
            provider: 0,
            unknown: 0
          }
        },
        {
          integration: "canvas",
          attempts: 0,
          successes: 0,
          failures: 0,
          successRate: 0,
          averageLatencyMs: 0,
          lastAttemptAt: null,
          lastSuccessAt: null,
          failuresByRootCause: {
            none: 0,
            auth: 0,
            network: 0,
            rate_limit: 0,
            validation: 0,
            provider: 0,
            unknown: 0
          }
        },
        {
          integration: "gmail",
          attempts: 0,
          successes: 0,
          failures: 0,
          successRate: 0,
          averageLatencyMs: 0,
          lastAttemptAt: null,
          lastSuccessAt: null,
          failuresByRootCause: {
            none: 0,
            auth: 0,
            network: 0,
            rate_limit: 0,
            validation: 0,
            provider: 0,
            unknown: 0
          }
        }
      ]
    };
  }
}

export async function getIntegrationHealthLog(options?: {
  integration?: IntegrationSyncName;
  status?: IntegrationSyncAttemptStatus;
  limit?: number;
  hours?: number;
}): Promise<IntegrationHealthAttempt[]> {
  const params = new URLSearchParams();
  if (options?.integration) {
    params.set("integration", options.integration);
  }
  if (options?.status) {
    params.set("status", options.status);
  }
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  if (typeof options?.hours === "number") {
    params.set("hours", String(options.hours));
  }

  const query = params.toString();
  const endpoint = query ? `/api/integrations/health-log?${query}` : "/api/integrations/health-log";

  try {
    const response = await jsonOrThrow<{ attempts: IntegrationHealthAttempt[] }>(endpoint);
    return response.attempts;
  } catch {
    return [];
  }
}

export async function getSocialMediaFeed(): Promise<SocialMediaFeed> {
  try {
    const feed = await jsonOrThrow<SocialMediaFeed>("/api/social-media");
    saveSocialMediaCache(feed);
    return feed;
  } catch (error) {
    const cachedFeed = loadSocialMediaCache();
    if (cachedFeed) {
      return cachedFeed;
    }
    throw error;
  }
}

export async function syncSocialMediaFeed(): Promise<SocialMediaSyncResult> {
  return await jsonOrThrow<SocialMediaSyncResult>("/api/social-media/sync", {
    method: "POST"
  });
}

export async function getContentRecommendations(options?: {
  horizonDays?: number;
  limit?: number;
}): Promise<ContentRecommendationsResponse> {
  const params = new URLSearchParams();
  if (options?.horizonDays !== undefined) {
    params.set("horizonDays", String(options.horizonDays));
  }
  if (options?.limit !== undefined) {
    params.set("limit", String(options.limit));
  }

  const query = params.toString();
  const endpoint = query ? `/api/recommendations/content?${query}` : "/api/recommendations/content";
  return await jsonOrThrow<ContentRecommendationsResponse>(endpoint);
}

export async function sendChatMessage(
  message: string,
  attachments?: SendChatMessageRequest["attachments"]
): Promise<ChatMessage> {
  const response = await jsonOrThrow<SendChatMessageResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message, attachments } as SendChatMessageRequest)
  });
  return response.message;
}

interface ChatStreamHandlers {
  onToken: (delta: string) => void;
}

export async function sendChatMessageStream(
  message: string,
  handlers: ChatStreamHandlers,
  attachments?: SendChatMessageRequest["attachments"]
): Promise<ChatMessage> {
  const response = await fetch(apiUrl("/api/chat/stream"), {
    method: "POST",
    headers: buildRequestHeaders(),
    body: JSON.stringify({ message, attachments } as SendChatMessageRequest)
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) {
      throw new UnauthorizedError(body || "Unauthorized");
    }
    throw new Error(body || `Request failed: ${response.status}`);
  }

  if (!response.body) {
    throw new Error("Streaming response body is not available.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let donePayload: SendChatMessageStreamDoneResponse | null = null;

  const dispatchEvent = (name: string, data: string): void => {
    if (!data) {
      return;
    }

    if (name === "token") {
      try {
        const parsed = JSON.parse(data) as { delta?: unknown };
        if (typeof parsed.delta === "string" && parsed.delta.length > 0) {
          handlers.onToken(parsed.delta);
        }
      } catch {
        // Ignore malformed token events.
      }
      return;
    }

    if (name === "done") {
      donePayload = JSON.parse(data) as SendChatMessageStreamDoneResponse;
      return;
    }

    if (name === "error") {
      let errorMessage = "Chat stream failed.";
      try {
        const parsed = JSON.parse(data) as { error?: unknown };
        if (typeof parsed.error === "string" && parsed.error.length > 0) {
          errorMessage = parsed.error;
        }
      } catch {
        errorMessage = data;
      }
      throw new Error(errorMessage);
    }
  };

  const processBuffer = (): void => {
    while (true) {
      const separatorIndex = buffer.indexOf("\n\n");
      if (separatorIndex === -1) {
        return;
      }

      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const lines = block.split("\n");
      let data = "";
      eventName = "message";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data += line.slice(5).trim();
        }
      }

      dispatchEvent(eventName, data);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    processBuffer();
  }

  buffer += decoder.decode();
  processBuffer();

  const finalPayload = donePayload as SendChatMessageStreamDoneResponse | null;
  if (finalPayload === null) {
    throw new Error("Stream completed without final message payload.");
  }

  return finalPayload.message;
}

export async function getChatHistory(limit = 500, offset = 0): Promise<GetChatHistoryResponse> {
  const targetLimit = Math.max(1, Math.round(limit));
  const targetOffset = Math.max(0, Math.round(offset));
  const pageSize = 50;

  let page = 1;
  let total = 0;
  let hasMore = true;
  const allMessages: ChatMessage[] = [];

  while (hasMore && allMessages.length < targetOffset + targetLimit) {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));

    const response = await jsonOrThrow<GetChatHistoryResponse>(`/api/chat/history?${params.toString()}`);
    const pageMessages = response.history.messages ?? [];

    if (page === 1) {
      total = response.history.total;
    }

    allMessages.push(...pageMessages);
    hasMore = response.history.hasMore && pageMessages.length > 0;
    page += 1;
  }

  const messages = allMessages.slice(targetOffset, targetOffset + targetLimit);

  return {
    history: {
      messages,
      page: 1,
      pageSize: messages.length,
      total,
      hasMore: targetOffset + targetLimit < total
    }
  };
}
