import { useEffect, useState } from "react";
import {
  getDailyGrowthSummary,
  getGoals,
  getHabits,
  toggleHabitCheckIn,
  toggleGoalCheckIn
} from "../lib/api";
import { Goal, Habit, DailyGrowthSummary } from "../types";
import { hapticSuccess } from "../lib/haptics";

interface BusyState {
  type: "habit" | "goal";
  id: string;
}

export function HabitsGoalsView(): JSX.Element {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [dailySummary, setDailySummary] = useState<DailyGrowthSummary | null>(null);
  const [summaryMessage, setSummaryMessage] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [busy, setBusy] = useState<BusyState | null>(null);

  const refreshSummary = async (): Promise<void> => {
    setSummaryLoading(true);
    setSummaryMessage("");
    const nextSummary = await getDailyGrowthSummary({ forceRefresh: true });
    if (nextSummary) {
      setDailySummary(nextSummary);
    } else {
      setSummaryMessage("Could not generate daily summary right now.");
    }
    setSummaryLoading(false);
  };

  useEffect(() => {
    let disposed = false;

    const sync = async (): Promise<void> => {
      try {
        const [habitData, goalData, summaryData] = await Promise.all([getHabits(), getGoals(), getDailyGrowthSummary()]);
        if (!disposed) {
          setHabits(habitData);
          setGoals(goalData);
          if (summaryData) {
            setDailySummary(summaryData);
          } else {
            setSummaryMessage("Could not generate daily summary right now.");
          }
        }
      } catch {
        // offline fallback already handled by API helpers
      } finally {
        if (!disposed) {
          setSummaryLoading(false);
        }
      }
    };

    void sync();
    return () => {
      disposed = true;
    };
  }, []);

  const handleHabitCheckIn = async (habit: Habit): Promise<void> => {
    setBusy({ type: "habit", id: habit.id });
    const result = await toggleHabitCheckIn(habit.id, !habit.todayCompleted);
    if (result.item) {
      setHabits((prev) => prev.map((h) => (h.id === habit.id ? result.item! : h)));
      hapticSuccess();
    }
    setBusy(null);
  };

  const handleGoalCheckIn = async (goal: Goal): Promise<void> => {
    setBusy({ type: "goal", id: goal.id });
    const result = await toggleGoalCheckIn(goal.id, !goal.todayCompleted);
    if (result.item) {
      setGoals((prev) => prev.map((g) => (g.id === goal.id ? result.item! : g)));
      hapticSuccess();
    }
    setBusy(null);
  };

  const renderHabit = (habit: Habit): JSX.Element => {
    const isBusy = busy?.type === "habit" && busy.id === habit.id;
    const completionPercent = Math.max(0, Math.min(100, Math.round(habit.completionRate7d)));

    return (
      <article key={habit.id} className="habit-card habit-card-compact">
        <header className="habit-card-header">
          <div>
            <p className="eyebrow">Habit</p>
            <h3>{habit.name}</h3>
            <p className="muted">
              {habit.cadence === "daily" ? "Daily" : "Weekly"} • {habit.targetPerWeek}/week
              {habit.streak > 0 ? ` • ${habit.streak} day streak` : ""}
            </p>
            {habit.motivation && <p className="muted">{habit.motivation}</p>}
          </div>
          <button
            type="button"
            className={`habit-checkin-button ${habit.todayCompleted ? "habit-checkin-done" : ""}`}
            onClick={() => void handleHabitCheckIn(habit)}
            disabled={isBusy}
            aria-label={habit.todayCompleted ? "Undo check-in" : "Check in"}
          >
            {isBusy ? "…" : habit.todayCompleted ? "✓" : "○"}
          </button>
        </header>
        <div className="habit-visual-progress">
          <div className={`habit-visual-progress-fill${habit.streakGraceUsed ? " habit-visual-progress-grace" : ""}`} style={{ width: `${completionPercent}%` }} />
        </div>
      </article>
    );
  };

  const renderGoal = (goal: Goal): JSX.Element => {
    const progressPercent = Math.min(100, Math.round((goal.progressCount / goal.targetCount) * 100));
    const dueLabel =
      goal.dueDate &&
      new Date(goal.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const isBusy = busy?.type === "goal" && busy.id === goal.id;

    return (
      <article key={goal.id} className="habit-card goal-card habit-card-compact">
        <header className="habit-card-header">
          <div>
            <p className="eyebrow">Goal</p>
            <h3>{goal.title}</h3>
            <p className="muted">
              {goal.progressCount}/{goal.targetCount} check-ins
              {dueLabel ? ` • due ${dueLabel}` : ""}
              {goal.streak > 0 ? ` • ${goal.streak} day streak` : ""}
            </p>
            {goal.motivation && <p className="muted">{goal.motivation}</p>}
          </div>
          <button
            type="button"
            className={`habit-checkin-button ${goal.todayCompleted ? "habit-checkin-done" : ""}`}
            onClick={() => void handleGoalCheckIn(goal)}
            disabled={isBusy}
            aria-label={goal.todayCompleted ? "Undo check-in" : "Check in"}
          >
            {isBusy ? "…" : goal.todayCompleted ? "✓" : "○"}
          </button>
        </header>
        <div className="goal-progress">
          <div className="goal-progress-bar">
            <div className={`goal-progress-fill${goal.streakGraceUsed ? " goal-progress-grace" : ""}`} style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      </article>
    );
  };

  return (
    <section className="panel habit-goal-panel">
      <header className="panel-header">
        <h2>Habits & Goals</h2>
        <div className="pill-group">
          <span className="pill-muted">{habits.length} habits</span>
          <span className="pill-muted">{goals.length} goals</span>
        </div>
      </header>

      <div className="habit-grid">
        {habits.map(renderHabit)}
        {habits.length === 0 && <p className="muted">No habits yet — ask Gemini to create one.</p>}
      </div>

      <div className="habit-grid">
        {goals.map(renderGoal)}
        {goals.length === 0 && <p className="muted">No goals yet — ask Gemini to create one.</p>}
      </div>

      <section className="daily-summary-panel">
        <header className="panel-header">
          <h3>Daily Reflection Summary</h3>
          <button type="button" className="ghost-button" onClick={() => void refreshSummary()} disabled={summaryLoading}>
            {summaryLoading ? "Refreshing..." : "Refresh"}
          </button>
        </header>
        {summaryLoading && <p className="muted">Generating today's summary...</p>}
        {!summaryLoading && dailySummary && (
          <>
            {dailySummary.visual && (
              <figure className="daily-summary-visual">
                <img src={dailySummary.visual.dataUrl} alt={dailySummary.visual.alt} loading="lazy" />
                <figcaption>
                  {dailySummary.visual.model} • {new Date(dailySummary.visual.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}
                </figcaption>
              </figure>
            )}
            <p className="daily-summary-meta">
              {dailySummary.chatMessageCount} chat notes
            </p>
            <p className="daily-summary-text">{dailySummary.summary}</p>
            {dailySummary.highlights.length > 0 && (
              <ul className="daily-summary-list">
                {dailySummary.highlights.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </section>
  );
}
