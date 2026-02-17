import { useEffect, useRef, useState } from "react";
import { confirmDeadlineStatus, getDeadlines, updateDeadline } from "../lib/api";
import { hapticNotice, hapticSuccess } from "../lib/haptics";
import { Deadline } from "../types";
import { loadDeadlines, loadDeadlinesCachedAt, saveDeadlines } from "../lib/storage";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "./PullToRefreshIndicator";
import { SwipeableListItem } from "./SwipeableListItem";

interface UndoToast {
  message: string;
  onUndo: () => void;
}

interface DeadlineListProps {
  focusDeadlineId?: string;
}

const DEADLINE_STALE_MS = 12 * 60 * 60 * 1000;

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

export function DeadlineList({ focusDeadlineId }: DeadlineListProps): JSX.Element {
  const [deadlines, setDeadlines] = useState<Deadline[]>(() => loadDeadlines());
  const [cachedAt, setCachedAt] = useState<string | null>(() => loadDeadlinesCachedAt());
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  const [syncMessage, setSyncMessage] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [undoToast, setUndoToast] = useState<UndoToast | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const undoTimerRef = useRef<number | null>(null);

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true);
    const next = await getDeadlines();
    setDeadlines(next);
    setCachedAt(loadDeadlinesCachedAt());
    setSyncMessage("Deadlines refreshed");
    setTimeout(() => setSyncMessage(""), 2000);
    setRefreshing(false);
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
        setCachedAt(loadDeadlinesCachedAt());
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
    return () => {
      if (undoTimerRef.current) {
        window.clearTimeout(undoTimerRef.current);
      }
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

  const showUndoToast = (message: string, onUndo: () => void): void => {
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
    }
    setUndoToast({ message, onUndo });
    undoTimerRef.current = window.setTimeout(() => {
      setUndoToast(null);
      undoTimerRef.current = null;
    }, 5000);
  };

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

  const setCompletion = async (id: string, completed: boolean): Promise<boolean> => {
    setUpdatingId(id);
    setSyncMessage("");

    const before = deadlines;
    const optimistic = deadlines.map((deadline) => (deadline.id === id ? { ...deadline, completed } : deadline));
    setDeadlines(optimistic);
    saveDeadlines(optimistic);
    setCachedAt(loadDeadlinesCachedAt());

    const confirmation = await confirmDeadlineStatus(id, completed);

    if (!confirmation) {
      setDeadlines(before);
      saveDeadlines(before);
      setCachedAt(loadDeadlinesCachedAt());
      setSyncMessage("Could not sync deadline status right now.");
      setUpdatingId(null);
      return false;
    }

    const synced = optimistic.map((deadline) =>
      deadline.id === confirmation.deadline.id ? confirmation.deadline : deadline
    );
    setDeadlines(synced);
    saveDeadlines(synced);
    setCachedAt(loadDeadlinesCachedAt());
    if (completed) {
      hapticSuccess();
    }
    setSyncMessage(completed ? "Marked complete." : "Saved as still working.");
    setUpdatingId(null);
    return true;
  };

  const restoreDueDate = async (id: string, dueDate: string): Promise<void> => {
    const restored = await updateDeadline(id, { dueDate });
    if (!restored) {
      setSyncMessage("Could not undo snooze.");
      return;
    }

    const next = deadlines.map((deadline) => (deadline.id === id ? restored : deadline));
    setDeadlines(next);
    saveDeadlines(next);
    setCachedAt(loadDeadlinesCachedAt());
    setSyncMessage("Snooze undone.");
  };

  const snoozeDeadline = async (deadline: Deadline): Promise<boolean> => {
    setUpdatingId(deadline.id);
    setSyncMessage("");

    const originalDeadlines = deadlines;
    const snoozedDueDate = new Date(new Date(deadline.dueDate).getTime() + 24 * 60 * 60 * 1000).toISOString();
    const optimistic = deadlines.map((item) => (
      item.id === deadline.id ? { ...item, dueDate: snoozedDueDate } : item
    ));
    setDeadlines(optimistic);
    saveDeadlines(optimistic);
    setCachedAt(loadDeadlinesCachedAt());

    const updated = await updateDeadline(deadline.id, { dueDate: snoozedDueDate });
    if (!updated) {
      setDeadlines(originalDeadlines);
      saveDeadlines(originalDeadlines);
      setCachedAt(loadDeadlinesCachedAt());
      setSyncMessage("Could not snooze deadline right now.");
      setUpdatingId(null);
      return false;
    }

    const synced = optimistic.map((item) => (item.id === updated.id ? updated : item));
    setDeadlines(synced);
    saveDeadlines(synced);
    setCachedAt(loadDeadlinesCachedAt());
    setSyncMessage("Snoozed by 24 hours.");
    hapticNotice();
    setUpdatingId(null);
    return true;
  };

  const handleSwipeComplete = async (deadline: Deadline): Promise<void> => {
    if (deadline.completed || updatingId === deadline.id) return;
    const success = await setCompletion(deadline.id, true);
    if (!success) return;

    showUndoToast("Deadline marked complete.", () => {
      void setCompletion(deadline.id, false);
    });
  };

  const handleSwipeSnooze = async (deadline: Deadline): Promise<void> => {
    if (deadline.completed || updatingId === deadline.id) return;
    const success = await snoozeDeadline(deadline);
    if (!success) return;

    showUndoToast("Deadline snoozed 24h.", () => {
      void restoreDueDate(deadline.id, deadline.dueDate);
    });
  };

  const sortedDeadlines = [...deadlines].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });
  const cacheAgeMs = cachedAt ? Date.now() - new Date(cachedAt).getTime() : Number.POSITIVE_INFINITY;
  const isStale = Number.isFinite(cacheAgeMs) && cacheAgeMs > DEADLINE_STALE_MS;

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
        <span className="cache-status-chip">{formatCachedLabel(cachedAt)}</span>
        {isStale && <span className="cache-status-chip cache-status-chip-stale">Stale snapshot</span>}
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
              <SwipeableListItem
                key={deadline.id}
                className={`deadline-item ${getUrgencyClass(deadline.dueDate)} ${deadline.completed ? "deadline-completed" : ""} ${focusDeadlineId === deadline.id ? "deadline-item-focused" : ""}`}
                onSwipeRight={() => { void handleSwipeComplete(deadline); }}
                onSwipeLeft={() => { void handleSwipeSnooze(deadline); }}
                rightActionLabel="Complete"
                leftActionLabel="Snooze +24h"
                disabled={updatingId === deadline.id || deadline.completed}
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
              </SwipeableListItem>
            ))}
          </ul>
        ) : (
          <p className="deadline-empty">No deadlines tracked. Add assignments to stay on top of your work.</p>
        )}
      </div>

      {undoToast && (
        <div className="swipe-undo-toast" role="status" aria-live="polite">
          <span>{undoToast.message}</span>
          <button
            type="button"
            onClick={() => {
              undoToast.onUndo();
              setUndoToast(null);
              if (undoTimerRef.current) {
                window.clearTimeout(undoTimerRef.current);
                undoTimerRef.current = null;
              }
            }}
          >
            Undo
          </button>
        </div>
      )}
    </section>
  );
}
