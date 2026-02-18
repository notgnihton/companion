import { RuntimeStore } from "./store.js";
import { LectureEvent, RoutinePreset } from "./types.js";

const ROUTINE_PARENT_PREFIX = "routine-preset:";

export interface RoutinePlacementOptions {
  now?: Date;
  horizonDays?: number;
  stepMinutes?: number;
}

export interface RoutinePlacementResult {
  windowStart: string;
  windowEnd: string;
  presetsConsidered: number;
  clearedEvents: number;
  createdEvents: number;
  skippedPlacements: number;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function parseTimeToMinutes(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

function isRoutineGenerated(event: LectureEvent): boolean {
  return typeof event.recurrenceParentId === "string" && event.recurrenceParentId.startsWith(ROUTINE_PARENT_PREFIX);
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

function findNearestFreeSlot(
  preferredStartMs: number,
  durationMs: number,
  dayStartMs: number,
  dayEndMs: number,
  occupied: Array<{ start: number; end: number }>,
  stepMinutes: number
): number | null {
  const stepMs = Math.max(5, stepMinutes) * 60 * 1000;
  const latestStartMs = dayEndMs - durationMs;
  if (latestStartMs < dayStartMs) {
    return null;
  }

  const normalizedPreferred = Math.min(latestStartMs, Math.max(dayStartMs, preferredStartMs));
  const visited = new Set<number>();
  const maxSteps = Math.ceil((dayEndMs - dayStartMs) / stepMs) + 1;

  for (let step = 0; step <= maxSteps; step += 1) {
    const candidates = step === 0
      ? [normalizedPreferred]
      : [normalizedPreferred + step * stepMs, normalizedPreferred - step * stepMs];

    for (const candidateRaw of candidates) {
      const candidate = Math.min(latestStartMs, Math.max(dayStartMs, candidateRaw));
      if (visited.has(candidate)) {
        continue;
      }
      visited.add(candidate);

      const end = candidate + durationMs;
      const hasOverlap = occupied.some((entry) => overlaps(candidate, end, entry.start, entry.end));
      if (!hasOverlap) {
        return candidate;
      }
    }
  }

  return null;
}

function createRoutineEvent(
  store: RuntimeStore,
  preset: RoutinePreset,
  startMs: number
): LectureEvent {
  return store.createLectureEvent({
    title: preset.title,
    startTime: new Date(startMs).toISOString(),
    durationMinutes: preset.durationMinutes,
    workload: preset.workload,
    recurrenceParentId: `${ROUTINE_PARENT_PREFIX}${preset.id}`
  });
}

export function applyRoutinePresetPlacements(
  store: RuntimeStore,
  options: RoutinePlacementOptions = {}
): RoutinePlacementResult {
  const now = options.now ?? new Date();
  const horizonDays = Math.max(1, Math.min(31, Math.round(options.horizonDays ?? 7)));
  const stepMinutes = Math.max(5, Math.min(60, Math.round(options.stepMinutes ?? 15)));

  const windowStartDate = startOfUtcDay(now);
  const windowEndDate = new Date(windowStartDate.getTime() + horizonDays * 24 * 60 * 60 * 1000);
  const windowStartMs = windowStartDate.getTime();
  const windowEndMs = windowEndDate.getTime();

  let clearedEvents = 0;
  for (const event of store.getScheduleEvents()) {
    if (!isRoutineGenerated(event)) {
      continue;
    }
    const startMs = new Date(event.startTime).getTime();
    if (!Number.isFinite(startMs) || startMs < windowStartMs || startMs >= windowEndMs) {
      continue;
    }
    if (store.deleteScheduleEvent(event.id)) {
      clearedEvents += 1;
    }
  }

  const presets = store
    .getRoutinePresets()
    .filter((preset) => preset.active)
    .sort((left, right) => {
      const leftMinutes = parseTimeToMinutes(left.preferredStartTime) ?? 24 * 60;
      const rightMinutes = parseTimeToMinutes(right.preferredStartTime) ?? 24 * 60;
      if (leftMinutes !== rightMinutes) {
        return leftMinutes - rightMinutes;
      }
      return left.title.localeCompare(right.title);
    });

  const fixedEvents = store.getScheduleEvents().filter((event) => !isRoutineGenerated(event));
  const createdEvents: LectureEvent[] = [];
  let skippedPlacements = 0;

  for (let dayOffset = 0; dayOffset < horizonDays; dayOffset += 1) {
    const dayStartMs = windowStartMs + dayOffset * 24 * 60 * 60 * 1000;
    const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
    const weekday = new Date(dayStartMs).getUTCDay();

    for (const preset of presets) {
      if (!preset.weekdays.includes(weekday)) {
        continue;
      }

      const preferredMinutes = parseTimeToMinutes(preset.preferredStartTime);
      if (preferredMinutes === null) {
        skippedPlacements += 1;
        continue;
      }

      const occupied = [...fixedEvents, ...createdEvents]
        .map((event) => {
          const start = new Date(event.startTime).getTime();
          const end = start + event.durationMinutes * 60 * 1000;
          return { start, end };
        })
        .filter((entry) => overlaps(entry.start, entry.end, dayStartMs, dayEndMs));

      const durationMs = preset.durationMinutes * 60 * 1000;
      const preferredStartMs = dayStartMs + preferredMinutes * 60 * 1000;
      const startMs = findNearestFreeSlot(
        preferredStartMs,
        durationMs,
        dayStartMs,
        dayEndMs,
        occupied,
        stepMinutes
      );

      if (startMs === null) {
        skippedPlacements += 1;
        continue;
      }

      createdEvents.push(createRoutineEvent(store, preset, startMs));
    }
  }

  return {
    windowStart: windowStartDate.toISOString(),
    windowEnd: windowEndDate.toISOString(),
    presetsConsidered: presets.length,
    clearedEvents,
    createdEvents: createdEvents.length,
    skippedPlacements
  };
}
