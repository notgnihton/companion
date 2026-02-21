import { RuntimeStore } from "./store.js";
import { Deadline, Priority } from "./types.js";

export type DeadlineReleaseSource = "canvas" | "github";

function formatDueDateForNotification(dueDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return `${dueDate} 23:59`;
  }

  const parsed = new Date(dueDate);
  if (Number.isNaN(parsed.getTime())) {
    return dueDate;
  }

  return parsed.toISOString().slice(0, 16).replace("T", " ");
}

function classifyDeadlineType(task: string): "assignment" | "exam" {
  return /\bexam\b/i.test(task) ? "exam" : "assignment";
}

function inferNotificationPriority(deadline: Deadline, now: Date): Priority {
  const dueMs = Date.parse(deadline.dueDate);
  if (Number.isNaN(dueMs)) {
    return "medium";
  }

  const hoursUntilDue = (dueMs - now.getTime()) / (60 * 60 * 1000);
  if (hoursUntilDue <= 24) {
    return "high";
  }

  return "medium";
}

export function publishNewDeadlineReleaseNotifications(
  store: RuntimeStore,
  userId: string,
  source: DeadlineReleaseSource,
  deadlines: Deadline[]
): void {
  if (deadlines.length === 0) {
    return;
  }

  const now = new Date();
  for (const deadline of deadlines) {
    if (deadline.completed) {
      continue;
    }

    const releaseType = classifyDeadlineType(deadline.task);
    const dueLabel = formatDueDateForNotification(deadline.dueDate);
    const priority = inferNotificationPriority(deadline, now);

    store.pushNotification(userId, {
      source: "assignment-tracker",
      title: `New ${releaseType} published`,
      message: `${deadline.course}: ${deadline.task} due ${dueLabel}.`,
      priority,
      actions: ["view"],
      url: `/companion/?tab=schedule&deadlineId=${encodeURIComponent(deadline.id)}`,
      metadata: {
        integration: source,
        triggerType: "new-deadline-release",
        deadlineId: deadline.id,
        course: deadline.course,
        task: deadline.task,
        dueDate: deadline.dueDate
      }
    });
  }
}

