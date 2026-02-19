import type { Deadline } from "./types.js";

const ASSIGNMENT_OR_EXAM_PATTERNS = [
  /\bassignment(s)?\b/i,
  /\bexam(s)?\b/i,
  /\beksamen\b/i,
  /\bmidterm\b/i,
  /\bfinal\b/i,
  /\boblig\b/i,
  /\binnlevering\b/i
];

export function hasAssignmentOrExamKeyword(text: string): boolean {
  return ASSIGNMENT_OR_EXAM_PATTERNS.some((pattern) => pattern.test(text));
}

const DAT520_LAB_PATTERNS = [/\blab\b/i, /\blaboratorium\b/i];

function hasDat520LabKeyword(text: string): boolean {
  return DAT520_LAB_PATTERNS.some((pattern) => pattern.test(text));
}

export function isAssignmentOrExamDeadline(
  deadline: Pick<Deadline, "course" | "task" | "canvasAssignmentId">
): boolean {
  if (typeof deadline.canvasAssignmentId === "number" && Number.isFinite(deadline.canvasAssignmentId)) {
    return true;
  }

  const text = `${deadline.course} ${deadline.task}`.trim();
  if (hasAssignmentOrExamKeyword(text)) {
    return true;
  }

  const normalizedCourse = deadline.course.trim().toUpperCase();
  if (normalizedCourse.startsWith("DAT520") && hasDat520LabKeyword(deadline.task)) {
    return true;
  }

  return false;
}
