import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - Schedule and Deadlines", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
  });

  describe("schedule CRUD", () => {
    it("creates and lists schedule entries", () => {
      const lecture = store.createLectureEvent({
        title: "Algorithms",
        startTime: "2026-02-16T10:00:00.000Z",
        durationMinutes: 90,
        workload: "high"
      });

      expect(lecture.id).toMatch(/^lecture-/);
      expect(store.getScheduleEvents()).toHaveLength(1);
      expect(store.getScheduleEvents()[0]).toEqual(lecture);
      expect(store.getScheduleEventById(lecture.id)).toEqual(lecture);
    });

    it("updates and deletes schedule entries", () => {
      const lecture = store.createLectureEvent({
        title: "Databases",
        startTime: "2026-02-16T12:00:00.000Z",
        durationMinutes: 60,
        workload: "medium"
      });

      const updated = store.updateScheduleEvent(lecture.id, {
        durationMinutes: 75,
        workload: "high"
      });

      expect(updated).not.toBeNull();
      expect(updated?.durationMinutes).toBe(75);
      expect(updated?.workload).toBe("high");

      expect(store.deleteScheduleEvent(lecture.id)).toBe(true);
      expect(store.getScheduleEvents()).toHaveLength(0);
      expect(store.deleteScheduleEvent(lecture.id)).toBe(false);
      expect(store.updateScheduleEvent("missing-id", { title: "Nope" })).toBeNull();
    });
  });

  describe("deadline CRUD", () => {
    it("creates and lists deadlines", () => {
      const deadline = store.createDeadline({
        course: "Operating Systems",
        task: "Lab Report",
        dueDate: "2026-02-17T23:59:00.000Z",
        priority: "high",
        completed: false
      });

      expect(deadline.id).toMatch(/^deadline-/);
      expect(store.getDeadlines()).toHaveLength(1);
      expect(store.getDeadlines()[0]).toEqual(deadline);
      expect(store.getDeadlineById(deadline.id)).toEqual(deadline);
    });

    it("updates and deletes deadlines", () => {
      const deadline = store.createDeadline({
        course: "Algorithms",
        task: "Problem Set 5",
        dueDate: "2026-02-18T22:00:00.000Z",
        priority: "critical",
        completed: false
      });

      const updated = store.updateDeadline(deadline.id, {
        completed: true,
        priority: "medium"
      });

      expect(updated).not.toBeNull();
      expect(updated?.completed).toBe(true);
      expect(updated?.priority).toBe("medium");

      expect(store.deleteDeadline(deadline.id)).toBe(true);
      expect(store.getDeadlines()).toHaveLength(0);
      expect(store.deleteDeadline(deadline.id)).toBe(false);
      expect(store.updateDeadline("missing-id", { completed: true })).toBeNull();
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

      store.createDeadline({
        course: "Math",
        task: "Worksheet",
        dueDate: "2026-02-18T12:00:00.000Z",
        priority: "medium",
        completed: false
      });
      store.createDeadline({
        course: "Physics",
        task: "Quiz Prep",
        dueDate: "2026-02-19T12:00:00.000Z",
        priority: "low",
        completed: true
      });

      expect(store.getSnapshot().summary.pendingDeadlines).toBe(1);
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

      store.addPushSubscription(subscription);
      store.addPushSubscription({ ...subscription, keys: { p256dh: "updated", auth: "updated" } });

      expect(store.getPushSubscriptions()).toHaveLength(1);
      expect(store.getPushSubscriptions()[0].keys.p256dh).toBe("updated");
      expect(store.removePushSubscription(subscription.endpoint)).toBe(true);
      expect(store.removePushSubscription(subscription.endpoint)).toBe(false);
    });

    it("notifies listeners when a notification is added", () => {
      const received: string[] = [];
      const unsubscribe = store.onNotification((notification) => {
        received.push(notification.title);
      });

      store.pushNotification({
        source: "orchestrator",
        title: "Test push",
        message: "Message body",
        priority: "low"
      });

      unsubscribe();
      store.pushNotification({
        source: "orchestrator",
        title: "Ignored",
        message: "Message body",
        priority: "low"
      });

      expect(received).toEqual(["Test push"]);
    });
  });
});
