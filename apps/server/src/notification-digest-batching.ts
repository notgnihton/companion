import type { Notification, ScheduledNotification } from "./types.js";

const DIGEST_SOURCE_LABEL: Record<Notification["source"], string> = {
  "assignment-tracker": "assignment",
  "lecture-plan": "lecture",
  notes: "reflection",
  orchestrator: "companion"
};

const SOURCE_DEEP_LINK_TAB: Record<Notification["source"], string> = {
  "assignment-tracker": "schedule",
  "lecture-plan": "schedule",
  notes: "habits",
  orchestrator: "chat"
};

export function resolveNextDigestWindow(
  referenceTime: Date,
  morningHour: number,
  eveningHour: number
): Date {
  const now = new Date(referenceTime);
  const morning = new Date(now);
  morning.setHours(morningHour, 0, 0, 0);

  const evening = new Date(now);
  evening.setHours(eveningHour, 0, 0, 0);

  if (now <= morning) {
    return morning;
  }

  if (now <= evening) {
    return evening;
  }

  const nextMorning = new Date(morning);
  nextMorning.setDate(nextMorning.getDate() + 1);
  return nextMorning;
}

export function isDigestCandidate(notification: ScheduledNotification): boolean {
  return notification.notification.priority === "low" || notification.notification.priority === "medium";
}

function inferDigestTitle(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) {
    return "Morning digest";
  }
  if (hour >= 17) {
    return "Evening digest";
  }
  return "Daily digest";
}

function dominantSource(notifications: ScheduledNotification[]): Notification["source"] {
  const counts = new Map<Notification["source"], number>();
  for (const scheduled of notifications) {
    const source = scheduled.notification.source;
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }

  let winner: Notification["source"] = "orchestrator";
  let max = -1;

  for (const [source, count] of counts.entries()) {
    if (count > max) {
      winner = source;
      max = count;
    }
  }

  return winner;
}

function summarizeSources(notifications: ScheduledNotification[]): string {
  const counts = new Map<string, number>();
  for (const scheduled of notifications) {
    const label = DIGEST_SOURCE_LABEL[scheduled.notification.source];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const fragments: string[] = [];
  for (const [label, count] of counts.entries()) {
    fragments.push(`${count} ${label}${count === 1 ? "" : "s"}`);
  }

  return fragments.join(", ");
}

function summarizeTitles(notifications: ScheduledNotification[]): string {
  const titles = notifications.map((scheduled) => scheduled.notification.title);
  const preview = titles.slice(0, 3).join(" • ");
  if (titles.length <= 3) {
    return preview;
  }
  return `${preview} • +${titles.length - 3} more`;
}

export function buildDigestNotification(
  notifications: ScheduledNotification[],
  now: Date = new Date()
): Omit<Notification, "id" | "timestamp"> | null {
  if (notifications.length === 0) {
    return null;
  }

  const priority = notifications.some((scheduled) => scheduled.notification.priority === "medium")
    ? "medium"
    : "low";
  const source = dominantSource(notifications);
  const tab = SOURCE_DEEP_LINK_TAB[source];

  return {
    source: "orchestrator",
    title: inferDigestTitle(now),
    message: `${notifications.length} non-urgent updates (${summarizeSources(notifications)}): ${summarizeTitles(notifications)}`,
    priority,
    actions: ["view"],
    url: `/companion/?tab=${tab}`,
    metadata: {
      digestCount: notifications.length,
      digestSources: notifications.map((scheduled) => scheduled.notification.source)
    }
  };
}
