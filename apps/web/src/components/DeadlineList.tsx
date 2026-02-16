import { useEffect, useState } from "react";
import { confirmDeadlineStatus, getDeadlines } from "../lib/api";
import { hapticSuccess } from "../lib/haptics";
import { Deadline } from "../types";
import { loadDeadlines, saveDeadlines } from "../lib/storage";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "./PullToRefreshIndicator";

export function DeadlineList(): JSX.Element {
  const [deadlines, setDeadlines] = useState<Deadline[]>(() => loadDeadlines());
  const [syncMessage, setSyncMessage] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const handleRefresh = async (): Promise<void> => {
    const next = await getDeadlines();
    setDeadlines(next);
    setSyncMessage("Deadlines refreshed");
    setTimeout(() => setSyncMessage(""), 2000);
  };

  const { containerRef, isPulling, pullDistance, isRefreshing } = usePullToRefresh<HTMLDivElement>({
    onRefresh: handleRefresh,
    threshold: 80
  });

  useEffect(() => {
    let disposed = false;

    const load = async (): Promise<void> => {
      const next = await getDeadlines();
      if (!disposed) {
        setDeadlines(next);
      }
    };

    void load();

    return () => {
      disposed = true;
    };
  }, []);

  const formatTimeRemaining = (dueDate: string): string => {
    const due = new Date(dueDate).getTime();
    const now = Date.now();
    const diffMs = due - now;
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMs < 0) return "Overdue";
    if (diffHours < 1) return `${diffMinutes}m left`;
    if (diffHours < 24) return `${diffHours}h left`;
    if (diffDays === 1) return "1 day left";
    return `${diffDays} days left`;
  };

  const formatDueDate = (dueDate: string): string => {
    const date = new Date(dueDate);
    return date.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
  };

  const getUrgencyClass = (dueDate: string): string => {
    const due = new Date(dueDate).getTime();
    const now = Date.now();
    const hoursLeft = (due - now) / (1000 * 60 * 60);

    if (hoursLeft < 0) return "deadline-overdue";
    if (hoursLeft <= 12) return "deadline-critical";
    if (hoursLeft <= 24) return "deadline-urgent";
    return "";
  };

  const setCompletion = async (id: string, completed: boolean): Promise<void> => {
    setUpdatingId(id);
    setSyncMessage("");

    const before = deadlines;
    const optimistic = deadlines.map((deadline) => (deadline.id === id ? { ...deadline, completed } : deadline));
    setDeadlines(optimistic);
    saveDeadlines(optimistic);

    const confirmation = await confirmDeadlineStatus(id, completed);

    if (!confirmation) {
      setDeadlines(before);
      saveDeadlines(before);
      setSyncMessage("Could not sync deadline status right now.");
      setUpdatingId(null);
      return;
    }

    const synced = optimistic.map((deadline) =>
      deadline.id === confirmation.deadline.id ? confirmation.deadline : deadline
    );
    setDeadlines(synced);
    saveDeadlines(synced);
    if (completed) {
      hapticSuccess();
    }
    setSyncMessage(completed ? "Marked complete." : "Saved as still working.");
    setUpdatingId(null);
  };

  const sortedDeadlines = [...deadlines].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });

  const activeCount = deadlines.filter((deadline) => !deadline.completed).length;

  return (
    <section className="panel deadline-panel">
      <header className="panel-header">
        <h2>Deadlines</h2>
        <span className="deadline-count">{activeCount} pending</span>
      </header>
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
                className={`deadline-item ${getUrgencyClass(deadline.dueDate)} ${deadline.completed ? "deadline-completed" : ""}`}
              >
                <div className="deadline-checkbox-wrapper">
                  <input
                    type="checkbox"
                    checked={deadline.completed}
                    onChange={() => void setCompletion(deadline.id, !deadline.completed)}
                    className="deadline-checkbox"
                    disabled={updatingId === deadline.id}
                  />
                  <div className="deadline-content">
                    <div className="deadline-header">
                      <h3 className="deadline-task">{deadline.task}</h3>
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
