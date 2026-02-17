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
    it("should parse assignment rows from deadline tables", () => {
      const markdown = `
# Lab Assignments

| Task | Deadline |
|------|----------|
| Assignment 1 | 2026-02-28 |
| Assignment 2 | 2026-03-15 |
`;

      const service = new GitHubCourseSyncService(store);
      const deadlines = service.parseDeadlines(markdown, "DAT520");

      expect(deadlines).toHaveLength(2);
      expect(deadlines[0]).toMatchObject({
        course: "DAT520",
        task: "Assignment 1",
        dueDate: "2026-02-28",
        priority: "medium",
        completed: false
      });
      expect(deadlines[1]).toMatchObject({
        course: "DAT520",
        task: "Assignment 2",
        dueDate: "2026-03-15"
      });
    });

    it("should parse exam rows from deadline tables", () => {
      const markdown = `
# Exams

| Activity | Due Date |
|----------|----------|
| Midterm Exam | 2026-04-12 |
`;

      const service = new GitHubCourseSyncService(store);
      const deadlines = service.parseDeadlines(markdown, "DAT560");

      expect(deadlines).toHaveLength(1);
      expect(deadlines[0]).toMatchObject({
        course: "DAT560",
        task: "Midterm Exam",
        dueDate: "2026-04-12"
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
| Task | Deadline |
|------|----------|
| Assignment 1 | 2026-02-28 |
| Assignment 2 | TBA |
| Assignment 3 | - |
`;

      const service = new GitHubCourseSyncService(store);
      const deadlines = service.parseDeadlines(markdown, "DAT520");

      expect(deadlines).toHaveLength(1);
      expect(deadlines[0].task).toBe("Assignment 1");
    });

    it("should parse dates in different formats", () => {
      const markdown = `
| Task | Deadline |
|------|----------|
| Assignment 1 | 2026-02-28 |
| Midterm Exam | Feb 28, 2026 |
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

    it("should ignore non-assignment and non-exam rows", () => {
      const markdown = `
| Task | Deadline |
|------|----------|
| Lab 1 | 2026-02-28 |
| Exercise 2 | 2026-03-10 |
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
| Assignment | Deadline |
|------------|----------|
| Assignment 1: Introduction to Go | 2026-02-28 |
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
      expect(result.reposProcessed).toBe(2);
      expect(result.deadlinesCreated).toBe(1);
      expect(result.courseDocsSynced).toBeGreaterThan(0);

      const deadlines = freshStore.getDeadlines();
      expect(deadlines.length).toBeGreaterThan(0);
      const assignmentDeadline = deadlines.find(d => d.task.includes("Assignment 1"));
      expect(assignmentDeadline).toBeDefined();
      expect(assignmentDeadline?.course).toBe("DAT520");

      const githubData = freshStore.getGitHubCourseData();
      expect(githubData).not.toBeNull();
      expect(githubData?.documents.length).toBeGreaterThan(0);
      expect(githubData?.repositories).toHaveLength(2);
    });

    it("should update existing deadlines if date changes", async () => {
      // Create initial deadline
      const initialDeadline = store.createDeadline({
        course: "DAT520",
        task: "Assignment 1: Introduction to Go",
        dueDate: "2026-02-28",
        priority: "medium",
        completed: false
      });

      const mockReadme = `
| Assignment | Deadline |
|------------|----------|
| Assignment 1: Introduction to Go | 2026-03-05 |
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
        task: "Assignment 1: Introduction to Go",
        dueDate: "2026-02-28",
        priority: "medium",
        completed: true
      });

      const mockReadme = `
| Assignment | Deadline |
|------------|----------|
| Assignment 1: Introduction to Go | 2026-03-05 |
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

    it("extracts syllabus/course-info markdown into persisted GitHub course data", async () => {
      const freshStore = new RuntimeStore(":memory:");
      const mockReadme = `
# DAT560 Course Information

Project deadlines are published in this repository.
`;
      const mockSyllabus = `
# DAT560 Syllabus

- Project deliverable 1 due March 10
- Final exam on June 2
- Attendance policy applies to labs
`;

      mockClient = {
        getReadme: async () => mockReadme,
        listRepositoryFiles: async () => ["README.md", "docs/syllabus.md", "assignments/lab1.md"],
        getFileContent: async (_owner: string, _repo: string, path: string) => {
          if (path === "docs/syllabus.md") {
            return mockSyllabus;
          }
          throw new Error("not found");
        }
      } as unknown as GitHubCourseClient;

      service = new GitHubCourseSyncService(freshStore, mockClient);
      const result = await service.sync();

      expect(result.success).toBe(true);
      expect(result.courseDocsSynced).toBeGreaterThanOrEqual(2);

      const githubData = freshStore.getGitHubCourseData();
      expect(githubData).not.toBeNull();
      expect(githubData?.documents.length).toBeGreaterThanOrEqual(2);
      const syllabusDoc = githubData?.documents.find((doc) => doc.path === "docs/syllabus.md");
      expect(syllabusDoc).toBeDefined();
      expect(syllabusDoc?.summary.toLowerCase()).toContain("project");
      expect(syllabusDoc?.highlights.length).toBeGreaterThan(0);
    });
  });
});
