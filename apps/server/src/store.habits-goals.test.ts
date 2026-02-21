import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - habits and goals", () => {
  let store: RuntimeStore;
  const userId = "test-user";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T12:00:00.000Z"));
    store = new RuntimeStore(":memory:");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with no seeded habits or goals", () => {
    expect(store.getHabitsWithStatus(userId)).toEqual([]);
    expect(store.getGoalsWithStatus(userId)).toEqual([]);
  });

  it("creates habits and tracks daily streaks", () => {
    const habit = store.createHabit(userId, {
      name: "Evening stretch",
      cadence: "daily",
      targetPerWeek: 6,
      motivation: "Stay loose after study sessions"
    });

    store.toggleHabitCheckIn(userId, habit.id, { date: "2026-02-14T18:00:00.000Z", completed: true });
    const updated = store.toggleHabitCheckIn(userId, habit.id, { date: "2026-02-15T07:30:00.000Z", completed: true });

    expect(updated).not.toBeNull();
    expect(updated?.todayCompleted).toBe(true);
    expect(updated?.streak).toBe(2);
    expect(updated?.recentCheckIns[6].completed).toBe(true);
    expect(updated?.completionRate7d).toBeGreaterThan(0);
  });

  it("allows streak recovery within 24hrs of a missed day", () => {
    const habit = store.createHabit(userId, {
      name: "Hydrate",
      cadence: "daily",
      targetPerWeek: 7
    });

    store.toggleHabitCheckIn(userId, habit.id, { date: "2026-02-14T18:00:00.000Z", completed: true });
    store.toggleHabitCheckIn(userId, habit.id, { date: "2026-02-16T07:30:00.000Z", completed: true });

    vi.setSystemTime(new Date("2026-02-16T12:00:00.000Z"));
    const recovered = store.getHabitsWithStatus(userId).find((h) => h.id === habit.id);

    // Grace bridges the gap (Feb 15 missed) but doesn't count it as a streak day
    expect(recovered?.streak).toBe(2);
  });

  it("tracks goal progress, remaining counts, and allows toggling check-ins", () => {
    const goal = store.createGoal(userId, {
      title: "Ship resume updates",
      cadence: "daily",
      targetCount: 3,
      dueDate: "2026-02-20T00:00:00.000Z"
    });

    store.toggleGoalCheckIn(userId, goal.id, { date: "2026-02-14T12:00:00.000Z", completed: true });
    const status = store.toggleGoalCheckIn(userId, goal.id, { completed: true });

    expect(status).not.toBeNull();
    expect(status?.progressCount).toBeGreaterThanOrEqual(2);
    expect(status?.remaining).toBeLessThanOrEqual(1);
    expect(status?.streak).toBeGreaterThanOrEqual(1);

    const reversed = store.toggleGoalCheckIn(userId, goal.id, { completed: false });
    expect(reversed?.progressCount).toBe(status?.progressCount ? status.progressCount - 1 : 0);
  });

  it("updates and deletes habits", () => {
    const habit = store.createHabit(userId, {
      name: "Evening stretch",
      cadence: "daily",
      targetPerWeek: 6,
      motivation: "Stay loose"
    });

    const updated = store.updateHabit(userId, habit.id, {
      name: "Evening mobility",
      cadence: "weekly",
      targetPerWeek: 4,
      motivation: "Recovery first"
    });

    expect(updated).not.toBeNull();
    expect(updated?.name).toBe("Evening mobility");
    expect(updated?.cadence).toBe("weekly");
    expect(updated?.targetPerWeek).toBe(4);
    expect(updated?.motivation).toBe("Recovery first");

    expect(store.deleteHabit(userId, habit.id)).toBe(true);
    expect(store.getHabitById(userId, habit.id)).toBeNull();
  });

  it("updates and deletes goals", () => {
    const goal = store.createGoal(userId, {
      title: "Ship portfolio",
      cadence: "daily",
      targetCount: 5,
      dueDate: "2026-02-20T00:00:00.000Z",
      motivation: "Internship prep"
    });

    const updated = store.updateGoal(userId, goal.id, {
      title: "Ship portfolio v2",
      cadence: "weekly",
      targetCount: 8,
      dueDate: null,
      motivation: "Interview readiness"
    });

    expect(updated).not.toBeNull();
    expect(updated?.title).toBe("Ship portfolio v2");
    expect(updated?.cadence).toBe("weekly");
    expect(updated?.targetCount).toBe(8);
    expect(updated?.dueDate).toBeNull();
    expect(updated?.motivation).toBe("Interview readiness");

    expect(store.deleteGoal(userId, goal.id)).toBe(true);
    expect(store.getGoalById(userId, goal.id)).toBeNull();
  });
});
