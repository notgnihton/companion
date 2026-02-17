import {
  CalendarImportPayload,
  CalendarImportPreview,
  CalendarImportResult,
  ChatMessage,
  DashboardSnapshot,
  Deadline,
  Goal,
  Habit,
  DeadlineStatusConfirmation,
  JournalEntry,
  JournalSyncPayload,
  NotificationInteraction,
  NotificationPreferences,
  SendChatMessageRequest,
  SendChatMessageResponse,
  GetChatHistoryResponse,
  UserContext,
  WeeklySummary,
  SyncQueueStatus,
  CanvasSettings,
  CanvasStatus,
  CanvasSyncResult,
  SocialMediaFeed,
  SocialMediaSyncResult
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
  loadGoals,
  loadHabits,
  loadJournalEntries,
  loadNotificationPreferences,
  loadSyncQueue,
  removeJournalQueueItem,
  removeSyncQueueItem,
  saveCanvasSettings,
  saveCanvasStatus,
  saveContext,
  saveDashboard,
  saveDeadlines,
  saveGoals,
  saveHabits,
  saveJournalEntries,
  saveNotificationPreferences
} from "./storage";
import { apiUrl } from "./config";

async function jsonOrThrow<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const url = typeof input === "string" ? apiUrl(input) : input;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
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
    return response.entry;
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

export async function getDeadlines(): Promise<Deadline[]> {
  try {
    const response = await jsonOrThrow<{ deadlines: Deadline[] }>("/api/deadlines");
    saveDeadlines(response.deadlines);
    return response.deadlines;
  } catch {
    return loadDeadlines();
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

export async function toggleHabitCheckIn(habitId: string, completed?: boolean): Promise<Habit | null> {
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
    return response.habit;
  } catch {
    const habits = loadHabits();
    const index = habits.findIndex((habit) => habit.id === habitId);
    if (index === -1) return null;

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
    return offline;
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

export async function toggleGoalCheckIn(goalId: string, completed?: boolean): Promise<Goal | null> {
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
    return response.goal;
  } catch {
    const goals = loadGoals();
    const index = goals.findIndex((goal) => goal.id === goalId);
    if (index === -1) return null;

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
    return offline;
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
  try {
    return await jsonOrThrow<{ status: SyncQueueStatus; isProcessing: boolean }>("/api/sync/status");
  } catch {
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

export async function triggerCanvasSync(settings?: CanvasSettings): Promise<CanvasSyncResult> {
  const payload = settings
    ? {
        token: settings.token?.trim() ? settings.token : undefined,
        baseUrl: settings.baseUrl?.trim() ? settings.baseUrl : undefined
      }
    : {};

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

export async function getSocialMediaFeed(): Promise<SocialMediaFeed> {
  return await jsonOrThrow<SocialMediaFeed>("/api/social-media");
}

export async function syncSocialMediaFeed(): Promise<SocialMediaSyncResult> {
  return await jsonOrThrow<SocialMediaSyncResult>("/api/social-media/sync", {
    method: "POST"
  });
}

export async function sendChatMessage(message: string): Promise<ChatMessage> {
  const response = await jsonOrThrow<SendChatMessageResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message } as SendChatMessageRequest)
  });
  return response.message;
}

export async function getChatHistory(limit = 50, offset = 0): Promise<GetChatHistoryResponse> {
  const params = new URLSearchParams();
  params.set("limit", limit.toString());
  params.set("offset", offset.toString());

  return await jsonOrThrow<GetChatHistoryResponse>(`/api/chat/history?${params.toString()}`);
}
