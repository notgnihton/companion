import { RuntimeStore } from "./store.js";
import { CanvasAssignment, CanvasCourse, Deadline, Priority } from "./types.js";
import { makeId } from "./utils.js";

export interface CanvasDeadlineBridgeResult {
  created: number;
  updated: number;
  completed: number;
  removed: number;
  skipped: number;
  createdDeadlines: Deadline[];
}

/**
 * Bridge service that syncs Canvas assignments into the deadline system
 * 
 * Features:
 * - Auto-creates deadlines from Canvas assignments with due dates
 * - Updates existing Canvas-sourced deadlines if due date or name changes
 * - Marks deadlines as completed when Canvas submission is marked as submitted/graded
 * - Avoids duplicating manually-created deadlines (only touches deadlines with canvasAssignmentId)
 */
export class CanvasDeadlineBridge {
  private readonly store: RuntimeStore;
  private readonly userId: string;

  constructor(store: RuntimeStore, userId: string) {
    this.store = store;
    this.userId = userId;
  }

  /**
   * Sync Canvas assignments to deadlines
   */
  syncAssignments(courses: CanvasCourse[], assignments: CanvasAssignment[]): CanvasDeadlineBridgeResult {
    const result: CanvasDeadlineBridgeResult = {
      created: 0,
      updated: 0,
      completed: 0,
      removed: 0,
      skipped: 0,
      createdDeadlines: []
    };

    // Build a map of course IDs to course codes for naming
    const courseMap = new Map<number, string>();
    for (const course of courses) {
      courseMap.set(course.id, course.course_code || course.name);
    }

    // Get all existing deadlines to check for Canvas-sourced ones
    const existingDeadlines = this.store.getDeadlines(this.userId, new Date(), false);
    const canvasDeadlineMap = new Map<number, Deadline>();
    
    for (const deadline of existingDeadlines) {
      if (deadline.canvasAssignmentId) {
        canvasDeadlineMap.set(deadline.canvasAssignmentId, deadline);
      }
    }

    // Process each Canvas assignment
    const seenAssignmentIds = new Set<number>();
    for (const assignment of assignments) {
      seenAssignmentIds.add(assignment.id);

      // Skip assignments without due dates
      if (!assignment.due_at) {
        result.skipped++;
        continue;
      }

      const courseName = courseMap.get(assignment.course_id) || `Course ${assignment.course_id}`;
      const isSubmitted = assignment.submission?.workflow_state === "submitted" || 
                          assignment.submission?.workflow_state === "graded";

      const existingDeadline = canvasDeadlineMap.get(assignment.id);

      if (existingDeadline) {
        const existingSourceDueDate = existingDeadline.sourceDueDate ?? existingDeadline.dueDate;
        const userOverrodeDueDate = existingDeadline.dueDate !== existingSourceDueDate;
        const sourceDueDateChanged = existingSourceDueDate !== assignment.due_at;
        const nextDueDate = sourceDueDateChanged && !userOverrodeDueDate ? assignment.due_at : existingDeadline.dueDate;

        // Update existing Canvas-sourced deadline
        const needsUpdate =
          existingDeadline.task !== assignment.name ||
          existingDeadline.sourceDueDate !== assignment.due_at ||
          existingDeadline.dueDate !== nextDueDate ||
          existingDeadline.course !== courseName ||
          existingDeadline.completed !== isSubmitted;

        if (needsUpdate) {
          this.store.updateDeadline(this.userId, existingDeadline.id, {
            task: assignment.name,
            dueDate: nextDueDate,
            sourceDueDate: assignment.due_at,
            course: courseName,
            completed: isSubmitted
          });

          if (isSubmitted && !existingDeadline.completed) {
            result.completed++;
          }
          result.updated++;
        } else {
          result.skipped++;
        }
      } else {
        // Create new deadline from Canvas assignment
        const priority = this.inferPriority(assignment);
        const deadline: Omit<Deadline, "id"> = {
          course: courseName,
          task: assignment.name,
          dueDate: assignment.due_at,
          sourceDueDate: assignment.due_at,
          priority,
          completed: isSubmitted,
          canvasAssignmentId: assignment.id
        };

        const created = this.store.createDeadline(this.userId, deadline);
        result.created++;
        result.createdDeadlines.push(created);

        if (isSubmitted) {
          result.completed++;
        }
      }
    }

    // Remove stale Canvas-linked deadlines not present in latest filtered assignment set
    for (const [assignmentId, deadline] of canvasDeadlineMap.entries()) {
      if (seenAssignmentIds.has(assignmentId)) {
        continue;
      }

      if (this.store.deleteDeadline(this.userId, deadline.id)) {
        result.removed++;
      }
    }

    return result;
  }

  /**
   * Infer priority based on Canvas assignment properties
   */
  private inferPriority(assignment: CanvasAssignment): Priority {
    // Use points as a heuristic - higher point assignments are higher priority
    const points = assignment.points_possible ?? 0;

    if (points >= 100) {
      return "high";
    } else if (points >= 50) {
      return "medium";
    } else {
      return "low";
    }
  }
}
