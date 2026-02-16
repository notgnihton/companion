import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeStore } from "./store.js";
import { CanvasDeadlineBridge } from "./canvas-deadline-bridge.js";
import { CanvasAssignment, CanvasCourse } from "./types.js";

describe("CanvasDeadlineBridge", () => {
  let store: RuntimeStore;
  let bridge: CanvasDeadlineBridge;

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
    bridge = new CanvasDeadlineBridge(store);
  });

  describe("syncAssignments", () => {
    it("should create deadlines from Canvas assignments with due dates", () => {
      const courses: CanvasCourse[] = [
        {
          id: 17649,
          name: "DAT520-1 Distribuerte systemer 26V",
          course_code: "DAT520-1",
          workflow_state: "available"
        }
      ];

      const assignments: CanvasAssignment[] = [
        {
          id: 12345,
          name: "Lab 1: UDP Echo Server",
          description: null,
          due_at: "2026-01-15T22:59:00.000Z",
          points_possible: 100,
          course_id: 17649,
          submission_types: ["online_upload"],
          has_submitted_submissions: false
        }
      ];

      const result = bridge.syncAssignments(courses, assignments);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(0);

      const deadlines = store.getDeadlines(new Date(), false);
      expect(deadlines).toHaveLength(1);
      expect(deadlines[0].task).toBe("Lab 1: UDP Echo Server");
      expect(deadlines[0].course).toBe("DAT520-1");
      expect(deadlines[0].dueDate).toBe("2026-01-15T22:59:00.000Z");
      expect(deadlines[0].completed).toBe(false);
      expect(deadlines[0].canvasAssignmentId).toBe(12345);
    });

    it("should skip assignments without due dates", () => {
      const courses: CanvasCourse[] = [
        {
          id: 17649,
          name: "DAT520-1",
          course_code: "DAT520-1",
          workflow_state: "available"
        }
      ];

      const assignments: CanvasAssignment[] = [
        {
          id: 12345,
          name: "Lab 1: UDP Echo Server",
          description: null,
          due_at: null,
          points_possible: 100,
          course_id: 17649,
          submission_types: ["online_upload"],
          has_submitted_submissions: false
        }
      ];

      const result = bridge.syncAssignments(courses, assignments);

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);

      const deadlines = store.getDeadlines(new Date(), false);
      expect(deadlines).toHaveLength(0);
    });

    it("should mark deadlines as completed when assignment is submitted", () => {
      const courses: CanvasCourse[] = [
        {
          id: 17649,
          name: "DAT520-1",
          course_code: "DAT520-1",
          workflow_state: "available"
        }
      ];

      const assignments: CanvasAssignment[] = [
        {
          id: 12345,
          name: "Lab 1: UDP Echo Server",
          description: null,
          due_at: "2026-01-15T22:59:00.000Z",
          points_possible: 100,
          course_id: 17649,
          submission_types: ["online_upload"],
          has_submitted_submissions: true,
          submission: {
            workflow_state: "submitted",
            score: null,
            grade: null,
            submitted_at: "2026-01-14T10:00:00.000Z"
          }
        }
      ];

      const result = bridge.syncAssignments(courses, assignments);

      expect(result.created).toBe(1);
      expect(result.completed).toBe(1);

      const deadlines = store.getDeadlines(new Date(), false);
      expect(deadlines).toHaveLength(1);
      expect(deadlines[0].completed).toBe(true);
    });

    it("should update existing Canvas-sourced deadline if assignment changes", () => {
      const courses: CanvasCourse[] = [
        {
          id: 17649,
          name: "DAT520-1",
          course_code: "DAT520-1",
          workflow_state: "available"
        }
      ];

      // First sync: create deadline
      const assignments1: CanvasAssignment[] = [
        {
          id: 12345,
          name: "Lab 1: UDP Echo Server",
          description: null,
          due_at: "2026-01-15T22:59:00.000Z",
          points_possible: 100,
          course_id: 17649,
          submission_types: ["online_upload"],
          has_submitted_submissions: false
        }
      ];

      bridge.syncAssignments(courses, assignments1);

      // Second sync: update due date and mark as submitted
      const assignments2: CanvasAssignment[] = [
        {
          id: 12345,
          name: "Lab 1: UDP Echo Server (Extended)",
          description: null,
          due_at: "2026-01-20T22:59:00.000Z",
          points_possible: 100,
          course_id: 17649,
          submission_types: ["online_upload"],
          has_submitted_submissions: true,
          submission: {
            workflow_state: "graded",
            score: 95,
            grade: "95",
            submitted_at: "2026-01-14T10:00:00.000Z"
          }
        }
      ];

      const result = bridge.syncAssignments(courses, assignments2);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.completed).toBe(1);

      const deadlines = store.getDeadlines(new Date(), false);
      expect(deadlines).toHaveLength(1);
      expect(deadlines[0].task).toBe("Lab 1: UDP Echo Server (Extended)");
      expect(deadlines[0].dueDate).toBe("2026-01-20T22:59:00.000Z");
      expect(deadlines[0].completed).toBe(true);
    });

    it("should not update Canvas-sourced deadline if nothing changed", () => {
      const courses: CanvasCourse[] = [
        {
          id: 17649,
          name: "DAT520-1",
          course_code: "DAT520-1",
          workflow_state: "available"
        }
      ];

      const assignments: CanvasAssignment[] = [
        {
          id: 12345,
          name: "Lab 1: UDP Echo Server",
          description: null,
          due_at: "2026-01-15T22:59:00.000Z",
          points_possible: 100,
          course_id: 17649,
          submission_types: ["online_upload"],
          has_submitted_submissions: false
        }
      ];

      // First sync
      bridge.syncAssignments(courses, assignments);

      // Second sync with same data
      const result = bridge.syncAssignments(courses, assignments);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it("should not touch manually-created deadlines (without canvasAssignmentId)", () => {
      // Manually create a deadline
      store.createDeadline({
        course: "DAT520-1",
        task: "Manual deadline",
        dueDate: "2026-01-20T22:59:00.000Z",
        priority: "high",
        completed: false
      });

      const courses: CanvasCourse[] = [
        {
          id: 17649,
          name: "DAT520-1",
          course_code: "DAT520-1",
          workflow_state: "available"
        }
      ];

      const assignments: CanvasAssignment[] = [
        {
          id: 12345,
          name: "Lab 1: UDP Echo Server",
          description: null,
          due_at: "2026-01-15T22:59:00.000Z",
          points_possible: 100,
          course_id: 17649,
          submission_types: ["online_upload"],
          has_submitted_submissions: false
        }
      ];

      bridge.syncAssignments(courses, assignments);

      const deadlines = store.getDeadlines(new Date(), false);
      expect(deadlines).toHaveLength(2);

      // Manual deadline should still exist and be unchanged
      const manualDeadline = deadlines.find((d) => d.task === "Manual deadline");
      expect(manualDeadline).toBeDefined();
      expect(manualDeadline?.canvasAssignmentId).toBeUndefined();
    });

    it("should infer priority based on points_possible", () => {
      const courses: CanvasCourse[] = [
        {
          id: 17649,
          name: "DAT520-1",
          course_code: "DAT520-1",
          workflow_state: "available"
        }
      ];

      const assignments: CanvasAssignment[] = [
        {
          id: 1,
          name: "High priority (100 points)",
          description: null,
          due_at: "2026-01-15T22:59:00.000Z",
          points_possible: 100,
          course_id: 17649,
          submission_types: ["online_upload"],
          has_submitted_submissions: false
        },
        {
          id: 2,
          name: "Medium priority (75 points)",
          description: null,
          due_at: "2026-01-15T22:59:00.000Z",
          points_possible: 75,
          course_id: 17649,
          submission_types: ["online_upload"],
          has_submitted_submissions: false
        },
        {
          id: 3,
          name: "Low priority (25 points)",
          description: null,
          due_at: "2026-01-15T22:59:00.000Z",
          points_possible: 25,
          course_id: 17649,
          submission_types: ["online_upload"],
          has_submitted_submissions: false
        }
      ];

      bridge.syncAssignments(courses, assignments);

      const deadlines = store.getDeadlines(new Date(), false);
      expect(deadlines).toHaveLength(3);

      const highPriorityDeadline = deadlines.find((d) => d.canvasAssignmentId === 1);
      expect(highPriorityDeadline?.priority).toBe("high");

      const mediumPriorityDeadline = deadlines.find((d) => d.canvasAssignmentId === 2);
      expect(mediumPriorityDeadline?.priority).toBe("medium");

      const lowPriorityDeadline = deadlines.find((d) => d.canvasAssignmentId === 3);
      expect(lowPriorityDeadline?.priority).toBe("low");
    });
  });
});
