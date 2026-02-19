import { useEffect, useState } from "react";
import { confirmDeadlineStatus, getDeadlines } from "../lib/api";
import { hapticSuccess } from "../lib/haptics";
import { Deadline } from "../types";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "./PullToRefreshIndicator";

interface DeadlineListProps {
  focusDeadlineId?: string;
}

function normalizeDueDateInput(dueDate: string): string {
  const trimmed = dueDate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    // Date-only deadlines are interpreted as local end-of-day.
    return `${trimmed}T23:59:00`;
  }
  return trimmed;
}

function dueTimestamp(dueDate: string): number {
  return new Date(normalizeDueDateInput(dueDate)).getTime();
}

function formatDeadlineTaskLabel(task: string): string {
  return task.replace(/^Assignment\s+Lab\b/i, "Lab");
}

export function DeadlineList({ focusDeadlineId }: DeadlineListProps): JSX.Element {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  const [syncMessage, setSyncMessage] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      const next = await getDeadlines();
      setDeadlines(next);
      setSyncMessage("Deadlines refreshed");
      setTimeout(() => setSyncMessage(""), 2000);
    } catch { /* keep current state */ }
    setRefreshing(false);
  };

  const { containerRef, isPulling, pullDistance, isRefreshing } = usePullToRefresh<HTMLDivElement>({
    onRefresh: handleRefresh,
    threshold: 80
  });

  useEffect(() => {
    let disposed = false;

    const load = async (): Promise<void> => {
      try {
        const next = await getDeadlines();
        if (!disposed) {
          setDeadlines(next);
        }
      } catch { /* remain empty */ }
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
    if (!focusDeadlineId) {
      return;
    }

    const timer = window.setTimeout(() => {
      const target = document.getElementById(`deadline-${focusDeadlineId}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);

    return () => {
      window.clearTimeout(timer);
    };
  }, [focusDeadlineId, deadlines]);

  const formatTimeRemaining = (dueDate: string): string => {
    const due = dueTimestamp(dueDate);
    const now = Date.now();
    const diffMs = due - now;
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMs < 0) return "Overdue";
    if (diffHours < 1) return `${diffMinutes}m left`;
    if (diffHours < 24) return `${diffHours}h left`;
    if (diffDays === 1 && diffHours % 24 > 0) return `1 day ${diffHours % 24}h left`;
    if (diffDays === 1) return "1 day left";
    return `${diffDays} days left`;
  };

  const formatDueDate = (dueDate: string): string => {
    const date = new Date(normalizeDueDateInput(dueDate));
    return date.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  };

  const getUrgencyClass = (dueDate: string): string => {
    const due = dueTimestamp(dueDate);
    const now = Date.now();
    const hoursLeft = (due - now) / (1000 * 60 * 60);

    if (hoursLeft < 0) return "deadline-overdue";
    if (hoursLeft <= 12) return "deadline-critical";
    if (hoursLeft <= 24) return "deadline-urgent";
    return "";
  };

  const setCompletion = async (id: string, completed: boolean): Promise<boolean> => {
    setUpdatingId(id);
    setSyncMessage("");

    const before = deadlines;
    const optimistic = deadlines.map((deadline) => (deadline.id === id ? { ...deadline, completed } : deadline));
    setDeadlines(optimistic);

    const confirmation = await confirmDeadlineStatus(id, completed);

    if (!confirmation) {
      setDeadlines(before);
      setSyncMessage("Could not sync deadline status right now.");
      setUpdatingId(null);
      return false;
    }

    const synced = optimistic.map((deadline) =>
      deadline.id === confirmation.deadline.id ? confirmation.deadline : deadline
    );
    setDeadlines(synced);
    if (completed) {
      hapticSuccess();
    }
    setSyncMessage(completed ? "Marked complete." : "Saved as still working.");
    setUpdatingId(null);
    return true;
  };

  const sortedDeadlines = [...deadlines].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return dueTimestamp(a.dueDate) - dueTimestamp(b.dueDate);
  });

  const activeCount = deadlines.filter((deadline) => !deadline.completed).length;

  return (
    <section className="panel deadline-panel">
      <header className="panel-header">
        <h2>Deadlines</h2>
        <div className="panel-header-actions">
          <span className="deadline-count">{activeCount} pending</span>
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
      {syncMessage && <p className="deadline-sync-status">{syncMessage}</p>}

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
        {sortedDeadlines.length > 0 ? (
          <ul className="deadline-list">
            {sortedDeadlines.map((deadline) => (
              <li
                key={deadline.id}
                className={`deadline-item ${getUrgencyClass(deadline.dueDate)} ${deadline.completed ? "deadline-completed" : ""} ${focusDeadlineId === deadline.id ? "deadline-item-focused" : ""}`}
              >
                <div className="deadline-checkbox-wrapper" id={`deadline-${deadline.id}`}>
                  <input
                    type="checkbox"
                    checked={deadline.completed}
                    onChange={() => void setCompletion(deadline.id, !deadline.completed)}
                    className="deadline-checkbox"
                    disabled={updatingId === deadline.id}
                  />
                  <div className="deadline-content">
                    <div className="deadline-header">
                      <h3 className="deadline-task">{formatDeadlineTaskLabel(deadline.task)}</h3>
                      <span className="deadline-time-remaining">
                        {formatTimeRemaining(deadline.dueDate)}
                      </span>
                    </div>
                    <div className="deadline-details">
                      <span className="deadline-course">{deadline.course}</span>
                      <span className="deadline-separator">•</span>
                      <span className="deadline-due">{formatDueDate(deadline.dueDate)}</span>
                    </div>
                  </div>
                </div>
                {!deadline.completed && getUrgencyClass(deadline.dueDate) === "deadline-overdue" && (
                  <div className="deadline-actions">
                    <button
                      type="button"
                      onClick={() => void setCompletion(deadline.id, true)}
                      disabled={updatingId === deadline.id}
                    >
                      Mark complete
                    </button>
                    <button
                      type="button"
                      onClick={() => void setCompletion(deadline.id, false)}
                      disabled={updatingId === deadline.id}
                    >
                      Still working
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="deadline-empty">No deadlines tracked. Add assignments to stay on top of your work.</p>
        )}
      </div>
    </section>
  );
}
