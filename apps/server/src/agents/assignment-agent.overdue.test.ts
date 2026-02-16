import { describe, it, expect, beforeEach } from "vitest";
import { AssignmentTrackerAgent } from "./assignment-agent.js";
import { AgentContext } from "../agent-base.js";
import { AgentEvent } from "../types.js";
import { RuntimeStore } from "../store.js";

describe("AssignmentTrackerAgent - Overdue Deadline Reminders", () => {
  let agent: AssignmentTrackerAgent;
  let mockContext: AgentContext;
  let emittedEvents: AgentEvent[];
  let mockStore: RuntimeStore;

  beforeEach(() => {
    agent = new AssignmentTrackerAgent();
    emittedEvents = [];
    mockStore = new RuntimeStore();
    mockContext = {
      emit: (event: AgentEvent) => {
        emittedEvents.push(event);
      },
      getStore: () => mockStore
    };
  });

  describe("overdue deadline detection", () => {
    it("should emit assignment.overdue event for past incomplete deadlines", async () => {
      // Create an overdue deadline (1 day in the past)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      mockStore.createDeadline({
        course: "Computer Science",
        task: "Final Project",
        dueDate: yesterday.toISOString(),
        priority: "high",
        completed: false
      });

      await agent.run(mockContext);

      const overdueEvents = emittedEvents.filter(e => e.eventType === "assignment.overdue");
      expect(overdueEvents.length).toBe(1);

      const overdueEvent = overdueEvents[0];
      expect(overdueEvent.source).toBe("assignment-tracker");
      expect(overdueEvent.priority).toBe("high");

      const payload = overdueEvent.payload as any;
      expect(payload.course).toBe("Computer Science");
      expect(payload.task).toBe("Final Project");
      expect(payload.completed).toBe(false);
    });

    it("should not emit overdue event for completed deadlines", async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      mockStore.createDeadline({
        course: "Mathematics",
        task: "Homework 5",
        dueDate: yesterday.toISOString(),
        priority: "medium",
        completed: true
      });

      await agent.run(mockContext);

      const overdueEvents = emittedEvents.filter(e => e.eventType === "assignment.overdue");
      expect(overdueEvents.length).toBe(0);
    });

    it("should not emit overdue event for future deadlines", async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      mockStore.createDeadline({
        course: "Physics",
        task: "Lab Report",
        dueDate: tomorrow.toISOString(),
        priority: "low",
        completed: false
      });

      await agent.run(mockContext);

      const overdueEvents = emittedEvents.filter(e => e.eventType === "assignment.overdue");
      expect(overdueEvents.length).toBe(0);
    });

    it("should emit overdue events for multiple overdue deadlines", async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      mockStore.createDeadline({
        course: "Biology",
        task: "Chapter 3 Quiz",
        dueDate: yesterday.toISOString(),
        priority: "medium",
        completed: false
      });

      mockStore.createDeadline({
        course: "Chemistry",
        task: "Problem Set 7",
        dueDate: twoDaysAgo.toISOString(),
        priority: "high",
        completed: false
      });

      await agent.run(mockContext);

      const overdueEvents = emittedEvents.filter(e => e.eventType === "assignment.overdue");
      expect(overdueEvents.length).toBe(2);

      const courses = overdueEvents.map(e => (e.payload as any).course);
      expect(courses).toContain("Biology");
      expect(courses).toContain("Chemistry");
    });

    it("should still emit regular deadline events alongside overdue events", async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      mockStore.createDeadline({
        course: "History",
        task: "Essay Draft",
        dueDate: yesterday.toISOString(),
        priority: "critical",
        completed: false
      });

      await agent.run(mockContext);

      // Should have both overdue event and regular deadline event
      const overdueEvents = emittedEvents.filter(e => e.eventType === "assignment.overdue");
      const deadlineEvents = emittedEvents.filter(e => e.eventType === "assignment.deadline");

      expect(overdueEvents.length).toBe(1);
      expect(deadlineEvents.length).toBe(1);
    });

    it("should handle invalid deadline dates gracefully", async () => {
      mockStore.createDeadline({
        course: "Invalid Course",
        task: "Invalid Task",
        dueDate: "not-a-valid-date",
        priority: "low",
        completed: false
      });

      await expect(agent.run(mockContext)).resolves.not.toThrow();
    });
  });
});
