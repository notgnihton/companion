import { describe, it, expect, beforeEach } from "vitest";
import { GitHubCourseSyncService } from "./github-course-sync.js";
import { RuntimeStore } from "./store.js";
import { GitHubCourseClient } from "./github-course-client.js";

describe("GitHubCourseSyncService", () => {
  let store: RuntimeStore;
  let mockClient: GitHubCourseClient;
  let service: GitHubCourseSyncService;

  beforeEach(() => {
    // Create a fresh store for each test
    store = new RuntimeStore();
  });

  describe("parseDeadlines", () => {
    it("should parse deadline table with Lab and Deadline columns", () => {
      const markdown = `
# Lab Assignments

| Lab | Deadline |
|-----|----------|
| Lab 1 | 2026-02-28 |
| Lab 2 | 2026-03-15 |
`;

      const service = new GitHubCourseSyncService(store);
      const deadlines = service.parseDeadlines(markdown, "DAT520");

      expect(deadlines).toHaveLength(2);
      expect(deadlines[0]).toMatchObject({
        course: "DAT520",
        task: "Lab 1",
        dueDate: "2026-02-28",
        priority: "medium",
        completed: false
      });
      expect(deadlines[1]).toMatchObject({
        course: "DAT520",
        task: "Lab 2",
        dueDate: "2026-03-15"
      });
    });

    it("should parse deadline table with Assignment and Due Date columns", () => {
      const markdown = `
# Assignments

| Assignment | Due Date |
|------------|----------|
| Assignment 1 | 2026-03-01 |
`;

      const service = new GitHubCourseSyncService(store);
      const deadlines = service.parseDeadlines(markdown, "DAT560");

      expect(deadlines).toHaveLength(1);
      expect(deadlines[0]).toMatchObject({
        course: "DAT560",
        task: "Assignment 1",
        dueDate: "2026-03-01"
      });
    });

    it("should skip rows with TBA or empty deadlines", () => {
      const markdown = `
| Lab | Deadline |
|-----|----------|
| Lab 1 | 2026-02-28 |
| Lab 2 | TBA |
| Lab 3 | - |
`;

      const service = new GitHubCourseSyncService(store);
      const deadlines = service.parseDeadlines(markdown, "DAT520");

      expect(deadlines).toHaveLength(1);
      expect(deadlines[0].task).toBe("Lab 1");
    });

    it("should parse dates in different formats", () => {
      const markdown = `
| Lab | Deadline |
|-----|----------|
| Lab 1 | 2026-02-28 |
| Lab 2 | Feb 28, 2026 |
`;

      const service = new GitHubCourseSyncService(store);
      const deadlines = service.parseDeadlines(markdown, "DAT520");

      expect(deadlines).toHaveLength(2);
      expect(deadlines[0].dueDate).toBe("2026-02-28");
      expect(deadlines[1].dueDate).toBe("2026-02-28");
    });

    it("should handle tables without deadline information", () => {
      const markdown = `
| Topic | Week |
|-------|------|
| Intro | 1 |
`;

      const service = new GitHubCourseSyncService(store);
      const deadlines = service.parseDeadlines(markdown, "DAT520");

      expect(deadlines).toHaveLength(0);
    });
  });

  describe("sync", () => {
    it("should create new deadlines from parsed README", async () => {
      // Create a fresh store with in-memory database to avoid seed data
      const freshStore = new RuntimeStore(":memory:");
      
      const mockReadme = `
| Lab | Deadline |
|-----|----------|
| Lab 1: Introduction to Go | 2026-02-28 |
`;

      let getReadmeCallCount = 0;
      mockClient = {
        getReadme: async (owner: string, repo: string) => {
          getReadmeCallCount++;
          // Mock both course repos
          if (owner === "dat520-2026" && repo === "assignments") {
            return mockReadme;
          }
          if (owner === "dat560-2026" && repo === "info") {
            return ""; // No deadlines for DAT560
          }
          throw new Error("Unknown repo");
        }
      } as unknown as GitHubCourseClient;

      service = new GitHubCourseSyncService(freshStore, mockClient);
      
      // First check that parsing works
      const parsed = service.parseDeadlines(mockReadme, "DAT520");
      expect(parsed).toHaveLength(1);
      
      // Ensure store is empty before sync
      expect(freshStore.getDeadlines()).toHaveLength(0);
      
      const result = await service.sync();

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(getReadmeCallCount).toBe(2); // Should call for both repos
      expect(result.deadlinesCreated).toBe(1);

      const deadlines = freshStore.getDeadlines();
      expect(deadlines.length).toBeGreaterThan(0);
      const labDeadline = deadlines.find(d => d.task.includes("Lab 1"));
      expect(labDeadline).toBeDefined();
      expect(labDeadline?.course).toBe("DAT520");
    });

    it("should update existing deadlines if date changes", async () => {
      // Create initial deadline
      const initialDeadline = store.createDeadline({
        course: "DAT520",
        task: "Lab 1: Introduction to Go",
        dueDate: "2026-02-28",
        priority: "medium",
        completed: false
      });

      const mockReadme = `
| Lab | Deadline |
|-----|----------|
| Lab 1: Introduction to Go | 2026-03-05 |
`;

      mockClient = {
        getReadme: async (owner: string, repo: string) => {
          if (owner === "dat520-2026" && repo === "assignments") {
            return mockReadme;
          }
          return "";
        }
      } as unknown as GitHubCourseClient;

      service = new GitHubCourseSyncService(store, mockClient);
      const result = await service.sync();

      expect(result.success).toBe(true);
      expect(result.deadlinesUpdated).toBeGreaterThan(0);

      const updated = store.getDeadlineById(initialDeadline.id);
      expect(updated?.dueDate).toBe("2026-03-05");
    });

    it("should not update completed deadlines", async () => {
      // Create completed deadline
      const completedDeadline = store.createDeadline({
        course: "DAT520",
        task: "Lab 1: Introduction to Go",
        dueDate: "2026-02-28",
        priority: "medium",
        completed: true
      });

      const mockReadme = `
| Lab | Deadline |
|-----|----------|
| Lab 1: Introduction to Go | 2026-03-05 |
`;

      mockClient = {
        getReadme: async (owner: string, repo: string) => {
          if (owner === "dat520-2026" && repo === "assignments") {
            return mockReadme;
          }
          return "";
        }
      } as unknown as GitHubCourseClient;

      service = new GitHubCourseSyncService(store, mockClient);
      const result = await service.sync();

      const deadline = store.getDeadlineById(completedDeadline.id);
      expect(deadline?.dueDate).toBe("2026-02-28"); // Should not change
    });

    it("should handle GitHub API errors gracefully", async () => {
      mockClient = {
        getReadme: async (owner: string, repo: string) => {
          throw new Error("GitHub API error: 404 Not Found");
        }
      } as unknown as GitHubCourseClient;

      service = new GitHubCourseSyncService(store, mockClient);
      const result = await service.sync();

      expect(result.success).toBe(false);
      expect(result.error).toContain("GitHub API error");
      expect(result.deadlinesCreated).toBe(0);
    });
  });
});
