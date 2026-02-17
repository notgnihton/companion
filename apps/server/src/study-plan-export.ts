import { StudyPlan, StudyPlanSession } from "./types.js";

interface StudyPlanCalendarOptions {
  calendarName?: string;
  generatedAt?: Date;
}

function formatUtcForICS(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function buildStableStudyPlanEventUid(session: StudyPlanSession): string {
  const start = formatUtcForICS(session.startTime);
  const deadlinePart = session.deadlineId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `study-plan-${deadlinePart}-${start}-${session.durationMinutes}@companion.local`;
}

export function buildStudyPlanCalendarIcs(
  plan: StudyPlan,
  options: StudyPlanCalendarOptions = {}
): string {
  const calendarName = options.calendarName ?? "Companion Study Plan";
  const generatedAt = options.generatedAt ?? new Date(plan.generatedAt);
  const dtStamp = formatUtcForICS(generatedAt);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Companion//Study Plan Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    "X-WR-TIMEZONE:UTC"
  ];

  for (const session of plan.sessions) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${buildStableStudyPlanEventUid(session)}`);
    lines.push(`DTSTAMP:${dtStamp}`);
    lines.push(`DTSTART:${formatUtcForICS(session.startTime)}`);
    lines.push(`DTEND:${formatUtcForICS(session.endTime)}`);
    lines.push(`SUMMARY:${escapeIcsText(`${session.course} Study: ${session.task}`)}`);
    lines.push(`DESCRIPTION:${escapeIcsText(session.rationale)}`);
    lines.push("CATEGORIES:STUDY");
    lines.push("STATUS:CONFIRMED");
    lines.push("TRANSP:OPAQUE");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.join("\r\n");
}
