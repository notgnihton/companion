import { AgentEvent, Notification, Priority, UserContext } from "./types.js";

type NudgeNotification = Omit<Notification, "id" | "timestamp">;

export function buildContextAwareNudge(event: AgentEvent, context: UserContext): NudgeNotification | null {
  switch (event.eventType) {
    case "assignment.deadline":
      return {
        source: "assignment-tracker",
        title: "Deadline alert",
        message: assignmentMessage(event, context),
        priority: assignmentPriority(event.priority, context)
      };
    case "assignment.overdue":
      return {
        source: "assignment-tracker",
        title: "Deadline passed",
        message: overdueMessage(event, context),
        priority: overduePriority(event.priority, context)
      };
    case "lecture.reminder":
      return {
        source: "lecture-plan",
        title: "Lecture reminder",
        message: lectureMessage(event, context),
        priority: lecturePriority(event.priority, context)
      };
    case "note.prompt":
      return {
        source: "notes",
        title: "Journal prompt",
        message: noteMessage(event, context),
        priority: notePriority(context)
      };
    default:
      return null;
  }
}

function assignmentMessage(event: AgentEvent, context: UserContext): string {
  const task = asText(event.payload, "task");
  const course = asText(event.payload, "course");
  const base = `${task} for ${course} is approaching.`;

  if (context.stressLevel === "high") {
    return `${base} One step at a time is enough.`;
  }

  if (context.mode === "focus") {
    return `${base} Lock in one focused block on it now.`;
  }

  if (context.energyLevel === "low") {
    return `${base} Start with a 10-minute setup pass.`;
  }

  return `${base} A short check-in now will keep you ahead.`;
}

function lectureMessage(event: AgentEvent, context: UserContext): string {
  const title = asText(event.payload, "title");
  const minutesUntil = asText(event.payload, "minutesUntil");
  const base = `${title} starts in ${minutesUntil} min`;

  if (context.mode === "recovery") {
    return `${base}. Keep the prep light and easy.`;
  }

  if (context.mode === "focus") {
    return `${base}. Wrap current work and transition cleanly.`;
  }

  return `${base}.`;
}

function noteMessage(event: AgentEvent, context: UserContext): string {
  const prompt = asText(event.payload, "prompt");

  if (context.stressLevel === "high") {
    return `Quick reset: ${prompt}`;
  }

  if (context.mode === "focus") {
    return `Capture one concise update: ${prompt}`;
  }

  return prompt;
}

function assignmentPriority(base: Priority, context: UserContext): Priority {
  if (base === "critical") {
    return "critical";
  }

  if (context.mode === "focus" && context.energyLevel === "high" && base === "medium") {
    return "high";
  }

  if (context.stressLevel === "high" && base === "high") {
    return "medium";
  }

  return base;
}

function lecturePriority(base: Priority, context: UserContext): Priority {
  if (context.mode === "focus" && base === "low") {
    return "medium";
  }

  if (context.stressLevel === "high" && base === "high") {
    return "medium";
  }

  return base;
}

function notePriority(context: UserContext): Priority {
  if (context.mode === "focus") {
    return "medium";
  }

  return "low";
}

function asText(value: unknown, key: string): string {
  if (value && typeof value === "object" && key in value) {
    const parsed = (value as Record<string, unknown>)[key];
    return String(parsed);
  }

  return "n/a";
}

function overdueMessage(event: AgentEvent, context: UserContext): string {
  const task = asText(event.payload, "task");
  const course = asText(event.payload, "course");
  const base = `${task} for ${course} is now overdue.`;

  if (context.stressLevel === "high") {
    return `${base} No pressure — just confirm: done or still working?`;
  }

  if (context.mode === "focus") {
    return `${base} Quick check-in: is this complete or still in progress?`;
  }

  if (context.energyLevel === "low") {
    return `${base} When you have a moment, let me know if this is done.`;
  }

  return `${base} Can you confirm the status?`;
}

function overduePriority(base: Priority, context: UserContext): Priority {
  if (context.stressLevel === "high") {
    return "medium";
  }

  if (context.mode === "recovery") {
    return "medium";
  }

  return base;
}
