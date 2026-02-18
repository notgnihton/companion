import { useEffect, useState } from "react";
import {
  deleteGoal,
  deleteHabit,
  getDailyJournalSummary,
  getGoals,
  getHabits,
  toggleGoalCheckIn,
  toggleHabitCheckIn,
  updateGoal,
  updateHabit
} from "../lib/api";
import { loadGoals, loadHabits, saveGoals, saveHabits } from "../lib/storage";
import { Goal, Habit, CheckInDay, DailyJournalSummary } from "../types";
import { hapticSuccess } from "../lib/haptics";

interface BusyState {
  type: "habit" | "goal";
  id: string;
}

interface HabitDraft {
  name: string;
  cadence: Habit["cadence"];
  targetPerWeek: number;
  motivation: string;
}

interface GoalDraft {
  title: string;
  cadence: Goal["cadence"];
  targetCount: number;
  dueDate: string;
  motivation: string;
}

function toDateInputValue(value: string | null): string {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

function toDueDateIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return `${trimmed}T23:59:00.000Z`;
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
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  const [habitDraft, setHabitDraft] = useState<HabitDraft | null>(null);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalDraft, setGoalDraft] = useState<GoalDraft | null>(null);

  const refreshSummary = async (): Promise<void> => {
    setSummaryLoading(true);
    setSummaryMessage("");
    const nextSummary = await getDailyJournalSummary({ forceRefresh: true });
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
    const result = await toggleHabitCheckIn(habit.id, !habit.todayCompleted);
    const next = result.item;
    if (next) {
      const merged = habits.map((existing) => (existing.id === habit.id ? next : existing));
      setHabits(merged);
      saveHabits(merged);
      if (next.todayCompleted && !habit.todayCompleted) {
        hapticSuccess();
      }
      if (result.queued) {
        setHabitMessage("Saved offline. Habit check-in queued and will sync automatically.");
      }
    } else {
      setHabitMessage("Could not update habit right now. Try again soon.");
    }
    setBusy(null);
  };

  const handleGoalToggle = async (goal: Goal): Promise<void> => {
    setBusy({ type: "goal", id: goal.id });
    setGoalMessage("");
    const result = await toggleGoalCheckIn(goal.id, !goal.todayCompleted);
    const next = result.item;
    if (next) {
      const merged = goals.map((existing) => (existing.id === goal.id ? next : existing));
      setGoals(merged);
      saveGoals(merged);
      if (next.todayCompleted && !goal.todayCompleted) {
        hapticSuccess();
      }
      if (result.queued) {
        setGoalMessage("Saved offline. Goal check-in queued and will sync automatically.");
      }
    } else {
      setGoalMessage("Could not update goal check-in right now.");
    }
    setBusy(null);
  };

  const beginHabitEdit = (habit: Habit): void => {
    setHabitMessage("");
    setEditingHabitId(habit.id);
    setHabitDraft({
      name: habit.name,
      cadence: habit.cadence,
      targetPerWeek: habit.targetPerWeek,
      motivation: habit.motivation ?? ""
    });
  };

  const cancelHabitEdit = (): void => {
    setEditingHabitId(null);
    setHabitDraft(null);
  };

  const saveHabitEdit = async (habitId: string): Promise<void> => {
    if (!habitDraft) {
      return;
    }

    const name = habitDraft.name.trim();
    if (!name) {
      setHabitMessage("Habit name cannot be empty.");
      return;
    }

    const targetPerWeek = Math.max(1, Math.min(7, Math.round(habitDraft.targetPerWeek)));
    setBusy({ type: "habit", id: habitId });
    setHabitMessage("");

    const updated = await updateHabit(habitId, {
      name,
      cadence: habitDraft.cadence,
      targetPerWeek,
      motivation: habitDraft.motivation.trim() ? habitDraft.motivation.trim() : null
    });

    if (!updated) {
      setHabitMessage("Could not save habit changes right now.");
      setBusy(null);
      return;
    }

    const nextHabits = habits.map((habit) => (habit.id === habitId ? updated : habit));
    setHabits(nextHabits);
    saveHabits(nextHabits);
    cancelHabitEdit();
    hapticSuccess();
    setBusy(null);
  };

  const handleDeleteHabit = async (habit: Habit): Promise<void> => {
    if (!window.confirm(`Delete habit "${habit.name}"?`)) {
      return;
    }

    setBusy({ type: "habit", id: habit.id });
    setHabitMessage("");

    const deleted = await deleteHabit(habit.id);
    if (!deleted) {
      setHabitMessage("Could not delete habit right now.");
      setBusy(null);
      return;
    }

    const nextHabits = habits.filter((existing) => existing.id !== habit.id);
    setHabits(nextHabits);
    saveHabits(nextHabits);
    if (editingHabitId === habit.id) {
      cancelHabitEdit();
    }
    hapticSuccess();
    setBusy(null);
  };

  const beginGoalEdit = (goal: Goal): void => {
    setGoalMessage("");
    setEditingGoalId(goal.id);
    setGoalDraft({
      title: goal.title,
      cadence: goal.cadence,
      targetCount: goal.targetCount,
      dueDate: toDateInputValue(goal.dueDate),
      motivation: goal.motivation ?? ""
    });
  };

  const cancelGoalEdit = (): void => {
    setEditingGoalId(null);
    setGoalDraft(null);
  };

  const saveGoalEdit = async (goalId: string): Promise<void> => {
    if (!goalDraft) {
      return;
    }

    const title = goalDraft.title.trim();
    if (!title) {
      setGoalMessage("Goal title cannot be empty.");
      return;
    }

    const targetCount = Math.max(1, Math.round(goalDraft.targetCount));
    setBusy({ type: "goal", id: goalId });
    setGoalMessage("");

    const updated = await updateGoal(goalId, {
      title,
      cadence: goalDraft.cadence,
      targetCount,
      dueDate: toDueDateIso(goalDraft.dueDate),
      motivation: goalDraft.motivation.trim() ? goalDraft.motivation.trim() : null
    });

    if (!updated) {
      setGoalMessage("Could not save goal changes right now.");
      setBusy(null);
      return;
    }

    const nextGoals = goals.map((goal) => (goal.id === goalId ? updated : goal));
    setGoals(nextGoals);
    saveGoals(nextGoals);
    cancelGoalEdit();
    hapticSuccess();
    setBusy(null);
  };

  const handleDeleteGoal = async (goal: Goal): Promise<void> => {
    if (!window.confirm(`Delete goal "${goal.title}"?`)) {
      return;
    }

    setBusy({ type: "goal", id: goal.id });
    setGoalMessage("");

    const deleted = await deleteGoal(goal.id);
    if (!deleted) {
      setGoalMessage("Could not delete goal right now.");
      setBusy(null);
      return;
    }

    const nextGoals = goals.filter((existing) => existing.id !== goal.id);
    setGoals(nextGoals);
    saveGoals(nextGoals);
    if (editingGoalId === goal.id) {
      cancelGoalEdit();
    }
    hapticSuccess();
    setBusy(null);
  };

  const renderHabit = (habit: Habit): JSX.Element => {
    const isEditing = editingHabitId === habit.id && habitDraft !== null;
    const isBusy = busy?.type === "habit" && busy.id === habit.id;

    if (isEditing && habitDraft) {
      return (
        <article key={habit.id} className="habit-card">
          <p className="eyebrow">Habit</p>
          <form
            className="habit-edit-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveHabitEdit(habit.id);
            }}
          >
            <label>
              Name
              <input
                type="text"
                value={habitDraft.name}
                onChange={(event) => setHabitDraft({ ...habitDraft, name: event.target.value })}
                maxLength={120}
              />
            </label>
            <label>
              Cadence
              <select
                value={habitDraft.cadence}
                onChange={(event) => setHabitDraft({ ...habitDraft, cadence: event.target.value as Habit["cadence"] })}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            <label>
              Weekly target
              <input
                type="number"
                min={1}
                max={7}
                value={habitDraft.targetPerWeek}
                onChange={(event) =>
                  setHabitDraft({
                    ...habitDraft,
                    targetPerWeek: Number.isFinite(event.target.valueAsNumber)
                      ? event.target.valueAsNumber
                      : habitDraft.targetPerWeek
                  })
                }
              />
            </label>
            <label>
              Motivation
              <input
                type="text"
                value={habitDraft.motivation}
                onChange={(event) => setHabitDraft({ ...habitDraft, motivation: event.target.value })}
                maxLength={240}
              />
            </label>
            <div className="habit-card-actions">
              <button type="submit" className="pill-button" disabled={isBusy}>
                {isBusy ? "Saving..." : "Save"}
              </button>
              <button type="button" className="ghost-button" onClick={cancelHabitEdit} disabled={isBusy}>
                Cancel
              </button>
              <button
                type="button"
                className="ghost-button habit-delete-button"
                onClick={() => void handleDeleteHabit(habit)}
                disabled={isBusy}
              >
                Delete
              </button>
            </div>
          </form>
        </article>
      );
    }

    return (
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
        </header>
        <ProgressLabel streak={habit.streak} completionRate={habit.completionRate7d} />
        <CheckInStrip recent={habit.recentCheckIns} />
        <div className="habit-card-actions">
          <button
            type="button"
            onClick={() => void handleHabitToggle(habit)}
            className={`pill-button ${habit.todayCompleted ? "pill-active" : ""}`}
            disabled={isBusy}
          >
            {habit.todayCompleted ? "Checked in" : "Check in"}
          </button>
          <button type="button" className="ghost-button" onClick={() => beginHabitEdit(habit)} disabled={isBusy}>
            Edit
          </button>
          <button
            type="button"
            className="ghost-button habit-delete-button"
            onClick={() => void handleDeleteHabit(habit)}
            disabled={isBusy}
          >
            Delete
          </button>
        </div>
      </article>
    );
  };

  const renderGoal = (goal: Goal): JSX.Element => {
    const progressPercent = Math.min(100, Math.round((goal.progressCount / goal.targetCount) * 100));

    const dueLabel =
      goal.dueDate &&
      new Date(goal.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });

    const isEditing = editingGoalId === goal.id && goalDraft !== null;
    const isBusy = busy?.type === "goal" && busy.id === goal.id;

    if (isEditing && goalDraft) {
      return (
        <article key={goal.id} className="habit-card goal-card">
          <p className="eyebrow">Goal</p>
          <form
            className="habit-edit-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveGoalEdit(goal.id);
            }}
          >
            <label>
              Title
              <input
                type="text"
                value={goalDraft.title}
                onChange={(event) => setGoalDraft({ ...goalDraft, title: event.target.value })}
                maxLength={160}
              />
            </label>
            <label>
              Cadence
              <select
                value={goalDraft.cadence}
                onChange={(event) => setGoalDraft({ ...goalDraft, cadence: event.target.value as Goal["cadence"] })}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            <label>
              Target check-ins
              <input
                type="number"
                min={1}
                max={365}
                value={goalDraft.targetCount}
                onChange={(event) =>
                  setGoalDraft({
                    ...goalDraft,
                    targetCount: Number.isFinite(event.target.valueAsNumber)
                      ? event.target.valueAsNumber
                      : goalDraft.targetCount
                  })
                }
              />
            </label>
            <label>
              Due date
              <input
                type="date"
                value={goalDraft.dueDate}
                onChange={(event) => setGoalDraft({ ...goalDraft, dueDate: event.target.value })}
              />
            </label>
            <label>
              Motivation
              <input
                type="text"
                value={goalDraft.motivation}
                onChange={(event) => setGoalDraft({ ...goalDraft, motivation: event.target.value })}
                maxLength={240}
              />
            </label>
            <div className="habit-card-actions">
              <button type="submit" className="pill-button" disabled={isBusy}>
                {isBusy ? "Saving..." : "Save"}
              </button>
              <button type="button" className="ghost-button" onClick={cancelGoalEdit} disabled={isBusy}>
                Cancel
              </button>
              <button
                type="button"
                className="ghost-button habit-delete-button"
                onClick={() => void handleDeleteGoal(goal)}
                disabled={isBusy}
              >
                Delete
              </button>
            </div>
          </form>
        </article>
      );
    }

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
        <div className="habit-card-actions">
          <button
            type="button"
            onClick={() => void handleGoalToggle(goal)}
            className={`pill-button ${goal.todayCompleted ? "pill-active" : ""}`}
            disabled={isBusy}
          >
            {goal.todayCompleted ? "Logged today" : "Log progress"}
          </button>
          <button type="button" className="ghost-button" onClick={() => beginGoalEdit(goal)} disabled={isBusy}>
            Edit
          </button>
          <button
            type="button"
            className="ghost-button habit-delete-button"
            onClick={() => void handleDeleteGoal(goal)}
            disabled={isBusy}
          >
            Delete
          </button>
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
      {habitMessage && <p className="warning-text">{habitMessage}</p>}
      {goalMessage && <p className="warning-text">{goalMessage}</p>}
      {summaryMessage && <p className="warning-text">{summaryMessage}</p>}

      <div className="habit-grid">
        {habits.map(renderHabit)}
        {habits.length === 0 && <p className="muted">No habits yet. Ask Gemini to create one, then edit it here.</p>}
      </div>

      <div className="habit-grid">
        {goals.map(renderGoal)}
        {goals.length === 0 && <p className="muted">No goals tracked yet. Ask Gemini to create one, then edit it here.</p>}
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
    </section>
  );
}
