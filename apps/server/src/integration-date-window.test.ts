import { describe, expect, it } from "vitest";
import {
  createIntegrationDateWindow,
  filterCanvasAssignmentsByDateWindow,
  filterTPEventsByDateWindow,
  isWithinIntegrationDateWindow
} from "./integration-date-window.js";
import type { CanvasAssignment } from "./types.js";

describe("integration-date-window", () => {
  it("creates deterministic date window from reference date", () => {
    const referenceDate = new Date("2026-02-17T12:00:00.000Z");
    const window = createIntegrationDateWindow({
      referenceDate,
      pastDays: 7,
      futureDays: 30
    });

    expect(window.start.toISOString()).toBe("2026-02-10T12:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-03-19T12:00:00.000Z");
  });

  it("filters TP events to current integration horizon", () => {
    const events = [
      { summary: "DAT520 A", startTime: "2026-02-14T10:00:00.000Z" },
      { summary: "DAT520 B", startTime: "2026-03-10T10:00:00.000Z" },
      { summary: "DAT520 C", startTime: "2026-08-10T10:00:00.000Z" }
    ];

    const filtered = filterTPEventsByDateWindow(events, {
      referenceDate: new Date("2026-02-17T00:00:00.000Z"),
      pastDays: 7,
      futureDays: 45
    });

    expect(filtered.map((event) => event.summary)).toEqual(["DAT520 A", "DAT520 B"]);
  });

  it("filters Canvas assignments to due-date horizon and excludes undated assignments", () => {
    const assignments: CanvasAssignment[] = [
      {
        id: 1,
        name: "Inside window",
        description: null,
        due_at: "2026-03-01T23:59:00.000Z",
        points_possible: 100,
        course_id: 10,
        submission_types: ["online_upload"],
        has_submitted_submissions: false
      },
      {
        id: 2,
        name: "Far future",
        description: null,
        due_at: "2026-09-01T23:59:00.000Z",
        points_possible: 100,
        course_id: 10,
        submission_types: ["online_upload"],
        has_submitted_submissions: false
      },
      {
        id: 3,
        name: "Undated",
        description: null,
        due_at: null,
        points_possible: 50,
        course_id: 10,
        submission_types: ["online_upload"],
        has_submitted_submissions: false
      }
    ];

    const filtered = filterCanvasAssignmentsByDateWindow(assignments, {
      referenceDate: new Date("2026-02-17T00:00:00.000Z"),
      pastDays: 14,
      futureDays: 60
    });

    expect(filtered.map((assignment) => assignment.id)).toEqual([1]);
  });

  it("checks date membership correctly", () => {
    const window = createIntegrationDateWindow({
      referenceDate: new Date("2026-02-17T00:00:00.000Z"),
      pastDays: 10,
      futureDays: 10
    });

    expect(isWithinIntegrationDateWindow("2026-02-12T00:00:00.000Z", window)).toBe(true);
    expect(isWithinIntegrationDateWindow("2026-03-05T00:00:00.000Z", window)).toBe(false);
  });
});
