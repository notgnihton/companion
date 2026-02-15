import { useEffect, useMemo, useState } from "react";
import { getWeeklySummary } from "../lib/api";
import { WeeklySummary } from "../types";

export function WeeklyReviewView(): JSX.Element {
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const suggestions = useMemo(() => {
    if (!summary) {
      return [];
    }

    const next: string[] = [];

    if (summary.completionRate < 50) {
      next.push("Reduce this week to one or two high-impact deadlines first.");
    } else if (summary.completionRate < 80) {
      next.push("Protect one daily focus block to raise completion consistency.");
    } else {
      next.push("Keep current cadence and add one stretch goal for next week.");
    }

    if (summary.deadlinesDue > summary.deadlinesCompleted) {
      next.push("Confirm overdue task status so reminders stay accurate.");
    }

    if (summary.journalHighlights.length === 0) {
      next.push("Capture at least one reflection each day to improve planning context.");
    }

    return next;
  }, [summary]);

  useEffect(() => {
    void refresh();
  }, []);

  const refresh = async (): Promise<void> => {
    setBusy(true);
    setError("");

    const response = await getWeeklySummary();

    if (!response) {
      setError("Weekly summary is unavailable.");
      setBusy(false);
      return;
    }

    setSummary(response);
    setBusy(false);
  };

  const formatDate = (value: string): string =>
    new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric"
    });

  return (
    <section className="panel weekly-review-panel">
      <header className="panel-header">
        <h2>Weekly Reflection</h2>
        <button type="button" onClick={() => void refresh()} disabled={busy}>
          {busy ? "Loading..." : "Refresh"}
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      {summary && (
        <>
          <p className="weekly-review-window">
            {formatDate(summary.windowStart)} to {formatDate(summary.windowEnd)}
          </p>
          <div className="weekly-review-metrics">
            <p>Completion rate: {summary.completionRate}%</p>
            <p>
              Deadlines completed: {summary.deadlinesCompleted}/{summary.deadlinesDue}
            </p>
          </div>
          <div className="weekly-review-section">
            <h3>Highlights</h3>
            {summary.journalHighlights.length === 0 ? (
              <p className="weekly-review-empty">No journal highlights in this window.</p>
            ) : (
              <ul>
                {summary.journalHighlights.map((entry) => (
                  <li key={entry.id}>{entry.content}</li>
                ))}
              </ul>
            )}
          </div>
          {suggestions.length > 0 && (
            <div className="weekly-review-section">
              <h3>Suggested Priorities</h3>
              <ul>
                {suggestions.map((suggestion) => (
                  <li key={suggestion}>{suggestion}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
