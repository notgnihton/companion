import { calculateScheduleGaps } from "./smart-timing.js";
import { isAssignmentOrExamDeadline } from "./deadline-eligibility.js";
import { Deadline, LectureEvent, Priority, StudyPlan, StudyPlanSession, StudyPlanUnallocatedItem } from "./types.js";

export interface StudyPlanOptions {
  horizonDays?: number;
  minSessionMinutes?: number;
  maxSessionMinutes?: number;
  now?: Date;
}

interface DeadlineState {
  deadline: Deadline;
  dueDate: Date;
  score: number;
  remainingMinutes: number;
}

function estimateWorkMinutesFromPriority(priority: Priority): number {
  switch (priority) {
    case "critical":
      return 300;
    case "high":
      return 210;
    case "medium":
      return 150;
    case "low":
      return 90;
  }
}

function estimateWorkMinutes(deadline: Deadline): number {
  // Keep planning simple and uniform: estimate effort from priority only.
  return estimateWorkMinutesFromPriority(deadline.priority);
}

function priorityWeight(priority: Priority): number {
  switch (priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function deadlineScore(deadline: Deadline, dueDate: Date, now: Date): number {
  const hoursUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
  const urgency =
    hoursUntilDue <= 0 ? 500 :
    hoursUntilDue <= 24 ? 450 :
    hoursUntilDue <= 48 ? 380 :
    hoursUntilDue <= 72 ? 320 :
    hoursUntilDue <= 7 * 24 ? 260 : 180;

  return priorityWeight(deadline.priority) * 100 + urgency;
}

function buildRationale(deadline: Deadline, dueDate: Date, startTime: Date, now: Date): string {
  const hoursUntilDue = Math.floor((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60));
  const startsInHours = Math.floor((startTime.getTime() - now.getTime()) / (1000 * 60 * 60));

  if (hoursUntilDue <= 0) {
    return `Overdue ${deadline.course} work, scheduled immediately in the next available block.`;
  }
  if (hoursUntilDue <= 48) {
    return `Due soon (${hoursUntilDue}h). This block is prioritized to reduce deadline risk.`;
  }
  if (startsInHours <= 24) {
    return `Scheduled in a near-term gap to keep steady progress before the due date.`;
  }
  return `Placed in a quality work block this week based on priority and availability.`;
}

function normalizeOptions(options: StudyPlanOptions): Required<StudyPlanOptions> {
  return {
    horizonDays: options.horizonDays ?? 7,
    minSessionMinutes: options.minSessionMinutes ?? 45,
    maxSessionMinutes: options.maxSessionMinutes ?? 120,
    now: options.now ?? new Date()
  };
}

function toUnallocatedItem(item: DeadlineState): StudyPlanUnallocatedItem {
  return {
    deadlineId: item.deadline.id,
    course: item.deadline.course,
    task: item.deadline.task,
    priority: item.deadline.priority,
    dueDate: item.deadline.dueDate,
    remainingMinutes: item.remainingMinutes,
    reason: "Insufficient schedule gaps within planning window."
  };
}

export function generateWeeklyStudyPlan(
  deadlines: Deadline[],
  scheduleEvents: LectureEvent[],
  options: StudyPlanOptions = {}
): StudyPlan {
  const opts = normalizeOptions(options);
  const now = opts.now;
  const windowEnd = new Date(now.getTime() + opts.horizonDays * 24 * 60 * 60 * 1000);

  const states: DeadlineState[] = deadlines
    .filter((deadline) => !deadline.completed && isAssignmentOrExamDeadline(deadline))
    .map((deadline) => ({
      deadline,
      dueDate: new Date(deadline.dueDate)
    }))
    .filter((entry) => !Number.isNaN(entry.dueDate.getTime()) && entry.dueDate.getTime() <= windowEnd.getTime())
    .map((entry) => ({
      ...entry,
      score: deadlineScore(entry.deadline, entry.dueDate, now),
      remainingMinutes: estimateWorkMinutes(entry.deadline)
    }));

  if (states.length === 0) {
    return {
      generatedAt: now.toISOString(),
      windowStart: now.toISOString(),
      windowEnd: windowEnd.toISOString(),
      summary: {
        horizonDays: opts.horizonDays,
        deadlinesConsidered: 0,
        deadlinesCovered: 0,
        totalSessions: 0,
        totalPlannedMinutes: 0
      },
      sessions: [],
      unallocated: []
    };
  }

  const gaps = calculateScheduleGaps(scheduleEvents, now, windowEnd).filter(
    (gap) => gap.durationMinutes >= opts.minSessionMinutes
  );

  const sessions: StudyPlanSession[] = [];

  for (const gap of gaps) {
    let cursor = new Date(gap.startTime);
    let gapMinutesRemaining = gap.durationMinutes;

    while (gapMinutesRemaining >= opts.minSessionMinutes) {
      const candidate = states
        .filter((state) => state.remainingMinutes >= opts.minSessionMinutes)
        .sort((a, b) => {
          if (a.score !== b.score) return b.score - a.score;
          if (a.dueDate.getTime() !== b.dueDate.getTime()) return a.dueDate.getTime() - b.dueDate.getTime();
          const taskCmp = a.deadline.task.localeCompare(b.deadline.task);
          if (taskCmp !== 0) {
            return taskCmp;
          }
          return a.deadline.id.localeCompare(b.deadline.id);
        })[0];

      if (!candidate) {
        break;
      }

      const durationMinutes = Math.min(
        gapMinutesRemaining,
        opts.maxSessionMinutes,
        candidate.remainingMinutes
      );

      if (durationMinutes < opts.minSessionMinutes) {
        break;
      }

      const startTime = new Date(cursor);
      const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
      const sessionTimeKey = startTime.toISOString().replace(/[-:.TZ]/g, "");

      sessions.push({
        id: `study-session-${candidate.deadline.id}-${sessionTimeKey}`,
        deadlineId: candidate.deadline.id,
        course: candidate.deadline.course,
        task: candidate.deadline.task,
        priority: candidate.deadline.priority,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        durationMinutes,
        score: candidate.score,
        rationale: buildRationale(candidate.deadline, candidate.dueDate, startTime, now)
      });

      candidate.remainingMinutes -= durationMinutes;
      cursor = endTime;
      gapMinutesRemaining -= durationMinutes;
    }
  }

  sessions.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const unallocated = states
    .filter((state) => state.remainingMinutes > 0)
    .map(toUnallocatedItem);
  const coveredDeadlines = new Set(
    states.filter((state) => state.remainingMinutes <= 0).map((state) => state.deadline.id)
  );
  const totalPlannedMinutes = sessions.reduce((sum, session) => sum + session.durationMinutes, 0);

  return {
    generatedAt: now.toISOString(),
    windowStart: now.toISOString(),
    windowEnd: windowEnd.toISOString(),
    summary: {
      horizonDays: opts.horizonDays,
      deadlinesConsidered: states.length,
      deadlinesCovered: coveredDeadlines.size,
      totalSessions: sessions.length,
      totalPlannedMinutes
    },
    sessions,
    unallocated
  };
}
