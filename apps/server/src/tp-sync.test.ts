import { describe, expect, it } from "vitest";
import { convertTPEventToLecture, diffScheduleEvents, generateTPEventKey } from "./tp-sync.js";
import { LectureEvent } from "./types.js";

describe("TP EduCloud sync", () => {
  it("converts TP event to lecture with correct duration", () => {
    const event = {
      summary: "DAT520 Forelesning",
      startTime: "2026-02-17T10:15:00.000Z",
      endTime: "2026-02-17T12:00:00.000Z",
      description: "Distributed Systems lecture"
    };

    const lecture = convertTPEventToLecture(event);

    expect(lecture.title).toBe("DAT520 Forelesning");
    expect(lecture.startTime).toBe("2026-02-17T10:15:00.000Z");
    expect(lecture.durationMinutes).toBe(105);
    expect(lecture.workload).toBe("medium");
  });

  it("infers high workload for exams", () => {
    const event = {
      summary: "DAT520 Skriftlig eksamen",
      startTime: "2026-05-20T09:00:00.000Z",
      endTime: "2026-05-20T13:00:00.000Z"
    };

    const lecture = convertTPEventToLecture(event);

    expect(lecture.workload).toBe("high");
    expect(lecture.durationMinutes).toBe(240);
  });

  it("infers low workload for guidance sessions", () => {
    const event = {
      summary: "DAT560 Veiledning",
      startTime: "2026-03-10T14:00:00.000Z",
      endTime: "2026-03-10T15:00:00.000Z"
    };

    const lecture = convertTPEventToLecture(event);

    expect(lecture.workload).toBe("low");
  });

  it("defaults to 90 minutes when no end time", () => {
    const event = {
      summary: "DAT600 Lecture",
      startTime: "2026-03-15T10:00:00.000Z"
    };

    const lecture = convertTPEventToLecture(event);

    expect(lecture.durationMinutes).toBe(90);
  });

  it("generates consistent event keys", () => {
    const event1 = {
      summary: "DAT520 Lecture",
      startTime: "2026-03-01T10:00:00.000Z"
    };

    const event2 = {
      summary: "DAT520 Lecture",
      startTime: "2026-03-01T10:00:00.000Z"
    };

    expect(generateTPEventKey(event1)).toBe(generateTPEventKey(event2));
    expect(generateTPEventKey(event1)).toBe("tp-DAT520 Lecture-2026-03-01T10:00:00.000Z");
  });

  it("diffs schedule events correctly - new events", () => {
    const existingEvents: LectureEvent[] = [];
    const newEvents = [
      {
        summary: "DAT520 Forelesning",
        startTime: "2026-03-01T10:00:00.000Z",
        endTime: "2026-03-01T12:00:00.000Z"
      }
    ];

    const diff = diffScheduleEvents(existingEvents, newEvents);

    expect(diff.toCreate).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
    expect(diff.toDelete).toHaveLength(0);
    expect(diff.toCreate[0].title).toBe("DAT520 Forelesning");
  });

  it("diffs schedule events correctly - updated events", () => {
    const existingEvents: LectureEvent[] = [
      {
        id: "lecture-1",
        title: "DAT520 Forelesning",
        startTime: "2026-03-01T10:00:00.000Z",
        durationMinutes: 60,
        workload: "low"
      }
    ];

    const newEvents = [
      {
        summary: "DAT520 Forelesning",
        startTime: "2026-03-01T10:00:00.000Z",
        endTime: "2026-03-01T12:00:00.000Z"
      }
    ];

    const diff = diffScheduleEvents(existingEvents, newEvents);

    expect(diff.toCreate).toHaveLength(0);
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toDelete).toHaveLength(0);
    expect(diff.toUpdate[0].id).toBe("lecture-1");
    expect(diff.toUpdate[0].event.durationMinutes).toBe(120);
    expect(diff.toUpdate[0].event.workload).toBe("medium");
  });

  it("diffs schedule events correctly - deleted events", () => {
    const existingEvents: LectureEvent[] = [
      {
        id: "lecture-1",
        title: "DAT520 Forelesning",
        startTime: "2026-03-01T10:00:00.000Z",
        durationMinutes: 120,
        workload: "medium"
      }
    ];

    const newEvents: Array<{ summary: string; startTime: string; endTime?: string }> = [];

    const diff = diffScheduleEvents(existingEvents, newEvents);

    expect(diff.toCreate).toHaveLength(0);
    expect(diff.toUpdate).toHaveLength(0);
    expect(diff.toDelete).toHaveLength(1);
    expect(diff.toDelete[0]).toBe("lecture-1");
  });

  it("only diffs TP events (with course codes), not user-created events", () => {
    const existingEvents: LectureEvent[] = [
      {
        id: "lecture-1",
        title: "DAT520 Forelesning",
        startTime: "2026-03-01T10:00:00.000Z",
        durationMinutes: 120,
        workload: "medium"
      },
      {
        id: "lecture-2",
        title: "Study session with friends",
        startTime: "2026-03-01T14:00:00.000Z",
        durationMinutes: 60,
        workload: "low"
      }
    ];

    const newEvents: Array<{ summary: string; startTime: string; endTime?: string }> = [];

    const diff = diffScheduleEvents(existingEvents, newEvents);

    // Only the TP event (with DAT520) should be deleted
    expect(diff.toDelete).toHaveLength(1);
    expect(diff.toDelete[0]).toBe("lecture-1");
  });

  it("handles mixed create, update, delete operations", () => {
    const existingEvents: LectureEvent[] = [
      {
        id: "lecture-1",
        title: "DAT520 Forelesning",
        startTime: "2026-03-01T10:00:00.000Z",
        durationMinutes: 60,
        workload: "low"
      },
      {
        id: "lecture-2",
        title: "DAT560 Lab",
        startTime: "2026-03-02T14:00:00.000Z",
        durationMinutes: 120,
        workload: "high"
      }
    ];

    const newEvents = [
      {
        summary: "DAT520 Forelesning",
        startTime: "2026-03-01T10:00:00.000Z",
        endTime: "2026-03-01T12:00:00.000Z"
      },
      {
        summary: "DAT600 Lecture",
        startTime: "2026-03-03T10:00:00.000Z",
        endTime: "2026-03-03T12:00:00.000Z"
      }
    ];

    const diff = diffScheduleEvents(existingEvents, newEvents);

    expect(diff.toCreate).toHaveLength(1);
    expect(diff.toCreate[0].title).toBe("DAT600 Lecture");

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0].id).toBe("lecture-1");

    expect(diff.toDelete).toHaveLength(1);
    expect(diff.toDelete[0]).toBe("lecture-2");
  });
});
