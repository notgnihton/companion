import { Deadline, LectureEvent, Priority } from "./types.js";

export interface ImportedCalendarEvent {
  summary: string;
  startTime: string;
  endTime?: string;
  description?: string;
}

export interface CalendarImportResult {
  importedEvents: number;
  lecturesCreated: number;
  deadlinesCreated: number;
  lectures: LectureEvent[];
  deadlines: Deadline[];
}

export interface CalendarImportPreview {
  importedEvents: number;
  lecturesPlanned: number;
  deadlinesPlanned: number;
  lectures: Array<Omit<LectureEvent, "id">>;
  deadlines: Array<Omit<Deadline, "id">>;
}

const ASSIGNMENT_OR_EXAM_PATTERNS = [
  /\bassignment(s)?\b/i,
  /\bexam(s)?\b/i,
  /\beksamen\b/i,
  /\bmidterm\b/i,
  /\bfinal\b/i,
  /\boblig\b/i,
  /\binnlevering\b/i
];

export function parseICS(icsContent: string): ImportedCalendarEvent[] {
  const events: ImportedCalendarEvent[] = [];
  const lines = unfoldICSLines(icsContent);
  let current: Partial<ImportedCalendarEvent> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }

    if (line === "END:VEVENT") {
      if (current?.summary && current.startTime) {
        events.push({
          summary: current.summary,
          startTime: current.startTime,
          endTime: current.endTime,
          description: current.description
        });
      }
      current = null;
      continue;
    }

    if (!current) {
      continue;
    }

    const [keyWithParams, ...rest] = line.split(":");
    const value = rest.join(":").trim();

    if (keyWithParams.startsWith("SUMMARY")) {
      current.summary = normalizeCalendarSummary(decodeICSText(value));
    } else if (keyWithParams.startsWith("DESCRIPTION")) {
      current.description = normalizeCalendarDescription(decodeICSText(value));
    } else if (keyWithParams.startsWith("DTSTART")) {
      const parsed = parseICSTimestamp(value);
      if (parsed) {
        current.startTime = parsed;
      }
    } else if (keyWithParams.startsWith("DTEND")) {
      const parsed = parseICSTimestamp(value);
      if (parsed) {
        current.endTime = parsed;
      }
    }
  }

  return events;
}

export function classifyEventType(event: ImportedCalendarEvent): "deadline" | "lecture" {
  const text = `${event.summary} ${event.description ?? ""}`;
  if (ASSIGNMENT_OR_EXAM_PATTERNS.some((pattern) => pattern.test(text))) {
    return "deadline";
  }

  return "lecture";
}

export function inferPriority(event: ImportedCalendarEvent): Priority {
  const text = `${event.summary} ${event.description ?? ""}`.toLowerCase();

  if (text.includes("final") || text.includes("midterm") || text.includes("critical")) {
    return "critical";
  }

  if (text.includes("exam") || text.includes("deadline") || text.includes("due")) {
    return "high";
  }

  return "medium";
}

export function inferWorkload(event: ImportedCalendarEvent): "low" | "medium" | "high" {
  const text = `${event.summary} ${event.description ?? ""}`.toLowerCase();

  if (text.includes("lab") || text.includes("exam") || text.includes("project")) {
    return "high";
  }

  if (text.includes("lecture") || text.includes("class")) {
    return "medium";
  }

  return "low";
}

export function toDurationMinutes(startTime: string, endTime?: string): number {
  if (!endTime) {
    return 60;
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  const deltaMs = end.getTime() - start.getTime();

  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return 60;
  }

  return Math.max(15, Math.round(deltaMs / 60000));
}

export function inferCourseName(summary: string): string {
  const parts = summary.split(":");

  if (parts.length < 2) {
    return "General";
  }

  const maybeCourse = parts[0]?.trim();

  if (!maybeCourse || maybeCourse.length < 2) {
    return "General";
  }

  return maybeCourse;
}

export function buildCalendarImportPreview(importedEvents: ImportedCalendarEvent[]): CalendarImportPreview {
  const lectures: Array<Omit<LectureEvent, "id">> = [];
  const deadlines: Array<Omit<Deadline, "id">> = [];

  for (const event of importedEvents) {
    if (classifyEventType(event) === "deadline") {
      deadlines.push({
        course: inferCourseName(event.summary),
        task: event.summary,
        dueDate: event.startTime,
        priority: inferPriority(event),
        completed: false
      });
      continue;
    }

    lectures.push({
      title: event.summary,
      startTime: event.startTime,
      durationMinutes: toDurationMinutes(event.startTime, event.endTime),
      workload: inferWorkload(event)
    });
  }

  return {
    importedEvents: importedEvents.length,
    lecturesPlanned: lectures.length,
    deadlinesPlanned: deadlines.length,
    lectures,
    deadlines
  };
}

function unfoldICSLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const unfolded: string[] = [];

  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }

  return unfolded;
}

function decodeICSText(value: string): string {
  let decoded = value;

  for (let pass = 0; pass < 4; pass += 1) {
    const next = decoded.replace(/\\([nN,;\\])/g, (_match, token: string) => {
      if (token === "n" || token === "N") {
        return "\n";
      }
      if (token === ",") {
        return ",";
      }
      if (token === ";") {
        return ";";
      }
      return "\\";
    });

    if (next === decoded) {
      break;
    }
    decoded = next;
  }

  return decoded;
}

function normalizeCalendarSummary(value: string): string {
  return value
    .replace(/\\[nN]/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s*\n+\s*/g, " / ")
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/^\/+\s*|\s*\/+$/g, "")
    .trim();
}

function normalizeCalendarDescription(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function parseICSTimestamp(value: string): string | null {
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const year = value.slice(0, 4);
    const month = value.slice(4, 6);
    const day = value.slice(6, 8);
    const hour = value.slice(9, 11);
    const minute = value.slice(11, 13);
    const second = value.slice(13, 15);
    return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  }

  if (/^\d{8}$/.test(value)) {
    const year = value.slice(0, 4);
    const month = value.slice(4, 6);
    const day = value.slice(6, 8);
    return `${year}-${month}-${day}T09:00:00.000Z`;
  }

  return null;
}
