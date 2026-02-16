import { describe, it, expect } from "vitest";
import { GitHubSyncService } from "./github-sync.js";

describe("GitHubSyncService", () => {
  describe("parseDeadlinesFromMarkdown", () => {
    it("should parse table format deadlines", () => {
      const markdown = `
# Lab 1

| Deadline: | **Jan 15, 2026 23:59** |
| --- | --- |
`;

      const service = new GitHubSyncService("test-token");
      const deadlines = service.parseDeadlinesFromMarkdown(markdown, "dat520-2026/assignments");

      expect(deadlines).toHaveLength(1);
      expect(deadlines[0]).toMatchObject({
        course: "DAT520",
        task: "Lab 1",
        priority: expect.any(String)
      });
      expect(deadlines[0]!.dueDate).toContain("2026-01-15");
    });

    it("should parse plain text deadlines", () => {
      const markdown = `
# Assignment 2

Deadline: February 18, 2026
`;

      const service = new GitHubSyncService("test-token");
      const deadlines = service.parseDeadlinesFromMarkdown(markdown, "dat560-2026/info");

      expect(deadlines).toHaveLength(1);
      expect(deadlines[0]).toMatchObject({
        course: "DAT560",
        task: "Assignment 2"
      });
      expect(deadlines[0]!.dueDate).toContain("2026-02-18");
    });

    it("should parse multiple deadline formats in same document", () => {
      const markdown = `
# Lab 2

| Deadline: | **Jan 22, 2026 23:59** |

# Lab 3

Due: February 12, 2026
`;

      const service = new GitHubSyncService("test-token");
      const deadlines = service.parseDeadlinesFromMarkdown(markdown, "dat520-2026/assignments");

      expect(deadlines).toHaveLength(2);
      expect(deadlines[0]!.task).toBe("Lab 2");
      expect(deadlines[1]!.task).toBe("Lab 3");
    });

    it("should handle ISO date format", () => {
      const markdown = `
# Assignment 1

Deadline: 2026-01-28
`;

      const service = new GitHubSyncService("test-token");
      const deadlines = service.parseDeadlinesFromMarkdown(markdown, "dat560-2026/info");

      expect(deadlines).toHaveLength(1);
      expect(deadlines[0]!.dueDate).toContain("2026-01-28");
    });

    it("should handle day-month-year format", () => {
      const markdown = `
# Lab 4

Deadline: 5 March 2026
`;

      const service = new GitHubSyncService("test-token");
      const deadlines = service.parseDeadlinesFromMarkdown(markdown, "dat520-2026/assignments");

      expect(deadlines).toHaveLength(1);
      expect(deadlines[0]!.dueDate).toContain("2026-03-05");
    });

    it("should infer critical priority for exams", () => {
      const markdown = `
# Final Exam

Deadline: **May 15, 2026** - This is the final exam
`;

      const service = new GitHubSyncService("test-token");
      const deadlines = service.parseDeadlinesFromMarkdown(markdown, "dat520-2026/assignments");

      expect(deadlines).toHaveLength(1);
      expect(deadlines[0]!.priority).toBe("critical");
    });

    it("should return empty array when no deadlines found", () => {
      const markdown = `
# Course Information

This course has no deadlines.
`;

      const service = new GitHubSyncService("test-token");
      const deadlines = service.parseDeadlinesFromMarkdown(markdown, "dat520-2026/assignments");

      expect(deadlines).toHaveLength(0);
    });

    it("should handle markdown with multiple stars and formatting", () => {
      const markdown = `
# Lab 1

| **Deadline** | **Jan 15, 2026 23:59** |
`;

      const service = new GitHubSyncService("test-token");
      const deadlines = service.parseDeadlinesFromMarkdown(markdown, "dat520-2026/assignments");

      expect(deadlines).toHaveLength(1);
      expect(deadlines[0]!.dueDate).toContain("2026-01-15");
    });
  });

  describe("date parsing", () => {
    it("should parse dates with times", () => {
      const markdown = `
Deadline: Jan 15, 2026 14:30
`;

      const service = new GitHubSyncService("test-token");
      const deadlines = service.parseDeadlinesFromMarkdown(markdown, "test");

      expect(deadlines).toHaveLength(1);
      expect(deadlines[0]!.dueDate).toContain("2026-01-15T14:30");
    });

    it("should default to 23:59 when no time specified", () => {
      const markdown = `
Deadline: Jan 15, 2026
`;

      const service = new GitHubSyncService("test-token");
      const deadlines = service.parseDeadlinesFromMarkdown(markdown, "test");

      expect(deadlines).toHaveLength(1);
      expect(deadlines[0]!.dueDate).toContain("T23:59");
    });
  });

  describe("priority inference", () => {
    it("should set high priority for near deadlines", () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      const dateStr = futureDate.toISOString().split("T")[0];

      const markdown = `
Deadline: ${dateStr}
`;

      const service = new GitHubSyncService("test-token");
      const deadlines = service.parseDeadlinesFromMarkdown(markdown, "test");

      expect(deadlines).toHaveLength(1);
      expect(deadlines[0]!.priority).toBe("high");
    });

    it("should set medium priority for distant deadlines", () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      const dateStr = futureDate.toISOString().split("T")[0];

      const markdown = `
Deadline: ${dateStr}
`;

      const service = new GitHubSyncService("test-token");
      const deadlines = service.parseDeadlinesFromMarkdown(markdown, "test");

      expect(deadlines).toHaveLength(1);
      expect(deadlines[0]!.priority).toBe("medium");
    });
  });
});
