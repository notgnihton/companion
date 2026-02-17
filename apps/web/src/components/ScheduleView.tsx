import { useEffect, useState } from "react";
import { getDeadlines, getSchedule } from "../lib/api";
import { Deadline, LectureEvent, Priority } from "../types";
import { loadDeadlines, loadSchedule, loadScheduleCachedAt } from "../lib/storage";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "./PullToRefreshIndicator";

const SCHEDULE_STALE_MS = 12 * 60 * 60 * 1000;

function defaultEffortHours(priority: Priority): number {
  switch (priority) {
    case "critical":
      return 5;
    case "high":
      return 3.5;
    case "medium":
      return 2.5;
    case "low":
      return 1.5;
  }
}

function estimateDeadlineHours(deadline: Deadline): number {
  if (typeof deadline.effortHoursRemaining === "number" && Number.isFinite(deadline.effortHoursRemaining)) {
    return Math.max(0, deadline.effortHoursRemaining);
  }
  return defaultEffortHours(deadline.priority);
}

function formatHours(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatCachedLabel(cachedAt: string | null): string {
  if (!cachedAt) {
    return "No cached snapshot yet";
  }

  const timestamp = new Date(cachedAt);
  if (Number.isNaN(timestamp.getTime())) {
    return "Cached snapshot time unavailable";
  }

  return `Cached ${timestamp.toLocaleString()}`;
}

interface DayTimelineSegment {
  type: "lecture" | "gap";
  start: Date;
  end: Date;
  lecture?: LectureEvent;
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

function buildDayTimeline(lectures: LectureEvent[], referenceDate: Date): DayTimelineSegment[] {
  if (lectures.length === 0) {
    return [];
  }

  const sorted = [...lectures].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const firstStart = new Date(sorted[0].startTime);
  const timelineStart = new Date(referenceDate);
  timelineStart.setHours(Math.min(7, firstStart.getHours()), 0, 0, 0);

  const lastLecture = sorted[sorted.length - 1];
  const lastEnd = new Date(new Date(lastLecture.startTime).getTime() + lastLecture.durationMinutes * 60000);
  const timelineEnd = new Date(referenceDate);
  timelineEnd.setHours(Math.max(20, lastEnd.getHours() + 1), 0, 0, 0);

  const segments: DayTimelineSegment[] = [];
  let cursor = timelineStart;

  sorted.forEach((lecture) => {
    const start = new Date(lecture.startTime);
    const end = new Date(start.getTime() + lecture.durationMinutes * 60000);

    const gapMinutes = minutesBetween(cursor, start);
    if (gapMinutes >= 25) {
      segments.push({
        type: "gap",
        start: new Date(cursor),
        end: new Date(start)
      });
    }

    segments.push({
      type: "lecture",
      start,
      end,
      lecture
    });
    cursor = end;
  });

  const trailingGap = minutesBetween(cursor, timelineEnd);
  if (trailingGap >= 25) {
    segments.push({
      type: "gap",
      start: new Date(cursor),
      end: new Date(timelineEnd)
    });
  }

  return segments;
}

interface ScheduleViewProps {
  focusLectureId?: string;
}

export function ScheduleView({ focusLectureId }: ScheduleViewProps): JSX.Element {
  const [schedule, setSchedule] = useState<LectureEvent[]>(() => loadSchedule());
  const [deadlines, setDeadlines] = useState<Deadline[]>(() => loadDeadlines());
  const [cachedAt, setCachedAt] = useState<string | null>(() => loadScheduleCachedAt());
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true);
    const [refreshedSchedule, refreshedDeadlines] = await Promise.all([getSchedule(), getDeadlines()]);
    setSchedule(refreshedSchedule);
    setDeadlines(refreshedDeadlines);
    setCachedAt(loadScheduleCachedAt());
    setRefreshing(false);
  };

  const { containerRef, isPulling, pullDistance, isRefreshing } = usePullToRefresh<HTMLDivElement>({
    onRefresh: handleRefresh,
    threshold: 80
  });

  useEffect(() => {
    let disposed = false;

    const load = async (): Promise<void> => {
      const [nextSchedule, nextDeadlines] = await Promise.all([getSchedule(), getDeadlines()]);
      if (!disposed) {
        setSchedule(nextSchedule);
        setDeadlines(nextDeadlines);
        setCachedAt(loadScheduleCachedAt());
      }
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
      hour: "numeric", 
      minute: "2-digit",
      hour12: true 
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
  const cacheAgeMs = cachedAt ? Date.now() - new Date(cachedAt).getTime() : Number.POSITIVE_INFINITY;
  const isStale = Number.isFinite(cacheAgeMs) && cacheAgeMs > SCHEDULE_STALE_MS;
  const pendingDeadlines = deadlines.filter((deadline) => !deadline.completed);
  const remainingHours = pendingDeadlines.reduce((sum, deadline) => sum + estimateDeadlineHours(deadline), 0);
  const today = new Date();
  const todayLectures = sortedSchedule.filter((lecture) => isSameLocalDate(new Date(lecture.startTime), today));
  const dayTimeline = buildDayTimeline(todayLectures, today);
  const todayDeadlineMarkers = pendingDeadlines
    .filter((deadline) => {
      const dueAt = new Date(deadline.dueDate);
      if (Number.isNaN(dueAt.getTime())) {
        return false;
      }
      return isSameLocalDate(dueAt, today) || dueAt.getTime() >= Date.now() && dueAt.getTime() <= Date.now() + 24 * 60 * 60 * 1000;
    })
    .sort((left, right) => new Date(left.dueDate).getTime() - new Date(right.dueDate).getTime())
    .slice(0, 4);

  return (
    <section className="panel schedule-panel">
      <header className="panel-header">
        <h2>Lecture Schedule</h2>
        <div className="panel-header-actions">
          <span className="schedule-count">{schedule.length} classes</span>
          <button type="button" onClick={() => void handleRefresh()} disabled={refreshing || !isOnline}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>
      <div className="cache-status-row" role="status" aria-live="polite">
        <span className={`cache-status-chip ${isOnline ? "cache-status-chip-online" : "cache-status-chip-offline"}`}>
          {isOnline ? "Online" : "Offline"}
        </span>
        <span className="cache-status-chip">{formatCachedLabel(cachedAt)}</span>
        {isStale && <span className="cache-status-chip cache-status-chip-stale">Stale snapshot</span>}
      </div>
      <p className="schedule-workload-context">
        {pendingDeadlines.length} pending deadline{pendingDeadlines.length === 1 ? "" : "s"} • ~{formatHours(remainingHours)}h remaining
      </p>

      <section className="day-timeline-card" aria-label="Today timeline">
        <div className="day-timeline-header">
          <h3>Today timeline</h3>
          <span>{todayLectures.length} lecture block{todayLectures.length === 1 ? "" : "s"}</span>
        </div>

        {dayTimeline.length > 0 ? (
          <ul className="day-timeline-list">
            {dayTimeline.map((segment, index) => (
              <li
                key={`${segment.type}-${segment.start.toISOString()}-${index}`}
                className={segment.type === "lecture" ? "day-timeline-item day-timeline-item-lecture" : "day-timeline-item day-timeline-item-gap"}
              >
                <div className="day-timeline-item-meta">
                  <span>
                    {segment.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })} -{" "}
                    {segment.end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })}
                  </span>
                  <span>{formatDuration(minutesBetween(segment.start, segment.end))}</span>
                </div>
                <p className="day-timeline-item-label">
                  {segment.type === "lecture" ? segment.lecture?.title ?? "Lecture" : "Free gap"}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="day-timeline-empty">No lectures today. Use the free time for planned assignments.</p>
        )}

        <div className="day-timeline-deadlines">
          <h4>Upcoming deadlines</h4>
          {todayDeadlineMarkers.length > 0 ? (
            <div className="day-timeline-deadline-chips">
              {todayDeadlineMarkers.map((deadline) => (
                <span key={deadline.id} className="day-timeline-deadline-chip">
                  {deadline.course}: {deadline.task} ({new Date(deadline.dueDate).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })})
                </span>
              ))}
            </div>
          ) : (
            <p className="day-timeline-deadline-empty">No deadlines due in the next 24 hours.</p>
          )}
        </div>
      </section>

      <div 
        ref={containerRef}
        className="pull-to-refresh-container"
      >
        {(isPulling || isRefreshing) && (
          <PullToRefreshIndicator
            pullDistance={pullDistance}
            threshold={80}
            isRefreshing={isRefreshing}
          />
        )}
        {sortedSchedule.length > 0 ? (
          <ul className="schedule-list">
            {sortedSchedule.map((lecture) => {
              const minutesUntil = getMinutesUntil(lecture.startTime);
              const isUpcoming = minutesUntil >= 0 && minutesUntil < 120;
              
              return (
                <li 
                  key={lecture.id} 
                  id={`lecture-${lecture.id}`}
                  className={`schedule-item ${isUpcoming ? "schedule-item-upcoming" : ""} ${
                    focusLectureId === lecture.id ? "schedule-item-focused" : ""
                  }`}
                >
                  <div className="schedule-item-header">
                    <h3 className="schedule-item-title">{lecture.title}</h3>
                    <span className={`workload workload-${lecture.workload}`}>
                      {lecture.workload}
                    </span>
                  </div>
                  <div className="schedule-item-details">
                    <span className="schedule-date">{formatDate(lecture.startTime)}</span>
                    <span className="schedule-separator">•</span>
                    <span className="schedule-time">{formatTime(lecture.startTime)}</span>
                    <span className="schedule-separator">•</span>
                    <span className="schedule-duration">{lecture.durationMinutes}min</span>
                    {isUpcoming && (
                      <>
                        <span className="schedule-separator">•</span>
                        <span className="schedule-until">{getTimeUntilLabel(lecture.startTime)}</span>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="schedule-empty">No classes scheduled. Add your lecture plan to get started.</p>
        )}
      </div>
    </section>
  );
}
