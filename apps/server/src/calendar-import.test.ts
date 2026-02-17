import { describe, expect, it } from "vitest";
import {
  buildCalendarImportPreview,
  classifyEventType,
  inferCourseName,
  inferPriority,
  parseICS,
  toDurationMinutes
} from "./calendar-import.js";

describe("calendar import helpers", () => {
  it("parses ICS events and normalizes timestamps", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Algorithms Lecture",
      "DTSTART:20260301T100000Z",
      "DTEND:20260301T113000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "SUMMARY:Systems Assignment Due",
      "DTSTART:20260302T235900Z",
      "DESCRIPTION:Final submission deadline",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\n");

    const events = parseICS(ics);

    expect(events).toHaveLength(2);
    expect(events[0].startTime).toBe("2026-03-01T10:00:00.000Z");
    expect(events[0].endTime).toBe("2026-03-01T11:30:00.000Z");
    expect(events[1].description).toContain("deadline");
  });

  it("decodes escaped ICS text and normalizes bilingual summary formatting", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:DAT520 Forelesning \\\\nLecture",
      "DESCRIPTION:Room A\\\\, Building B\\\\; bring laptop",
      "DTSTART:20260301T100000Z",
      "DTEND:20260301T113000Z",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\n");

    const events = parseICS(ics);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("DAT520 Forelesning / Lecture");
    expect(events[0].description).toBe("Room A, Building B; bring laptop");
  });

  it("classifies deadlines and computes metadata", () => {
    const event = {
      summary: "Databases Assignment 1",
      startTime: "2026-03-03T12:00:00.000Z",
      endTime: "2026-03-03T14:00:00.000Z",
      description: "Final deliverable"
    };

    expect(classifyEventType(event)).toBe("deadline");
    expect(inferPriority(event)).toBe("critical");
    expect(toDurationMinutes(event.startTime, event.endTime)).toBe(120);
    expect(toDurationMinutes(event.startTime)).toBe(60);
  });

  it("treats non-assignment and non-exam events as lectures", () => {
    const event = {
      summary: "Language Models - Part 2",
      startTime: "2026-03-03T12:00:00.000Z",
      description: "Due before seminar"
    };

    expect(classifyEventType(event)).toBe("lecture");
  });

  it("builds a preview payload for lectures and deadlines", () => {
    const events = parseICS(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "SUMMARY:CS101: Lecture 1",
        "DTSTART:20260303T090000Z",
        "DTEND:20260303T103000Z",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "SUMMARY:Databases Assignment Due",
        "DESCRIPTION:Submit before midnight",
        "DTSTART:20260304T235900Z",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\n")
    );
    const preview = buildCalendarImportPreview(events);

    expect(preview.importedEvents).toBe(2);
    expect(preview.lecturesPlanned).toBe(1);
    expect(preview.deadlinesPlanned).toBe(1);
    expect(preview.lectures[0].title).toBe("CS101: Lecture 1");
    expect(preview.deadlines[0].course).toBe("General");
    expect(preview.deadlines[0].priority).toBe("high");
  });

  it("infers course names from summary prefixes", () => {
    expect(inferCourseName("MATH200: Midterm Review")).toBe("MATH200");
    expect(inferCourseName("Due tomorrow")).toBe("General");
  });
});
