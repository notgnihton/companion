import { useState, useEffect } from "react";
import { Deadline } from "../types";
import { loadDeadlines, saveDeadlines } from "../lib/storage";

export function DeadlineList(): JSX.Element {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);

  useEffect(() => {
    setDeadlines(loadDeadlines());
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

  const toggleComplete = (id: string): void => {
    const updated = deadlines.map(d => 
      d.id === id ? { ...d, completed: !d.completed } : d
    );
    setDeadlines(updated);
    saveDeadlines(updated);
  };

  const sortedDeadlines = [...deadlines].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });

  const activeCount = deadlines.filter(d => !d.completed).length;

  return (
    <section className="panel deadline-panel">
      <header className="panel-header">
        <h2>Deadlines</h2>
        <span className="deadline-count">{activeCount} pending</span>
      </header>

      {sortedDeadlines.length > 0 ? (
        <ul className="deadline-list">
          {sortedDeadlines.map((deadline) => (
            <li 
              key={deadline.id} 
              className={`deadline-item ${getUrgencyClass(deadline.dueDate)} ${deadline.completed ? "deadline-completed" : ""}`}
            >
              <label className="deadline-checkbox-wrapper">
                <input
                  type="checkbox"
                  checked={deadline.completed}
                  onChange={() => toggleComplete(deadline.id)}
                  className="deadline-checkbox"
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
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="deadline-empty">No deadlines tracked. Add assignments to stay on top of your work.</p>
      )}
    </section>
  );
}
