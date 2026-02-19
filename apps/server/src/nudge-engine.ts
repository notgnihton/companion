import { AgentEvent, Notification, Priority, UserContext } from "./types.js";

type NudgeNotification = Omit<Notification, "id" | "timestamp">;

export function buildContextAwareNudge(event: AgentEvent, context: UserContext): NudgeNotification | null {
  switch (event.eventType) {
    case "assignment.deadline": {
      const deadlineId = asOptionalText(event.payload, "deadlineId");
      return {
        source: "assignment-tracker",
        title: "Deadline alert",
        message: assignmentMessage(event, context),
        priority: assignmentPriority(event.priority, context),
        actions: ["snooze", "view"],
        url: deadlineId
          ? `/companion/?tab=schedule&deadlineId=${encodeURIComponent(deadlineId)}`
          : "/companion/?tab=schedule"
      };
    }
    case "lecture.reminder":
      return {
        source: "lecture-plan",
        title: "Lecture reminder",
        message: lectureMessage(event, context),
        priority: lecturePriority(event.priority, context),
        actions: ["snooze", "view"],
        url: "/companion/?tab=schedule"
      };
    case "note.prompt":
      return {
        source: "notes",
        title: "Reflection prompt",
        message: noteMessage(event, context),
        priority: notePriority(context),
        actions: ["view"],
        url: "/companion/?tab=habits"
      };
    case "location.arrival":
      return {
        source: "orchestrator",
        title: "Location update",
        message: locationArrivalMessage(event, context),
        priority: locationPriority(event.priority, context),
        actions: ["view"],
        url: "/companion/?tab=chat"
      };
    case "location.context":
      return {
        source: "orchestrator",
        title: "Context reminder",
        message: locationContextMessage(event, context),
        priority: locationPriority(event.priority, context),
        actions: ["view"],
        url: "/companion/?tab=chat"
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

function locationArrivalMessage(event: AgentEvent, context: UserContext): string {
  const label = asText(event.payload, "label");
  const base = `You've arrived at ${label}.`;

  if (context.mode === "focus") {
    return `${base} Stay on task.`;
  }

  if (context.stressLevel === "high") {
    return `${base} Take a moment to settle in.`;
  }

  if (context.energyLevel === "low") {
    return `${base} Find a comfortable spot.`;
  }

  return base;
}

function locationContextMessage(event: AgentEvent, context: UserContext): string {
  const label = asText(event.payload, "label");
  const contextMsg = asText(event.payload, "context");

  if (context.mode === "focus" && contextMsg) {
    return `At ${label}: ${contextMsg}`;
  }

  if (context.stressLevel === "high") {
    return `${contextMsg} — Remember to breathe.`;
  }

  return contextMsg || `Context update at ${label}`;
}

function locationPriority(base: Priority, context: UserContext): Priority {
  if (base === "critical") {
    return "critical";
  }

  if (context.stressLevel === "high" && base === "high") {
    return "medium";
  }

  if (context.mode === "recovery") {
    return "low";
  }

  return base;
}

function asText(value: unknown, key: string): string {
  if (value && typeof value === "object" && key in value) {
    const parsed = (value as Record<string, unknown>)[key];
    return String(parsed);
  }

  return "n/a";
}

function asOptionalText(value: unknown, key: string): string | null {
  if (value && typeof value === "object" && key in value) {
    const parsed = (value as Record<string, unknown>)[key];
    if (typeof parsed === "string" && parsed.trim().length > 0) {
      return parsed.trim();
    }
  }

  return null;
}
