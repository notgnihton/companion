import { useEffect, useState } from "react";
import { getDeadlines, getSchedule, getScheduleSuggestionMutes } from "../lib/api";
import { Deadline, LectureEvent, ScheduleSuggestionMute } from "../types";

interface DayTimelineSegment {
  type: "event" | "planned";
  start: Date;
  end: Date;
  event?: LectureEvent;
  suggestion?: string;
}

function isSameLocalDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

function formatLectureTitle(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\[nN]/g, "\n")
    .replace(/\s*\n+\s*/g, " / ")
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/^\/+\s*|\s*\/+$/g, "")
    .trim();
}

function formatRoomLabel(location: string | undefined): string | null {
  if (!location || location.trim().length === 0) {
    return null;
  }

  const compact = location.replace(/\r\n/g, " ").replace(/\s+/g, " ").trim();
  const explicitRoom = compact.match(/\b([A-Za-z]{1,4}-\d{2,4}[A-Za-z]?)\b/);
  if (explicitRoom?.[1]) {
    return explicitRoom[1].toUpperCase();
  }

  const spacedRoom = compact.match(/\b([A-Za-z]{1,4})\s+(\d{2,4}[A-Za-z]?)\b/);
  if (spacedRoom?.[1] && spacedRoom?.[2]) {
    return `${spacedRoom[1]}-${spacedRoom[2]}`.toUpperCase();
  }

  const segment = compact.split(/[,;|]/).map((value) => value.trim()).filter(Boolean).pop() ?? compact;
  return segment.replace(/\s*-\s*/g, "-");
}

function suggestGapActivity(
  gapStart: Date,
  gapDurationMinutes: number,
  deadlineSuggestions: string[],
  consumedDeadlineIndex: { value: number }
): string {
  const hour = gapStart.getHours();

  if (hour < 9) {
    return "Morning routine (gym, breakfast, planning)";
  }

  if (consumedDeadlineIndex.value < deadlineSuggestions.length) {
    const suggestion = deadlineSuggestions[consumedDeadlineIndex.value]!;
    consumedDeadlineIndex.value += 1;
    return suggestion;
  }

  if (gapDurationMinutes >= 90) {
    return "Focus block for assignments or revision";
  }

  return "Buffer, review notes, or take a short reset";
}

function allocatePlannedBlocks(
  start: Date,
  end: Date,
  deadlineSuggestions: string[],
  consumedDeadlineIndex: { value: number }
): DayTimelineSegment[] {
  const segments: DayTimelineSegment[] = [];
  let cursor = new Date(start);
  let remaining = minutesBetween(cursor, end);

  while (remaining >= 25) {
    let blockMinutes: number;
    if (remaining >= 210) {
      blockMinutes = 90;
    } else if (remaining >= 140) {
      blockMinutes = 75;
    } else if (remaining >= 95) {
      blockMinutes = 60;
    } else if (remaining >= 70) {
      blockMinutes = 45;
    } else {
      blockMinutes = remaining;
    }

    const leftover = remaining - blockMinutes;
    if (leftover > 0 && leftover < 25) {
      blockMinutes = remaining;
    }

    const blockEnd = new Date(cursor.getTime() + blockMinutes * 60000);
    segments.push({
      type: "planned",
      start: new Date(cursor),
      end: blockEnd,
      suggestion: suggestGapActivity(new Date(cursor), blockMinutes, deadlineSuggestions, consumedDeadlineIndex)
    });

    cursor = blockEnd;
    remaining = minutesBetween(cursor, end);
  }

  return segments;
}

function formatDayTimelineLabel(segment: DayTimelineSegment): string {
  if (segment.type !== "event") {
    return segment.suggestion ?? "Focus block";
  }

  const title = formatLectureTitle(segment.event?.title ?? "Scheduled block");
  const roomLabel = formatRoomLabel(segment.event?.location);
  return roomLabel ? `${title} • ${roomLabel}` : title;
}

function buildDayTimeline(
  scheduleBlocks: LectureEvent[],
  referenceDate: Date,
  deadlineSuggestions: string[],
  suggestionMutes: ScheduleSuggestionMute[]
): DayTimelineSegment[] {
  const sorted = [...scheduleBlocks].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const firstStart = sorted.length > 0 ? new Date(sorted[0].startTime) : new Date(referenceDate);
  const timelineStart = new Date(referenceDate);
  timelineStart.setHours(Math.min(7, firstStart.getHours()), 0, 0, 0);

  const lastLecture = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const lastEnd = lastLecture
    ? new Date(new Date(lastLecture.startTime).getTime() + lastLecture.durationMinutes * 60000)
    : new Date(referenceDate);
  const timelineEnd = new Date(referenceDate);
  timelineEnd.setHours(Math.max(20, lastEnd.getHours() + 1), 0, 0, 0);

  const segments: DayTimelineSegment[] = [];
  let cursor = timelineStart;
  const consumedDeadlineIndex = { value: 0 };

  sorted.forEach((lecture) => {
    const start = new Date(lecture.startTime);
    const end = new Date(start.getTime() + lecture.durationMinutes * 60000);

    const gapMinutes = minutesBetween(cursor, start);
    if (gapMinutes >= 25) {
      segments.push(
        ...allocatePlannedBlocks(new Date(cursor), new Date(start), deadlineSuggestions, consumedDeadlineIndex)
      );
    }

    segments.push({
      type: "event",
      start,
      end,
      event: lecture
    });
    cursor = end;
  });

  const trailingGap = minutesBetween(cursor, timelineEnd);
  if (trailingGap >= 25) {
    segments.push(
      ...allocatePlannedBlocks(new Date(cursor), new Date(timelineEnd), deadlineSuggestions, consumedDeadlineIndex)
    );
  }

  return segments.filter((segment) => {
    if (segment.type !== "planned") {
      return true;
    }
    return !suggestionMutes.some((mute) => {
      const muteStart = new Date(mute.startTime);
      const muteEnd = new Date(mute.endTime);
      if (Number.isNaN(muteStart.getTime()) || Number.isNaN(muteEnd.getTime())) {
        return false;
      }
      return segment.start.getTime() < muteEnd.getTime() && segment.end.getTime() > muteStart.getTime();
    });
  });
}

interface ScheduleViewProps {
  focusLectureId?: string;
}

export function ScheduleView({ focusLectureId }: ScheduleViewProps): JSX.Element {
  const [schedule, setSchedule] = useState<LectureEvent[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [suggestionMutes, setSuggestionMutes] = useState<ScheduleSuggestionMute[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      const [refreshedSchedule, refreshedDeadlines, refreshedSuggestionMutes] = await Promise.all([
        getSchedule(),
        getDeadlines(),
        getScheduleSuggestionMutes(new Date())
      ]);
      setSchedule(refreshedSchedule);
      setDeadlines(refreshedDeadlines);
      setSuggestionMutes(refreshedSuggestionMutes);
    } catch { /* keep current state */ }
    setRefreshing(false);
  };

  useEffect(() => {
    let disposed = false;

    const load = async (): Promise<void> => {
      try {
        const [nextSchedule, nextDeadlines, nextSuggestionMutes] = await Promise.all([
          getSchedule(),
          getDeadlines(),
          getScheduleSuggestionMutes(new Date())
        ]);
        if (!disposed) {
          setSchedule(nextSchedule);
          setDeadlines(nextDeadlines);
          setSuggestionMutes(nextSuggestionMutes);
        }
      } catch { /* remain in loading state */ }
      if (!disposed) setLoading(false);
    };

    const handleOnline = (): void => setIsOnline(true);
    const handleOffline = (): void => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    void load();

    return () => {
      disposed = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!focusLectureId) {
      return;
    }

    const timer = window.setTimeout(() => {
      const target = document.getElementById(`lecture-${focusLectureId}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);

    return () => {
      window.clearTimeout(timer);
    };
  }, [focusLectureId, schedule]);

  const formatTime = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  };

  const formatDate = (isoString: string): string => {
    const date = new Date(isoString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const eventDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (eventDate.getTime() === today.getTime()) return "Today";
    if (eventDate.getTime() === tomorrow.getTime()) return "Tomorrow";
    
    return date.toLocaleDateString(undefined, { 
      weekday: "short", 
      month: "short", 
      day: "numeric" 
    });
  };

  const getMinutesUntil = (isoString: string): number => {
    const eventTime = new Date(isoString).getTime();
    const now = Date.now();
    return Math.floor((eventTime - now) / 60000);
  };

  const getTimeUntilLabel = (isoString: string): string => {
    const minutesUntil = getMinutesUntil(isoString);
    
    if (minutesUntil < 0) return "Started";
    if (minutesUntil < 60) return `in ${minutesUntil}m`;
    
    const hoursUntil = Math.floor(minutesUntil / 60);
    if (hoursUntil < 24) return `in ${hoursUntil}h`;
    
    const daysUntil = Math.floor(hoursUntil / 24);
    return `in ${daysUntil}d`;
  };

  const sortedSchedule = [...schedule].sort((a, b) => 
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  const pendingDeadlines = deadlines.filter((deadline) => !deadline.completed);
  const deadlineSuggestions = pendingDeadlines
    .map((deadline) => ({
      dueDateMs: new Date(deadline.dueDate).getTime(),
      label: `${deadline.course} ${deadline.task}`
    }))
    .filter((item) => Number.isFinite(item.dueDateMs))
    .sort((left, right) => left.dueDateMs - right.dueDateMs)
    .slice(0, 8)
    .map((item) => item.label);
  const today = new Date();
  const todayBlocks = sortedSchedule.filter((block) => isSameLocalDate(new Date(block.startTime), today));
  const dayTimeline = buildDayTimeline(todayBlocks, today, deadlineSuggestions, suggestionMutes);

  return (
    <section className="panel schedule-panel">
      <header className="panel-header">
        <h2>Schedule</h2>
        <div className="panel-header-actions">
          <span className="schedule-count">{todayBlocks.length} today</span>
          <button type="button" onClick={() => void handleRefresh()} disabled={refreshing || !isOnline}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>
      <div className="cache-status-row" role="status" aria-live="polite">
        <span className={`cache-status-chip ${isOnline ? "cache-status-chip-online" : "cache-status-chip-offline"}`}>
          {isOnline ? "Online" : "Offline"}
        </span>
        {loading && <span className="cache-status-chip">Loading...</span>}
      </div>
      <p className="schedule-workload-context">
        {pendingDeadlines.length} pending deadline{pendingDeadlines.length === 1 ? "" : "s"}
      </p>

      <section className="day-timeline-card" aria-label="Today timeline">
        <div className="day-timeline-header">
          <h3>Today timeline</h3>
          <span>{todayBlocks.length} fixed block{todayBlocks.length === 1 ? "" : "s"}</span>
        </div>

        {dayTimeline.length > 0 ? (
          <ul className="day-timeline-list">
            {dayTimeline.map((segment, index) => (
              <li
                key={`${segment.type}-${segment.start.toISOString()}-${index}`}
                className={segment.type === "event" ? "day-timeline-item day-timeline-item-lecture" : "day-timeline-item day-timeline-item-gap"}
              >
                <div className="day-timeline-item-meta">
                  <span>
                    {segment.start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })} -{" "}
                    {segment.end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
                  </span>
                  <span>{formatDuration(minutesBetween(segment.start, segment.end))}</span>
                </div>
                <p className="day-timeline-item-label">
                  {formatDayTimelineLabel(segment)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="day-timeline-empty">No fixed sessions today. Ask Gemini to build your day plan.</p>
        )}
      </section>

    </section>
  );
}
