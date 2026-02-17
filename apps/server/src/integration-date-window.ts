import type { ImportedCalendarEvent } from "./calendar-import.js";
import { config } from "./config.js";
import type { CanvasAssignment } from "./types.js";

export interface IntegrationDateWindow {
  start: Date;
  end: Date;
  pastDays: number;
  futureDays: number;
}

export interface IntegrationDateWindowOptions {
  referenceDate?: Date;
  pastDays?: number;
  futureDays?: number;
}

export function createIntegrationDateWindow(options: IntegrationDateWindowOptions = {}): IntegrationDateWindow {
  const referenceDate = options.referenceDate ?? new Date();
  const pastDays = options.pastDays ?? config.INTEGRATION_WINDOW_PAST_DAYS;
  const futureDays = options.futureDays ?? config.INTEGRATION_WINDOW_FUTURE_DAYS;

  const start = new Date(referenceDate);
  start.setDate(start.getDate() - pastDays);

  const end = new Date(referenceDate);
  end.setDate(end.getDate() + futureDays);

  return { start, end, pastDays, futureDays };
}

export function isWithinIntegrationDateWindow(value: string, window: IntegrationDateWindow): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date >= window.start && date <= window.end;
}

export function filterTPEventsByDateWindow(
  events: ImportedCalendarEvent[],
  options: IntegrationDateWindowOptions = {}
): ImportedCalendarEvent[] {
  const window = createIntegrationDateWindow(options);
  return events.filter((event) => isWithinIntegrationDateWindow(event.startTime, window));
}

export function filterCanvasAssignmentsByDateWindow(
  assignments: CanvasAssignment[],
  options: IntegrationDateWindowOptions = {}
): CanvasAssignment[] {
  const window = createIntegrationDateWindow(options);

  return assignments.filter((assignment) => {
    if (!assignment.due_at) {
      return false;
    }

    return isWithinIntegrationDateWindow(assignment.due_at, window);
  });
}
