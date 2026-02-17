import { useEffect, useState } from "react";
import { getDailyJournalSummary, getGoals, getHabits, toggleGoalCheckIn, toggleHabitCheckIn } from "../lib/api";
import { loadGoals, loadHabits, saveGoals, saveHabits } from "../lib/storage";
import { Goal, Habit, CheckInDay, DailyJournalSummary } from "../types";
import { hapticSuccess } from "../lib/haptics";

interface BusyState {
  type: "habit" | "goal";
  id: string;
}

function CheckInStrip({ recent }: { recent: CheckInDay[] }): JSX.Element {
  return (
    <div className="checkin-strip" aria-label="Recent check-ins">
      {recent.map((day) => (
        <span
          key={day.date}
          className={`checkin-dot ${day.completed ? "checkin-dot-complete" : ""}`}
          title={`${day.date}: ${day.completed ? "Completed" : "Missed"}`}
        />
      ))}
    </div>
  );
}

function ProgressLabel({ streak, completionRate }: { streak: number; completionRate: number }): JSX.Element {
  return (
    <div className="checkin-meta">
      <span className="streak-pill">{streak} day streak</span>
      <span className="completion-pill">{completionRate}% last 7 days</span>
    </div>
  );
}

export function HabitsGoalsView(): JSX.Element {
  const [habits, setHabits] = useState<Habit[]>(() => loadHabits());
  const [goals, setGoals] = useState<Goal[]>(() => loadGoals());
  const [dailySummary, setDailySummary] = useState<DailyJournalSummary | null>(null);
  const [habitMessage, setHabitMessage] = useState("");
  const [goalMessage, setGoalMessage] = useState("");
  const [summaryMessage, setSummaryMessage] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [busy, setBusy] = useState<BusyState | null>(null);

  const refreshSummary = async (): Promise<void> => {
    setSummaryLoading(true);
    setSummaryMessage("");
    const nextSummary = await getDailyJournalSummary();
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
        const [habitData, goalData, summaryData] = await Promise.all([getHabits(), getGoals(), getDailyJournalSummary()]);
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

  const handleHabitToggle = async (habit: Habit): Promise<void> => {
    setBusy({ type: "habit", id: habit.id });
    setHabitMessage("");
    const next = await toggleHabitCheckIn(habit.id, !habit.todayCompleted);
    if (next) {
      const merged = habits.map((existing) => (existing.id === habit.id ? next : existing));
      setHabits(merged);
      saveHabits(merged);
      if (next.todayCompleted && !habit.todayCompleted) {
        hapticSuccess();
      }
    } else {
      setHabitMessage("Could not update habit right now. Try again soon.");
    }
    setBusy(null);
  };

  const handleGoalToggle = async (goal: Goal): Promise<void> => {
    setBusy({ type: "goal", id: goal.id });
    setGoalMessage("");
    const next = await toggleGoalCheckIn(goal.id, !goal.todayCompleted);
    if (next) {
      const merged = goals.map((existing) => (existing.id === goal.id ? next : existing));
      setGoals(merged);
      saveGoals(merged);
      if (next.todayCompleted && !goal.todayCompleted) {
        hapticSuccess();
      }
    } else {
      setGoalMessage("Could not update goal check-in right now.");
    }
    setBusy(null);
  };

  const renderHabit = (habit: Habit): JSX.Element => (
    <article key={habit.id} className="habit-card">
      <header className="habit-card-header">
        <div>
          <p className="eyebrow">Habit</p>
          <h3>{habit.name}</h3>
          {habit.motivation && <p className="muted">{habit.motivation}</p>}
          <p className="muted">
            {habit.cadence === "daily" ? "Daily" : "Weekly target"} • {habit.targetPerWeek}/week
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleHabitToggle(habit)}
          className={`pill-button ${habit.todayCompleted ? "pill-active" : ""}`}
          disabled={busy?.type === "habit" && busy.id === habit.id}
        >
          {habit.todayCompleted ? "Checked in" : "Check in"}
        </button>
      </header>
      <ProgressLabel streak={habit.streak} completionRate={habit.completionRate7d} />
      <CheckInStrip recent={habit.recentCheckIns} />
    </article>
  );

  const renderGoal = (goal: Goal): JSX.Element => {
    const progressPercent = Math.min(100, Math.round((goal.progressCount / goal.targetCount) * 100));

    const dueLabel =
      goal.dueDate &&
      new Date(goal.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });

    return (
      <article key={goal.id} className="habit-card goal-card">
        <header className="habit-card-header">
          <div>
            <p className="eyebrow">Goal</p>
            <h3>{goal.title}</h3>
            {goal.motivation && <p className="muted">{goal.motivation}</p>}
            <p className="muted">
              Target {goal.targetCount} check-ins {dueLabel ? `• due ${dueLabel}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleGoalToggle(goal)}
            className={`pill-button ${goal.todayCompleted ? "pill-active" : ""}`}
            disabled={busy?.type === "goal" && busy.id === goal.id}
          >
            {goal.todayCompleted ? "Logged today" : "Log progress"}
          </button>
        </header>
        <div className="goal-progress">
          <div className="goal-progress-bar">
            <div className="goal-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="goal-progress-meta">
            <span>
              {goal.progressCount}/{goal.targetCount} check-ins
            </span>
            <span className="muted-small">{goal.remaining} remaining</span>
          </div>
        </div>
        <ProgressLabel streak={goal.streak} completionRate={goal.completionRate7d} />
        <CheckInStrip recent={goal.recentCheckIns} />
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
      {habitMessage && <p className="warning-text">{habitMessage}</p>}
      {goalMessage && <p className="warning-text">{goalMessage}</p>}
      {summaryMessage && <p className="warning-text">{summaryMessage}</p>}

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
            <p className="daily-summary-meta">
              {dailySummary.chatMessageCount} chat notes • {dailySummary.journalEntryCount} journal entries
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

      <div className="habit-grid">
        {habits.map(renderHabit)}
        {habits.length === 0 && <p className="muted">No habits yet. Create one on your phone to start tracking.</p>}
      </div>

      <div className="habit-grid">
        {goals.map(renderGoal)}
        {goals.length === 0 && <p className="muted">No goals tracked yet. Add one to see streaks and progress.</p>}
      </div>
    </section>
  );
}
