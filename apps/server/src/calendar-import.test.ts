import { describe, expect, it } from "vitest";
import { classifyEventType, inferPriority, parseICS, toDurationMinutes } from "./calendar-import.js";

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

  it("classifies deadlines and computes metadata", () => {
    const event = {
      summary: "Databases Project Deadline",
      startTime: "2026-03-03T12:00:00.000Z",
      endTime: "2026-03-03T14:00:00.000Z",
      description: "Final deliverable"
    };

    expect(classifyEventType(event)).toBe("deadline");
    expect(inferPriority(event)).toBe("critical");
    expect(toDurationMinutes(event.startTime, event.endTime)).toBe(120);
    expect(toDurationMinutes(event.startTime)).toBe(60);
  });
});
