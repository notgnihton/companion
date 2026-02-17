import { useState } from "react";
import { apiUrl } from "../lib/config";
import { Priority } from "../types";

interface FloatingQuickCaptureProps {
  onUpdated?: () => Promise<void>;
}

export function FloatingQuickCapture({ onUpdated }: FloatingQuickCaptureProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  // Deadline-specific fields
  const [course, setCourse] = useState("");
  const [task, setTask] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");

  const resetForm = (): void => {
    setCourse("");
    setTask("");
    setDueDate("");
    setPriority("medium");
    setMessage("");
  };

  const handleSubmit = async (): Promise<void> => {
    if (!course.trim() || !task.trim() || !dueDate) {
      setMessage("Please fill in all deadline fields");
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      const response = await fetch(apiUrl("/api/deadlines"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course: course.trim(),
          task: task.trim(),
          dueDate,
          priority
        })
      });

      setSubmitting(false);

      if (response.ok) {
        setMessage("Deadline created!");
        resetForm();
        setTimeout(() => {
          setIsOpen(false);
          setMessage("");
        }, 1000);
        if (onUpdated) {
          await onUpdated();
        }
      } else {
        const body = await response.text();
        setMessage(`Failed: ${body}`);
      }
    } catch (error) {
      setSubmitting(false);
      setMessage(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      setIsOpen(false);
      resetForm();
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        className="floating-quick-capture-btn"
        onClick={() => setIsOpen(true)}
        aria-label="Quick deadline"
        title="Quick deadline"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    );
  }

  return (
    <>
      <div className="floating-quick-capture-overlay" onClick={() => setIsOpen(false)} />
      <div className="floating-quick-capture-modal" onKeyDown={handleKeyDown}>
        <div className="quick-capture-header">
          <h3>Quick Deadline</h3>
          <button
            type="button"
            className="quick-capture-close"
            onClick={() => setIsOpen(false)}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="quick-capture-content">
          <div className="quick-capture-deadline-form">
            <input
              type="text"
              placeholder="Course"
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              autoFocus
            />
            <input
              type="text"
              placeholder="Task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
            />
            <input
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              <option value="low">Low Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="high">High Priority</option>
              <option value="critical">Critical Priority</option>
            </select>
          </div>

          {message && <div className="quick-capture-message">{message}</div>}
        </div>

        <div className="quick-capture-actions">
          <button type="button" onClick={() => setIsOpen(false)} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="quick-capture-submit"
            onClick={() => void handleSubmit()}
            disabled={submitting}
          >
            {submitting ? "Saving..." : "Create Deadline"}
          </button>
        </div>
      </div>
    </>
  );
}
