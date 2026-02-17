import { useCallback, useEffect, useMemo, useState } from "react";
import { getAnalyticsCoachInsight } from "../lib/api";
import { AnalyticsCoachInsight } from "../types";

type PeriodDays = 7 | 14 | 30;

const PERIOD_OPTIONS: PeriodDays[] = [7, 14, 30];

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function AnalyticsDashboard(): JSX.Element {
  const [periodDays, setPeriodDays] = useState<PeriodDays>(14);
  const [insight, setInsight] = useState<AnalyticsCoachInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInsight = useCallback(async (days: PeriodDays, options: { forceRefresh?: boolean } = {}): Promise<void> => {
    setLoading(true);
    setError(null);

    const next = await getAnalyticsCoachInsight(days, options);
    if (!next) {
      setError("Could not load narrative analytics right now.");
      setLoading(false);
      return;
    }

    setInsight(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadInsight(periodDays);
  }, [periodDays, loadInsight]);

  const metricRows = useMemo(() => {
    if (!insight) {
      return [];
    }

    return [
      `${insight.metrics.deadlinesCompleted}/${insight.metrics.deadlinesDue} deadlines completed`,
      `${insight.metrics.averageHabitCompletion7d}% average habit completion (7d)`,
      `${insight.metrics.studySessionsDone}/${insight.metrics.studySessionsPlanned} study sessions completed`,
      `${insight.metrics.openHighPriorityDeadlines} urgent high-priority deadlines`,
      `${insight.metrics.journalEntries + insight.metrics.userReflections} reflection signals`,
      `Energy: ${insight.metrics.dominantEnergy ?? "unknown"} • Stress: ${insight.metrics.dominantStress ?? "unknown"}`
    ];
  }, [insight]);

  return (
    <div className="analytics-container">
      <header className="analytics-header">
        <div>
          <h2 className="analytics-title">Narrative Analytics</h2>
          <p className="analytics-subtitle">Gemini coaching over your recent patterns.</p>
        </div>

        <div className="analytics-controls">
          <div className="analytics-period-picker" role="tablist" aria-label="Analysis period">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={option === periodDays ? "analytics-period-button active" : "analytics-period-button"}
                onClick={() => setPeriodDays(option)}
                aria-pressed={option === periodDays}
                disabled={loading && option === periodDays}
              >
                {option}d
              </button>
            ))}
          </div>

          <button
            type="button"
            className="analytics-refresh"
            onClick={() => void loadInsight(periodDays, { forceRefresh: true })}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {loading && !insight && <p>Loading analytics...</p>}

      {insight && (
        <>
          <section className="analytics-summary-card">
            <div className="analytics-summary-meta">
              <span>{insight.source === "gemini" ? "Gemini insight" : "Fallback insight"}</span>
              <span>{formatGeneratedAt(insight.generatedAt)}</span>
            </div>
            <p>{insight.summary}</p>
          </section>

          <section className="analytics-metrics-grid">
            {metricRows.map((metric) => (
              <p key={metric} className="analytics-metric-pill">
                {metric}
              </p>
            ))}
          </section>

          <div className="analytics-grid">
            <section className="analytics-card">
              <h3>Strengths</h3>
              <ul className="analytics-list">
                {insight.strengths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="analytics-card analytics-card-risk">
              <h3>Risks</h3>
              <ul className="analytics-list">
                {insight.risks.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="analytics-card analytics-card-recommendation">
              <h3>Steering Recommendations</h3>
              <ol className="analytics-list analytics-list-numbered">
                {insight.recommendations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
