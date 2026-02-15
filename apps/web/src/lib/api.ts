import {
  CalendarImportPayload,
  CalendarImportPreview,
  CalendarImportResult,
  DashboardSnapshot,
  Deadline,
  DeadlineStatusConfirmation,
  JournalEntry,
  JournalSyncPayload,
  NotificationPreferences,
  UserContext,
  WeeklySummary
} from "../types";
import {
  JournalQueueItem,
  loadContext,
  loadDashboard,
  loadDeadlines,
  loadJournalEntries,
  loadNotificationPreferences,
  removeJournalQueueItem,
  saveContext,
  saveDashboard,
  saveDeadlines,
  saveJournalEntries,
  saveNotificationPreferences
} from "./storage";

async function jsonOrThrow<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
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
    const current = loadContext();
    const merged = { ...current, ...payload };
    saveContext(merged);
    return { context: merged };
  }
}

export async function submitJournalEntry(content: string, clientEntryId: string): Promise<JournalEntry | null> {
  try {
    const response = await jsonOrThrow<{ entry: JournalEntry }>("/api/journal", {
      method: "POST",
      body: JSON.stringify({ content, clientEntryId })
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
      baseVersion: item.baseVersion
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
            text: applied.content
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
  endDate?: string
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

  const queryString = params.toString();
  const endpoint = queryString ? `/api/journal/search?${queryString}` : "/api/journal/search";

  try {
    const response = await jsonOrThrow<{ entries: JournalEntry[] }>(endpoint);
    return response.entries;
  } catch {
    return null;
  }
}
