import { useState } from "react";
import { LectureEvent } from "../types";
import { loadSchedule } from "../lib/storage";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "./PullToRefreshIndicator";

export function ScheduleView(): JSX.Element {
  const [schedule, setSchedule] = useState<LectureEvent[]>(() => loadSchedule());

  const handleRefresh = async (): Promise<void> => {
    // Reload schedule from storage
    const refreshedSchedule = loadSchedule();
    setSchedule(refreshedSchedule);
    await new Promise(resolve => setTimeout(resolve, 500)); // Smooth visual feedback
  };

  const { containerRef, isPulling, pullDistance, isRefreshing } = usePullToRefresh<HTMLDivElement>({
    onRefresh: handleRefresh,
    threshold: 80
  });

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

  return (
    <section className="panel schedule-panel">
      <header className="panel-header">
        <h2>Lecture Schedule</h2>
        <span className="schedule-count">{schedule.length} classes</span>
      </header>

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
                  className={`schedule-item ${isUpcoming ? "schedule-item-upcoming" : ""}`}
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
