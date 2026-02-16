import { describe, expect, it } from "vitest";
import {
  parseDeadlineTable,
  parseDeadlineDate,
  inferPriorityFromLab,
  toDeadline
} from "./github-course-sync.js";

describe("parseDeadlineDate", () => {
  it("should parse ISO date format", () => {
    expect(parseDeadlineDate("2026-02-15")).toBe("2026-02-15T23:59:59.000Z");
    expect(parseDeadlineDate("**2026-03-20**")).toBe("2026-03-20T23:59:59.000Z");
  });

  it("should parse MM/DD/YYYY format", () => {
    expect(parseDeadlineDate("2/15/2026")).toBe("2026-02-15T23:59:59.000Z");
    expect(parseDeadlineDate("12/31/2026")).toBe("2026-12-31T23:59:59.000Z");
  });

  it("should parse Month Day, Year format", () => {
    expect(parseDeadlineDate("February 15, 2026")).toBe("2026-02-15T23:59:59.000Z");
    expect(parseDeadlineDate("Feb 15 2026")).toBe("2026-02-15T23:59:59.000Z");
    expect(parseDeadlineDate("March 1, 2026")).toBe("2026-03-01T23:59:59.000Z");
  });

  it("should return null for invalid dates", () => {
    expect(parseDeadlineDate("not a date")).toBeNull();
    expect(parseDeadlineDate("")).toBeNull();
  });
});

describe("parseDeadlineTable", () => {
  it("should parse deadline table from markdown", () => {
    const markdown = `
# Course Information

| Lab | Deadline |
|-----|----------|
| Lab 1 | 2026-02-20 |
| Lab 2 | 2026-03-15 |
`;

    const result = parseDeadlineTable(markdown, "dat520-2026");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      lab: "Lab 1",
      deadline: "2026-02-20T23:59:59.000Z",
      course: "dat520-2026"
    });
    expect(result[1]).toEqual({
      lab: "Lab 2",
      deadline: "2026-03-15T23:59:59.000Z",
      course: "dat520-2026"
    });
  });

  it("should handle tables with different header cases", () => {
    const markdown = `
| LAB | DEADLINE |
|-----|----------|
| Assignment 1 | Feb 20, 2026 |
`;

    const result = parseDeadlineTable(markdown, "dat560-2026");

    expect(result).toHaveLength(1);
    expect(result[0]?.lab).toBe("Assignment 1");
  });

  it("should skip rows without valid deadline dates", () => {
    const markdown = `
| Lab | Deadline |
|-----|----------|
| Lab 1 | 2026-02-20 |
| Lab 2 | TBD |
| Lab 3 | 2026-03-15 |
`;

    const result = parseDeadlineTable(markdown, "dat520-2026");

    expect(result).toHaveLength(2);
    expect(result[0]?.lab).toBe("Lab 1");
    expect(result[1]?.lab).toBe("Lab 3");
  });

  it("should return empty array for non-table markdown", () => {
    const markdown = `
# Just some text
No tables here.
`;

    const result = parseDeadlineTable(markdown, "dat520-2026");

    expect(result).toHaveLength(0);
  });
});

describe("inferPriorityFromLab", () => {
  it("should infer critical for final/exam", () => {
    expect(inferPriorityFromLab("Final Project")).toBe("critical");
    expect(inferPriorityFromLab("Midterm Exam")).toBe("critical");
  });

  it("should infer high for projects", () => {
    expect(inferPriorityFromLab("Lab Project 1")).toBe("high");
  });

  it("should default to medium", () => {
    expect(inferPriorityFromLab("Lab 1")).toBe("medium");
    expect(inferPriorityFromLab("Assignment 2")).toBe("medium");
  });
});

describe("toDeadline", () => {
  it("should convert parsed deadline to Deadline object", () => {
    const parsed = {
      lab: "Lab 1: Introduction",
      deadline: "2026-02-20T23:59:59.000Z",
      course: "dat520-2026"
    };

    const deadline = toDeadline(parsed);

    expect(deadline).toEqual({
      course: "dat520-2026",
      task: "Lab 1: Introduction",
      dueDate: "2026-02-20T23:59:59.000Z",
      priority: "medium",
      completed: false
    });
  });
});
