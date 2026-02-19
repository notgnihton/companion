import { describe, expect, it } from "vitest";
import { hasAssignmentOrExamKeyword, isAssignmentOrExamDeadline } from "./deadline-eligibility.js";

describe("deadline eligibility", () => {
  it("detects assignment/exam keywords", () => {
    expect(hasAssignmentOrExamKeyword("DAT560 Assignment 2")).toBe(true);
    expect(hasAssignmentOrExamKeyword("Final exam")).toBe(true);
    expect(hasAssignmentOrExamKeyword("Oblig 1")).toBe(true);
  });

  it("accepts Canvas-linked deadlines even without keyword in title", () => {
    expect(
      isAssignmentOrExamDeadline({
        course: "DAT560",
        task: "LLM foundations – part 1",
        canvasAssignmentId: 42
      })
    ).toBe(true);
  });

  it("rejects non-assignment and non-exam records without Canvas linkage", () => {
    expect(
      isAssignmentOrExamDeadline({
        course: "DAT560",
        task: "Lecture: Language Models",
        canvasAssignmentId: undefined
      })
    ).toBe(false);
  });

  it("accepts DAT520 lab deadlines", () => {
    expect(
      isAssignmentOrExamDeadline({
        course: "DAT520",
        task: "Lab 3 submission",
        canvasAssignmentId: undefined
      })
    ).toBe(true);
    expect(
      isAssignmentOrExamDeadline({
        course: "DAT520",
        task: "Laboratorium 4",
        canvasAssignmentId: undefined
      })
    ).toBe(true);
  });

  it("keeps non-DAT520 labs out unless otherwise assignment/exam linked", () => {
    expect(
      isAssignmentOrExamDeadline({
        course: "DAT560",
        task: "Lab 3 submission",
        canvasAssignmentId: undefined
      })
    ).toBe(false);
  });
});
