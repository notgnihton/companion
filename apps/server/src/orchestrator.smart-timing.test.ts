import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { RuntimeStore } from "./store.js";
import fs from "fs";

describe("Smart timing integration", () => {
  let store: RuntimeStore;
  const testDbPath = "test-smart-timing.db";

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    store = new RuntimeStore(testDbPath);
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("stores and retrieves scheduled notifications", () => {
    // Schedule a notification
    const notification = {
      source: "notes" as const,
      title: "Test notification",
      message: "This is a test",
      priority: "low" as const
    };

    const scheduledFor = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    const scheduled = store.scheduleNotification(notification, scheduledFor);

    expect(scheduled.id).toMatch(/^sched-notif-/);
    expect(scheduled.notification).toEqual(notification);
    expect(scheduled.scheduledFor).toBe(scheduledFor.toISOString());

    // Should not be due yet
    const dueNow = store.getDueScheduledNotifications();
    expect(dueNow.length).toBe(0);

    // Should be due if we check 2 hours ahead
    const dueLater = store.getDueScheduledNotifications(new Date(Date.now() + 2 * 60 * 60 * 1000));
    expect(dueLater.length).toBe(1);
    expect(dueLater[0].id).toBe(scheduled.id);
  });

  it("removes scheduled notifications after delivery", () => {
    const notification = {
      source: "lecture-plan" as const,
      title: "Lecture reminder",
      message: "Class in 30 min",
      priority: "medium" as const
    };

    const scheduledFor = new Date(Date.now() - 1000); // Already due
    const scheduled = store.scheduleNotification(notification, scheduledFor);

    // Should be due
    const due = store.getDueScheduledNotifications();
    expect(due.length).toBe(1);

    // Remove it
    const removed = store.removeScheduledNotification(scheduled.id);
    expect(removed).toBe(true);

    // Should no longer be due
    const dueAfter = store.getDueScheduledNotifications();
    expect(dueAfter.length).toBe(0);
  });

  it("retrieves deadline history for pattern analysis", () => {
    // Create a deadline and record some reminders
    const deadline = store.createDeadline({
      course: "Algorithms",
      task: "Problem Set",
      dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      priority: "high",
      completed: false
    });

    store.recordDeadlineReminder(deadline.id);
    store.confirmDeadlineStatus(deadline.id, true);

    // Get all deadline history
    const history = store.getAllDeadlineReminderStates();
    expect(history.length).toBeGreaterThan(0);
    
    const deadlineHistory = history.find(h => h.deadlineId === deadline.id);
    expect(deadlineHistory).toBeDefined();
    expect(deadlineHistory?.reminderCount).toBe(1);
    expect(deadlineHistory?.lastConfirmedCompleted).toBe(true);
  });

  it("smart timing uses schedule gaps", () => {
    // Create lectures with a gap
    store.createLectureEvent({
      title: "Morning Lecture",
      startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      durationMinutes: 60,
      workload: "medium"
    });

    store.createLectureEvent({
      title: "Afternoon Lecture",
      startTime: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
      durationMinutes: 90,
      workload: "high"
    });

    const scheduleEvents = store.getScheduleEvents();
    expect(scheduleEvents.length).toBe(2);

    // The smart timing module can use these to find gaps
    // (This is tested more thoroughly in smart-timing.test.ts)
  });
});
