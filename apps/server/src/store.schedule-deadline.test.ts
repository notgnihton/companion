import { describe, it, expect, beforeEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - Schedule and Deadlines", () => {
  let store: RuntimeStore;
  const userId = "test-user";

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
  });

  describe("schedule CRUD", () => {
    it("creates and lists schedule entries", () => {
      const lecture = store.createLectureEvent(userId, {
        title: "Algorithms",
        startTime: "2026-02-16T10:00:00.000Z",
        durationMinutes: 90,
        workload: "high"
      });

      expect(lecture.id).toMatch(/^lecture-/);
      expect(store.getScheduleEvents(userId)).toHaveLength(1);
      expect(store.getScheduleEvents(userId)[0]).toEqual(lecture);
      expect(store.getScheduleEventById(userId, lecture.id)).toEqual(lecture);
    });

    it("creates schedule entry with daily recurrence", () => {
      const lecture = store.createLectureEvent(userId, {
        title: "Algorithms",
        startTime: "2026-02-16T10:00:00.000Z",
        durationMinutes: 90,
        workload: "high",
        recurrence: {
          frequency: "daily",
          count: 5
        }
      });

      expect(lecture.id).toMatch(/^lecture-/);
      expect(lecture.recurrence).toEqual({
        frequency: "daily",
        count: 5
      });
      expect(store.getScheduleEvents(userId)).toHaveLength(1);
      expect(store.getScheduleEventById(userId, lecture.id)?.recurrence).toEqual({
        frequency: "daily",
        count: 5
      });
    });

    it("creates schedule entry with weekly recurrence", () => {
      const lecture = store.createLectureEvent(userId, {
        title: "Databases",
        startTime: "2026-02-17T14:00:00.000Z",
        durationMinutes: 120,
        workload: "medium",
        recurrence: {
          frequency: "weekly",
          byWeekDay: [1, 3],
          until: "2026-05-01T00:00:00.000Z"
        }
      });

      expect(lecture.recurrence).toEqual({
        frequency: "weekly",
        byWeekDay: [1, 3],
        until: "2026-05-01T00:00:00.000Z"
      });
    });

    it("creates schedule entry with monthly recurrence", () => {
      const lecture = store.createLectureEvent(userId, {
        title: "Seminar",
        startTime: "2026-02-15T16:00:00.000Z",
        durationMinutes: 60,
        workload: "low",
        recurrence: {
          frequency: "monthly",
          byMonthDay: 15,
          count: 6
        }
      });

      expect(lecture.recurrence).toEqual({
        frequency: "monthly",
        byMonthDay: 15,
        count: 6
      });
    });

    it("updates and deletes schedule entries", () => {
      const lecture = store.createLectureEvent(userId, {
        title: "Databases",
        startTime: "2026-02-16T12:00:00.000Z",
        durationMinutes: 60,
        workload: "medium"
      });

      const updated = store.updateScheduleEvent(userId, lecture.id, {
        durationMinutes: 75,
        workload: "high"
      });

      expect(updated).not.toBeNull();
      expect(updated?.durationMinutes).toBe(75);
      expect(updated?.workload).toBe("high");

      expect(store.deleteScheduleEvent(userId, lecture.id)).toBe(true);
      expect(store.getScheduleEvents(userId)).toHaveLength(0);
      expect(store.deleteScheduleEvent(userId, lecture.id)).toBe(false);
      expect(store.updateScheduleEvent(userId, "missing-id", { title: "Nope" })).toBeNull();
    });

    it("updates schedule entry with recurrence", () => {
      const lecture = store.createLectureEvent(userId, {
        title: "Algorithms",
        startTime: "2026-02-16T10:00:00.000Z",
        durationMinutes: 90,
        workload: "high"
      });

      const updated = store.updateScheduleEvent(userId, lecture.id, {
        recurrence: {
          frequency: "weekly",
          byWeekDay: [1, 3, 5],
          count: 10
        }
      });

      expect(updated).not.toBeNull();
      expect(updated?.recurrence).toEqual({
        frequency: "weekly",
        byWeekDay: [1, 3, 5],
        count: 10
      });
    });
  });

  describe("deadline CRUD", () => {
    it("creates and lists deadlines", () => {
      const deadline = store.createDeadline(userId, {
        course: "Operating Systems",
        task: "Lab Report",
        dueDate: "2026-02-17T23:59:00.000Z",
        priority: "high",
        completed: false,
        effortHoursRemaining: 6,
        effortConfidence: "medium"
      });

      expect(deadline.id).toMatch(/^deadline-/);
      expect(store.getDeadlines(userId, new Date(), false)).toHaveLength(1);
      expect(store.getDeadlines(userId, new Date(), false)[0]).toEqual(deadline);
      expect(store.getDeadlineById(userId, deadline.id, false)).toEqual(deadline);
    });

    it("updates and deletes deadlines", () => {
      const deadline = store.createDeadline(userId, {
        course: "Algorithms",
        task: "Problem Set 5",
        dueDate: "2026-02-18T22:00:00.000Z",
        priority: "critical",
        completed: false,
        effortHoursRemaining: 4,
        effortConfidence: "high"
      });

      const updated = store.updateDeadline(userId, deadline.id, {
        completed: true,
        priority: "medium",
        effortHoursRemaining: 2,
        effortConfidence: "low"
      });

      expect(updated).not.toBeNull();
      expect(updated?.completed).toBe(true);
      expect(updated?.priority).toBe("medium");
      expect(updated?.effortHoursRemaining).toBe(2);
      expect(updated?.effortConfidence).toBe("low");

      expect(store.deleteDeadline(userId, deadline.id)).toBe(true);
      expect(store.getDeadlines(userId)).toHaveLength(0);
      expect(store.deleteDeadline(userId, deadline.id)).toBe(false);
      expect(store.updateDeadline(userId, "missing-id", { completed: true })).toBeNull();
    });

    it("escalates approaching deadline priority without mutating completed items", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-01T12:00:00.000Z"));

      try {
        const urgent = store.createDeadline(userId, {
          course: "Operating Systems",
          task: "Lab report",
          dueDate: "2026-03-02T10:00:00.000Z", // ~22 hours away
          priority: "high",
          completed: false
        });
        const medium = store.createDeadline(userId, {
          course: "Databases",
          task: "Schema draft",
          dueDate: "2026-03-02T06:00:00.000Z", // ~18 hours away
          priority: "medium",
          completed: false
        });
        const done = store.createDeadline(userId, {
          course: "Math",
          task: "Worksheet",
          dueDate: "2026-03-02T02:00:00.000Z",
          priority: "low",
          completed: true
        });

        const deadlines = store.getDeadlines(userId);
        const escalatedUrgent = deadlines.find((d) => d.id === urgent.id);
        const escalatedMedium = deadlines.find((d) => d.id === medium.id);
        const completedDeadline = deadlines.find((d) => d.id === done.id);

        expect(escalatedUrgent?.priority).toBe("critical");
        expect(escalatedMedium?.priority).toBe("high");
        expect(completedDeadline?.priority).toBe("low");
      } finally {
        vi.useRealTimers();
      }
    });

    it("exposes only academic deadlines via academic view and can purge leaked non-academic records", () => {
      store.createDeadline(userId, {
        course: "DAT560",
        task: "LLM foundations – part 1",
        dueDate: "2026-03-02T02:00:00.000Z",
        priority: "medium",
        completed: false
      });
      store.createDeadline(userId, {
        course: "DAT560",
        task: "Assignment 2",
        dueDate: "2026-03-03T02:00:00.000Z",
        priority: "high",
        completed: false
      });
      store.createDeadline(userId, {
        course: "DAT560",
        task: "Language Models – part 2",
        dueDate: "2026-03-04T02:00:00.000Z",
        priority: "medium",
        completed: false,
        canvasAssignmentId: 998
      });

      const academic = store.getAcademicDeadlines(userId, new Date("2026-03-01T00:00:00.000Z"), false);
      expect(academic).toHaveLength(2);
      expect(academic.some((deadline) => deadline.task.includes("Assignment 2"))).toBe(true);
      expect(academic.some((deadline) => deadline.canvasAssignmentId === 998)).toBe(true);

      const removed = store.purgeNonAcademicDeadlines(userId);
      expect(removed).toBe(1);
      expect(store.getDeadlines(userId, new Date("2026-03-01T00:00:00.000Z"), false)).toHaveLength(2);
    });
  });

  describe("dashboard summary integration", () => {
    it("prefers tracked deadline count when available", () => {
      store.recordEvent({
        id: "evt-1",
        source: "assignment-tracker",
        eventType: "assignment.deadline",
        priority: "high",
        timestamp: "2026-02-16T09:00:00.000Z",
        payload: {}
      });

      store.createDeadline(userId, {
        course: "Math",
        task: "Worksheet",
        dueDate: "2026-02-18T12:00:00.000Z",
        priority: "medium",
        completed: false
      });
      store.createDeadline(userId, {
        course: "Physics",
        task: "Quiz Prep",
        dueDate: "2026-02-19T12:00:00.000Z",
        priority: "low",
        completed: true
      });

      expect(store.getSnapshot(userId).summary.pendingDeadlines).toBe(1);
    });
  });

  describe("push subscriptions", () => {
    it("upserts and removes push subscriptions", () => {
      const subscription = {
        endpoint: "https://example.com/subscription-1",
        expirationTime: null,
        keys: {
          p256dh: "p256dh-key",
          auth: "auth-key"
        }
      };

      store.addPushSubscription(userId, subscription);
      store.addPushSubscription(userId, { ...subscription, keys: { p256dh: "updated", auth: "updated" } });

      expect(store.getPushSubscriptions(userId)).toHaveLength(1);
      expect(store.getPushSubscriptions(userId)[0].keys.p256dh).toBe("updated");
      expect(store.removePushSubscription(userId, subscription.endpoint)).toBe(true);
      expect(store.removePushSubscription(userId, subscription.endpoint)).toBe(false);
    });

    it("notifies listeners when a notification is added", () => {
      const received: string[] = [];
      const unsubscribe = store.onNotification((notification) => {
        received.push(notification.title);
      });

      store.pushNotification(userId, {
        source: "orchestrator",
        title: "Test push",
        message: "Message body",
        priority: "low"
      });

      unsubscribe();
      store.pushNotification(userId, {
        source: "orchestrator",
        title: "Ignored",
        message: "Message body",
        priority: "low"
      });

      expect(received).toEqual(["Test push"]);
    });
  });
});
