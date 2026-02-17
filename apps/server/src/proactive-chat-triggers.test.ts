import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeStore } from "./store.js";
import {
  checkProactiveTriggers,
  checkProactiveTriggersWithCooldown,
  isTriggerOnCooldown,
  markTriggerFired,
  clearTriggerCooldowns,
  ALL_TRIGGERS
} from "./proactive-chat-triggers.js";
import { Deadline, LectureEvent } from "./types.js";

describe("Proactive Chat Triggers", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
    clearTriggerCooldowns(); // Clear cooldowns between tests
  });

  describe("Morning Briefing Trigger", () => {
    it("should fire at 8am", async () => {
      const morningTime = new Date("2026-02-17T08:00:00");
      
      // Add some schedule and deadlines
      store.createLectureEvent({
        title: "DAT520 Lecture",
        startTime: "2026-02-17T10:00:00",
        durationMinutes: 90,
        workload: "medium"
      });

      const notifications = await checkProactiveTriggers(store, morningTime);
      
      const morningBriefing = notifications.find(n => n.metadata?.triggerType === "morning-briefing");
      expect(morningBriefing).toBeDefined();
      expect(morningBriefing?.title).toBe("Good morning!");
      expect(morningBriefing?.priority).toBe("medium");
      expect(morningBriefing?.url).toBe("/companion/?tab=chat");
    });

    it("should not fire at other hours", async () => {
      const afternoonTime = new Date("2026-02-17T14:00:00");
      
      const notifications = await checkProactiveTriggers(store, afternoonTime);
      
      const morningBriefing = notifications.find(n => n.metadata?.triggerType === "morning-briefing");
      expect(morningBriefing).toBeUndefined();
    });
  });

  describe("Schedule Gap Trigger", () => {
    it("should detect gap between lectures (>2 hours)", async () => {
      const gapTime = new Date("2026-02-17T12:00:00");
      
      // Create a gap: lecture 10-11:30, then 14-15:30 (2.5 hour gap)
      store.createLectureEvent({
        title: "DAT520 Lecture",
        startTime: "2026-02-17T10:00:00",
        durationMinutes: 90,
        workload: "medium"
      });
      
      store.createLectureEvent({
        title: "DAT560 Lecture",
        startTime: "2026-02-17T14:00:00",
        durationMinutes: 90,
        workload: "medium"
      });

      const notifications = await checkProactiveTriggers(store, gapTime);
      
      const scheduleGap = notifications.find(n => n.metadata?.triggerType === "schedule-gap");
      expect(scheduleGap).toBeDefined();
      expect(scheduleGap?.title).toBe("Free time ahead");
      expect(scheduleGap?.priority).toBe("low");
    });

    it("should not fire when no gap exists", async () => {
      const time = new Date("2026-02-17T12:00:00");
      
      // Back-to-back lectures
      store.createLectureEvent({
        title: "DAT520 Lecture",
        startTime: "2026-02-17T10:00:00",
        durationMinutes: 90,
        workload: "medium"
      });
      
      store.createLectureEvent({
        title: "DAT560 Lecture",
        startTime: "2026-02-17T11:30:00",
        durationMinutes: 90,
        workload: "medium"
      });

      const notifications = await checkProactiveTriggers(store, time);
      
      const scheduleGap = notifications.find(n => n.metadata?.triggerType === "schedule-gap");
      expect(scheduleGap).toBeUndefined();
    });
  });

  describe("Deadline Approaching Trigger", () => {
    it("should fire when deadline is within 48 hours", async () => {
      const now = new Date("2026-02-17T10:00:00");
      const deadlineTime = new Date("2026-02-18T18:00:00"); // 32 hours away
      
      store.createDeadline({
        task: "Lab 3 submission",
        course: "DAT520",
        dueDate: deadlineTime.toISOString(),
        priority: "high",
        completed: false
      });

      const notifications = await checkProactiveTriggers(store, now);
      
      const deadlineReminder = notifications.find(n => n.metadata?.triggerType === "deadline-approaching");
      expect(deadlineReminder).toBeDefined();
      expect(deadlineReminder?.title).toBe("Deadline reminder");
      expect(deadlineReminder?.priority).toBe("high");
    });

    it("should not fire for completed deadlines", async () => {
      const now = new Date("2026-02-17T10:00:00");
      const deadlineTime = new Date("2026-02-18T18:00:00");
      
      const deadline = store.createDeadline({
        task: "Lab 3 submission",
        course: "DAT520",
        dueDate: deadlineTime.toISOString(),
        priority: "high",
        completed: false
      });
      
      store.updateDeadline(deadline.id, { completed: true });

      const notifications = await checkProactiveTriggers(store, now);
      
      const deadlineReminder = notifications.find(n => n.metadata?.triggerType === "deadline-approaching");
      expect(deadlineReminder).toBeUndefined();
    });

    it("should not fire for deadlines more than 48 hours away", async () => {
      const now = new Date("2026-02-17T10:00:00");
      const deadlineTime = new Date("2026-02-20T18:00:00"); // 80+ hours away
      
      store.createDeadline({
        task: "Lab 4 submission",
        course: "DAT520",
        dueDate: deadlineTime.toISOString(),
        priority: "high",
        completed: false
      });

      const notifications = await checkProactiveTriggers(store, now);
      
      const deadlineReminder = notifications.find(n => n.metadata?.triggerType === "deadline-approaching");
      expect(deadlineReminder).toBeUndefined();
    });
  });

  describe("Post-Lecture Trigger", () => {
    it("should fire within 1 hour after lecture ends", async () => {
      const lectureEndTime = new Date("2026-02-17T11:30:00");
      const checkTime = new Date("2026-02-17T12:00:00"); // 30 min after
      
      store.createLectureEvent({
        title: "DAT520 Distributed Systems",
        startTime: "2026-02-17T10:00:00",
        durationMinutes: 90,
        workload: "medium"
      });

      const notifications = await checkProactiveTriggers(store, checkTime);
      
      const postLecture = notifications.find(n => n.metadata?.triggerType === "post-lecture");
      expect(postLecture).toBeDefined();
      expect(postLecture?.title).toBe("How was class?");
      expect(postLecture?.priority).toBe("low");
    });

    it("should not fire if more than 1 hour has passed", async () => {
      const checkTime = new Date("2026-02-17T13:00:00"); // 1.5 hours after
      
      store.createLectureEvent({
        title: "DAT520 Lecture",
        startTime: "2026-02-17T10:00:00",
        durationMinutes: 90,
        workload: "medium"
      });

      const notifications = await checkProactiveTriggers(store, checkTime);
      
      const postLecture = notifications.find(n => n.metadata?.triggerType === "post-lecture");
      expect(postLecture).toBeUndefined();
    });
  });

  describe("Evening Reflection Trigger", () => {
    it("should fire between 8pm and 10pm", async () => {
      const eveningTime = new Date("2026-02-17T20:30:00");
      
      const notifications = await checkProactiveTriggers(store, eveningTime);
      
      const eveningReflection = notifications.find(n => n.metadata?.triggerType === "evening-reflection");
      expect(eveningReflection).toBeDefined();
      expect(eveningReflection?.title).toBe("Evening check-in");
      expect(eveningReflection?.priority).toBe("low");
    });

    it("should not fire outside evening hours", async () => {
      const morningTime = new Date("2026-02-17T08:00:00");
      
      const notifications = await checkProactiveTriggers(store, morningTime);
      
      const eveningReflection = notifications.find(n => n.metadata?.triggerType === "evening-reflection");
      expect(eveningReflection).toBeUndefined();
    });
  });

  describe("Cooldown Logic", () => {
    it("should respect cooldown period", () => {
      // Mark a trigger as fired
      markTriggerFired("morning-briefing");
      
      // Should be on cooldown immediately
      expect(isTriggerOnCooldown("morning-briefing", 60)).toBe(true);
    });

    it("should allow firing after cooldown expires", () => {
      // This trigger hasn't been fired yet
      expect(isTriggerOnCooldown("schedule-gap", 60)).toBe(false);
    });

    it("should filter out triggers on cooldown", async () => {
      const morningTime = new Date("2026-02-17T08:00:00");
      
      // First check - should get notification
      const notifications1 = await checkProactiveTriggersWithCooldown(store, morningTime);
      const morningBriefing1 = notifications1.find(n => n.metadata?.triggerType === "morning-briefing");
      expect(morningBriefing1).toBeDefined();
      
      // Second check immediately after - should be filtered out due to cooldown
      const notifications2 = await checkProactiveTriggersWithCooldown(store, morningTime);
      const morningBriefing2 = notifications2.find(n => n.metadata?.triggerType === "morning-briefing");
      expect(morningBriefing2).toBeUndefined();
    });
  });

  describe("Notification Structure", () => {
    it("should include all required notification fields", async () => {
      const morningTime = new Date("2026-02-17T08:00:00");
      
      const notifications = await checkProactiveTriggers(store, morningTime);
      
      expect(notifications.length).toBeGreaterThan(0);
      
      for (const notification of notifications) {
        expect(notification.id).toBeDefined();
        expect(notification.title).toBeDefined();
        expect(notification.message).toBeDefined();
        expect(notification.priority).toBeDefined();
        expect(notification.source).toBe("orchestrator");
        expect(notification.timestamp).toBeDefined();
        expect(notification.metadata?.isProactive).toBe(true);
        expect(notification.actions).toContain("view");
        const triggerType = notification.metadata?.triggerType;
        if (triggerType === "evening-reflection") {
          expect(notification.url).toBe("/companion/?tab=settings&section=weekly-review");
        } else {
          expect(notification.url).toBe("/companion/?tab=chat");
        }
      }
    });
  });

  describe("All Triggers Configuration", () => {
    it("should have all 5 trigger types configured", () => {
      expect(ALL_TRIGGERS).toHaveLength(5);
      
      const types = ALL_TRIGGERS.map(t => t.type);
      expect(types).toContain("morning-briefing");
      expect(types).toContain("schedule-gap");
      expect(types).toContain("deadline-approaching");
      expect(types).toContain("post-lecture");
      expect(types).toContain("evening-reflection");
    });

    it("should have priority levels set", () => {
      for (const trigger of ALL_TRIGGERS) {
        expect(["low", "medium", "high", "critical"]).toContain(trigger.priority);
      }
    });
  });
});
