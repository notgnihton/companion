import { parseICS, ImportedCalendarEvent } from "./calendar-import.js";
import { LectureEvent } from "./types.js";
import { makeId } from "./utils.js";

export interface TPSyncResult {
  success: boolean;
  eventsProcessed: number;
  lecturesCreated: number;
  lecturesUpdated: number;
  lecturesDeleted: number;
  error?: string;
}

const TP_EDUCLOUD_URL = "https://tp.educloud.no/uis/timeplan/ical.php?type=courseact&sem=26v&id[]=DAT520,1&id[]=DAT560,1&id[]=DAT600,1";

export async function fetchTPSchedule(): Promise<ImportedCalendarEvent[]> {
  const response = await fetch(TP_EDUCLOUD_URL);

  if (!response.ok) {
    throw new Error(`Failed to fetch TP schedule: ${response.status} ${response.statusText}`);
  }

  const icsContent = await response.text();
  return parseICS(icsContent);
}

export function convertTPEventToLecture(event: ImportedCalendarEvent): Omit<LectureEvent, "id"> {
  // Calculate duration in minutes
  const durationMinutes = event.endTime
    ? Math.max(15, Math.round((new Date(event.endTime).getTime() - new Date(event.startTime).getTime()) / 60000))
    : 90; // Default to 90 minutes for lectures without end time

  // Infer workload based on event type from summary
  let workload: "low" | "medium" | "high" = "medium";
  const summaryLower = event.summary.toLowerCase();

  if (summaryLower.includes("exam") || summaryLower.includes("eksamen")) {
    workload = "high";
  } else if (summaryLower.includes("lecture") || summaryLower.includes("forelesning") || summaryLower.includes("lab")) {
    workload = "medium";
  } else if (summaryLower.includes("guidance") || summaryLower.includes("veiledning")) {
    workload = "low";
  }

  return {
    title: event.summary,
    startTime: event.startTime,
    durationMinutes,
    workload
  };
}

export function generateTPEventKey(event: ImportedCalendarEvent): string {
  // Use summary and start time as unique key for TP events
  return `tp-${event.summary}-${event.startTime}`;
}

export function diffScheduleEvents(
  existingEvents: LectureEvent[],
  newEvents: ImportedCalendarEvent[]
): {
  toCreate: Array<Omit<LectureEvent, "id">>;
  toUpdate: Array<{ id: string; event: Partial<Omit<LectureEvent, "id">> }>;
  toDelete: string[];
} {
  // Build a map of existing TP events by their key
  const existingMap = new Map<string, LectureEvent>();
  for (const event of existingEvents) {
    // Only process events that look like TP events (contain course codes)
    if (event.title.match(/DAT\d{3}/)) {
      const key = `tp-${event.title}-${event.startTime}`;
      existingMap.set(key, event);
    }
  }

  // Build a map of new events
  const newMap = new Map<string, ImportedCalendarEvent>();
  for (const event of newEvents) {
    const key = generateTPEventKey(event);
    newMap.set(key, event);
  }

  const toCreate: Array<Omit<LectureEvent, "id">> = [];
  const toUpdate: Array<{ id: string; event: Partial<Omit<LectureEvent, "id">> }> = [];
  const toDelete: string[] = [];

  // Find events to create or update
  for (const [key, newEvent] of newMap) {
    const existing = existingMap.get(key);

    if (!existing) {
      // New event - create it
      toCreate.push(convertTPEventToLecture(newEvent));
    } else {
      // Event exists - check if it needs updating
      const converted = convertTPEventToLecture(newEvent);

      if (
        existing.durationMinutes !== converted.durationMinutes ||
        existing.workload !== converted.workload
      ) {
        toUpdate.push({
          id: existing.id,
          event: {
            durationMinutes: converted.durationMinutes,
            workload: converted.workload
          }
        });
      }

      // Remove from existing map so we know it's been processed
      existingMap.delete(key);
    }
  }

  // Remaining events in existingMap are no longer in TP - delete them
  for (const event of existingMap.values()) {
    toDelete.push(event.id);
  }

  return { toCreate, toUpdate, toDelete };
}
