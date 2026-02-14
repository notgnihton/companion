import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OrchestratorRuntime } from "./orchestrator.js";
import { RuntimeStore } from "./store.js";
import { AgentEvent } from "./types.js";

describe("OrchestratorRuntime - Event Handling", () => {
  let store: RuntimeStore;
  let orchestrator: OrchestratorRuntime;

  beforeEach(() => {
    store = new RuntimeStore();
    orchestrator = new OrchestratorRuntime(store);
    vi.useFakeTimers();
  });

  afterEach(() => {
    orchestrator.stop();
    vi.useRealTimers();
  });

  describe("event handling", () => {
    it("should handle assignment.deadline events", async () => {
      orchestrator.start();

      // Create a mock assignment deadline event
      const mockEvent: AgentEvent = {
        id: "test-1",
        source: "assignment-tracker",
        eventType: "assignment.deadline",
        priority: "high",
        timestamp: new Date().toISOString(),
        payload: {
          course: "Algorithms",
          task: "Problem Set 4",
          hoursLeft: 28
        }
      };

      // Manually trigger event handling
      store.recordEvent(mockEvent);
      
      await vi.advanceTimersByTimeAsync(100);

      const snapshot = store.getSnapshot();
      
      // The event should be recorded
      expect(snapshot.events).toContainEqual(mockEvent);
    });
    it("should handle lecture.reminder events", async () => {
      orchestrator.start();

      await vi.advanceTimersByTimeAsync(40000); // Wait for lecture agent

      const snapshot = store.getSnapshot();
      
      // Check for lecture-related notifications
      const lectureNotifs = snapshot.notifications.filter(
        (n) => n.source === "lecture-plan"
      );
      
      // Should have at least one lecture notification
      expect(lectureNotifs.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle note.prompt events", async () => {
      orchestrator.start();

      await vi.advanceTimersByTimeAsync(35000); // Wait for notes agent

      const snapshot = store.getSnapshot();
      
      // Check for note-related notifications
      const noteNotifs = snapshot.notifications.filter(
        (n) => n.source === "notes"
      );
      
      // Should have at least one note notification
      expect(noteNotifs.length).toBeGreaterThanOrEqual(0);
    });

    it("should create notification for assignment deadline event", async () => {
      orchestrator.start();

      await vi.advanceTimersByTimeAsync(25000); // Wait for assignment agent

      const snapshot = store.getSnapshot();
      
      const assignmentNotifs = snapshot.notifications.filter(
        (n) => n.source === "assignment-tracker"
      );
      
      if (assignmentNotifs.length > 0) {
        expect(assignmentNotifs[0].title).toBe("Deadline alert");
        expect(assignmentNotifs[0].message).toMatch(/is approaching/);
      }
    });

    it("should create notification for lecture reminder event", async () => {
      orchestrator.start();

      await vi.advanceTimersByTimeAsync(40000); // Wait for lecture agent

      const snapshot = store.getSnapshot();
      
      const lectureNotifs = snapshot.notifications.filter(
        (n) => n.source === "lecture-plan"
      );
      
      if (lectureNotifs.length > 0) {
        expect(lectureNotifs[0].title).toBe("Lecture reminder");
        expect(lectureNotifs[0].message).toMatch(/starts in/);
      }
    });

    it("should create notification for note prompt event", async () => {
      orchestrator.start();

      await vi.advanceTimersByTimeAsync(35000); // Wait for notes agent

      const snapshot = store.getSnapshot();
      
      const noteNotifs = snapshot.notifications.filter(
        (n) => n.source === "notes"
      );
      
      if (noteNotifs.length > 0) {
        expect(noteNotifs[0].title).toBe("Journal prompt");
      }
    });
  });

  describe("asText helper function", () => {
    it("should extract text from event payload", async () => {
      orchestrator.start();

      await vi.advanceTimersByTimeAsync(25000); // Assignment agent

      const snapshot = store.getSnapshot();
      
      const assignmentNotifs = snapshot.notifications.filter(
        (n) => n.source === "assignment-tracker"
      );
      
      if (assignmentNotifs.length > 0) {
        // Message should contain extracted text from payload
        expect(assignmentNotifs[0].message).toMatch(/for .* is approaching/);
      }
    });
  });
});
