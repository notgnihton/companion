import { describe, expect, it } from "vitest";
import { generateDeadlineSuggestions } from "./deadline-suggestions.js";
import { Deadline, LectureEvent, UserContext } from "./types.js";

describe("generateDeadlineSuggestions", () => {
  const baseUserContext: UserContext = {
    stressLevel: "medium",
    energyLevel: "medium",
    mode: "balanced"
  };

  it("returns empty array when no incomplete deadlines", () => {
    const deadlines: Deadline[] = [
      {
        id: "d1",
        course: "CS101",
        task: "Problem Set 1",
        dueDate: "2026-02-20T23:59:00Z",
        priority: "high",
        completed: true
      }
    ];
    const scheduleEvents: LectureEvent[] = [];
    
    const suggestions = generateDeadlineSuggestions(
      deadlines,
      scheduleEvents,
      baseUserContext,
      new Date("2026-02-15T10:00:00Z")
    );
    
    expect(suggestions).toHaveLength(0);
  });

  it("returns empty array when no schedule gaps", () => {
    const deadlines: Deadline[] = [
      {
        id: "d1",
        course: "CS101",
        task: "Problem Set 1",
        dueDate: "2026-02-20T23:59:00Z",
        priority: "high",
        completed: false
      }
    ];
    // Continuous lectures with no gaps
    const scheduleEvents: LectureEvent[] = [
      {
        id: "lec-1",
        title: "Lecture 1",
        startTime: "2026-02-15T09:00:00Z",
        durationMinutes: 180,
        workload: "high"
      },
      {
        id: "lec-2",
        title: "Lecture 2",
        startTime: "2026-02-15T12:00:00Z",
        durationMinutes: 240,
        workload: "high"
      }
    ];
    
    const suggestions = generateDeadlineSuggestions(
      deadlines,
      scheduleEvents,
      baseUserContext,
      new Date("2026-02-15T09:00:00Z"),
      4 // 4 hour look-ahead
    );
    
    expect(suggestions).toHaveLength(0);
  });

  it("generates suggestions for incomplete deadlines with available gaps", () => {
    const deadlines: Deadline[] = [
      {
        id: "d1",
        course: "CS101",
        task: "Problem Set 1",
        dueDate: "2026-02-17T23:59:00Z",
        priority: "high",
        completed: false
      }
    ];
    const scheduleEvents: LectureEvent[] = [
      {
        id: "lec-1",
        title: "Algorithms",
        startTime: "2026-02-15T10:00:00Z",
        durationMinutes: 90,
        workload: "medium"
      },
      {
        id: "lec-2",
        title: "Databases",
        startTime: "2026-02-15T14:00:00Z",
        durationMinutes: 90,
        workload: "medium"
      }
    ];
    
    const suggestions = generateDeadlineSuggestions(
      deadlines,
      scheduleEvents,
      baseUserContext,
      new Date("2026-02-15T09:00:00Z")
    );
    
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].deadline.id).toBe("d1");
    expect(suggestions[0].durationMinutes).toBeGreaterThan(0);
    expect(suggestions[0].overallScore).toBeGreaterThan(0);
  });

  it("prioritizes critical deadlines over low priority ones", () => {
    const deadlines: Deadline[] = [
      {
        id: "d-low",
        course: "CS101",
        task: "Optional Reading",
        dueDate: "2026-02-20T23:59:00Z",
        priority: "low",
        completed: false
      },
      {
        id: "d-critical",
        course: "CS201",
        task: "Final Project",
        dueDate: "2026-02-16T23:59:00Z",
        priority: "critical",
        completed: false
      }
    ];
    const scheduleEvents: LectureEvent[] = [
      {
        id: "lec-1",
        title: "Lecture",
        startTime: "2026-02-15T13:00:00Z",
        durationMinutes: 60,
        workload: "medium"
      }
    ];
    
    const suggestions = generateDeadlineSuggestions(
      deadlines,
      scheduleEvents,
      baseUserContext,
      new Date("2026-02-15T09:00:00Z")
    );
    
    expect(suggestions.length).toBeGreaterThan(0);
    // Critical deadline should be ranked higher
    const criticalSuggestion = suggestions.find(s => s.deadline.id === "d-critical");
    const lowSuggestion = suggestions.find(s => s.deadline.id === "d-low");
    
    if (criticalSuggestion && lowSuggestion) {
      expect(criticalSuggestion.overallScore).toBeGreaterThan(lowSuggestion.overallScore);
    }
  });

  it("includes rationale for each suggestion", () => {
    const deadlines: Deadline[] = [
      {
        id: "d1",
        course: "CS101",
        task: "Assignment 1",
        dueDate: "2026-02-16T10:00:00Z",
        priority: "high",
        completed: false
      }
    ];
    const scheduleEvents: LectureEvent[] = [
      {
        id: "lec-1",
        title: "Lecture",
        startTime: "2026-02-15T14:00:00Z",
        durationMinutes: 60,
        workload: "medium"
      }
    ];
    
    const suggestions = generateDeadlineSuggestions(
      deadlines,
      scheduleEvents,
      baseUserContext,
      new Date("2026-02-15T09:00:00Z")
    );
    
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].rationale).toBeDefined();
    expect(suggestions[0].rationale.length).toBeGreaterThan(0);
  });

  it("limits results to top 10 suggestions", () => {
    const deadlines: Deadline[] = [];
    // Create 20 deadlines
    for (let i = 1; i <= 20; i++) {
      deadlines.push({
        id: `d${i}`,
        course: `CS${100 + i}`,
        task: `Task ${i}`,
        dueDate: `2026-02-${16 + (i % 10)}T23:59:00Z`,
        priority: i % 2 === 0 ? "high" : "medium",
        completed: false
      });
    }
    
    const scheduleEvents: LectureEvent[] = [
      {
        id: "lec-1",
        title: "Lecture",
        startTime: "2026-02-15T13:00:00Z",
        durationMinutes: 60,
        workload: "medium"
      }
    ];
    
    const suggestions = generateDeadlineSuggestions(
      deadlines,
      scheduleEvents,
      baseUserContext,
      new Date("2026-02-15T09:00:00Z")
    );
    
    expect(suggestions.length).toBeLessThanOrEqual(10);
  });

  it("suggests appropriate work duration based on deadline priority", () => {
    const deadlines: Deadline[] = [
      {
        id: "d-critical",
        course: "CS201",
        task: "Critical Task",
        dueDate: "2026-02-17T23:59:00Z",
        priority: "critical",
        completed: false
      },
      {
        id: "d-low",
        course: "CS101",
        task: "Low Priority Task",
        dueDate: "2026-02-17T23:59:00Z",
        priority: "low",
        completed: false
      }
    ];
    const scheduleEvents: LectureEvent[] = [];
    
    const suggestions = generateDeadlineSuggestions(
      deadlines,
      scheduleEvents,
      baseUserContext,
      new Date("2026-02-15T09:00:00Z")
    );
    
    const criticalSuggestion = suggestions.find(s => s.deadline.id === "d-critical");
    const lowSuggestion = suggestions.find(s => s.deadline.id === "d-low");
    
    if (criticalSuggestion && lowSuggestion) {
      // Critical tasks should have longer estimated durations
      expect(criticalSuggestion.durationMinutes).toBeGreaterThan(lowSuggestion.durationMinutes);
    }
  });

  it("includes timing information in ISO format", () => {
    const deadlines: Deadline[] = [
      {
        id: "d1",
        course: "CS101",
        task: "Assignment",
        dueDate: "2026-02-17T23:59:00Z",
        priority: "medium",
        completed: false
      }
    ];
    const scheduleEvents: LectureEvent[] = [];
    
    const suggestions = generateDeadlineSuggestions(
      deadlines,
      scheduleEvents,
      baseUserContext,
      new Date("2026-02-15T09:00:00Z")
    );
    
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].suggestedStartTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(suggestions[0].suggestedEndTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    
    // End time should be after start time
    const startTime = new Date(suggestions[0].suggestedStartTime);
    const endTime = new Date(suggestions[0].suggestedEndTime);
    expect(endTime.getTime()).toBeGreaterThan(startTime.getTime());
  });
});
