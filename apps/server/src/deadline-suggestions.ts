import { Deadline, LectureEvent, UserContext, WorkBlockSuggestion } from "./types.js";
import { calculateScheduleGaps, ScheduleGap } from "./smart-timing.js";

/**
 * Estimate work duration needed for a deadline based on priority
 */
function estimateWorkDuration(deadline: Deadline): number {
  switch (deadline.priority) {
    case "critical":
      return 180; // 3 hours
    case "high":
      return 120; // 2 hours
    case "medium":
      return 90; // 1.5 hours
    case "low":
      return 60; // 1 hour
    default:
      return 90;
  }
}

/**
 * Calculate urgency multiplier based on how soon deadline is due
 */
function calculateUrgencyMultiplier(deadline: Deadline, currentTime: Date): number {
  const dueDate = new Date(deadline.dueDate);
  const hoursUntilDue = (dueDate.getTime() - currentTime.getTime()) / (60 * 60 * 1000);
  
  if (hoursUntilDue < 0) {
    // Overdue - maximum urgency
    return 2.0;
  } else if (hoursUntilDue <= 24) {
    // Due within 24 hours
    return 1.8;
  } else if (hoursUntilDue <= 48) {
    // Due within 2 days
    return 1.5;
  } else if (hoursUntilDue <= 72) {
    // Due within 3 days
    return 1.3;
  } else if (hoursUntilDue <= 168) {
    // Due within a week
    return 1.1;
  } else {
    return 1.0;
  }
}

/**
 * Score a schedule gap based on duration and timing quality
 */
function scoreGapQuality(gap: ScheduleGap, estimatedDuration: number, currentTime: Date): number {
  let score = 0;
  
  // Factor 1: Gap duration adequacy (0-40 points)
  if (gap.durationMinutes >= estimatedDuration * 1.5) {
    // Gap is much longer than needed - excellent
    score += 40;
  } else if (gap.durationMinutes >= estimatedDuration) {
    // Gap is just enough - good
    score += 30;
  } else if (gap.durationMinutes >= estimatedDuration * 0.7) {
    // Gap is a bit short but workable
    score += 20;
  } else if (gap.durationMinutes >= 60) {
    // Gap is too short for full task but can make progress
    score += 10;
  }
  // Gaps shorter than 60 minutes get 0 points
  
  // Factor 2: Time of day quality (0-30 points)
  const startHour = gap.startTime.getHours();
  if (startHour >= 9 && startHour <= 11) {
    // Morning - peak productivity
    score += 30;
  } else if (startHour >= 14 && startHour <= 16) {
    // Early afternoon - good
    score += 25;
  } else if (startHour >= 19 && startHour <= 21) {
    // Evening - decent
    score += 20;
  } else if (startHour >= 8 && startHour < 9) {
    // Early morning - okay
    score += 15;
  } else if (startHour >= 16 && startHour < 19) {
    // Late afternoon - okay
    score += 15;
  } else {
    // Late night or very early - poor
    score += 5;
  }
  
  // Factor 3: Proximity to current time (0-30 points)
  const hoursFromNow = (gap.startTime.getTime() - currentTime.getTime()) / (60 * 60 * 1000);
  if (hoursFromNow < 0) {
    // Gap is in the past
    score = 0;
  } else if (hoursFromNow <= 2) {
    // Very soon - highly actionable
    score += 30;
  } else if (hoursFromNow <= 6) {
    // Today - still actionable
    score += 25;
  } else if (hoursFromNow <= 24) {
    // Tomorrow - good planning
    score += 20;
  } else if (hoursFromNow <= 48) {
    // Day after tomorrow
    score += 15;
  } else {
    // Further out
    score += 10;
  }
  
  return score;
}

/**
 * Calculate priority score for a deadline
 */
function calculatePriorityScore(deadline: Deadline): number {
  switch (deadline.priority) {
    case "critical":
      return 100;
    case "high":
      return 75;
    case "medium":
      return 50;
    case "low":
      return 25;
    default:
      return 50;
  }
}

/**
 * Generate rationale message for a suggestion
 */
function generateRationale(
  deadline: Deadline,
  gap: ScheduleGap,
  estimatedDuration: number,
  currentTime: Date
): string {
  const dueDate = new Date(deadline.dueDate);
  const hoursUntilDue = Math.floor((dueDate.getTime() - currentTime.getTime()) / (60 * 60 * 1000));
  const hoursFromNow = Math.floor((gap.startTime.getTime() - currentTime.getTime()) / (60 * 60 * 1000));
  
  let rationale = "";
  
  // Urgency component
  if (hoursUntilDue < 0) {
    rationale = "⚠️ Overdue! ";
  } else if (hoursUntilDue <= 24) {
    rationale = "🔥 Due in less than 24 hours. ";
  } else if (hoursUntilDue <= 48) {
    rationale = "⏰ Due tomorrow. ";
  } else if (hoursUntilDue <= 72) {
    rationale = "📅 Due within 3 days. ";
  }
  
  // Gap quality component
  if (gap.durationMinutes >= estimatedDuration * 1.5) {
    rationale += `You have ${gap.durationMinutes} minutes free - plenty of time to complete this task (estimated ${estimatedDuration} min).`;
  } else if (gap.durationMinutes >= estimatedDuration) {
    rationale += `This ${gap.durationMinutes}-minute window is perfect for this task (estimated ${estimatedDuration} min).`;
  } else if (gap.durationMinutes >= estimatedDuration * 0.7) {
    rationale += `You have ${gap.durationMinutes} minutes - enough to make significant progress (estimated ${estimatedDuration} min total).`;
  } else {
    rationale += `${gap.durationMinutes}-minute slot to start working on this.`;
  }
  
  // Timing component
  if (hoursFromNow <= 1) {
    rationale += " Start now while you have the time!";
  } else if (hoursFromNow <= 3) {
    rationale += " Coming up soon - good time to prepare.";
  }
  
  return rationale;
}

/**
 * Generate work block suggestions for upcoming deadlines
 */
export function generateDeadlineSuggestions(
  deadlines: Deadline[],
  scheduleEvents: LectureEvent[],
  userContext: UserContext,
  currentTime: Date = new Date(),
  lookAheadHours: number = 72
): WorkBlockSuggestion[] {
  // Filter to incomplete deadlines
  const incompleteDeadlines = deadlines.filter(d => !d.completed);
  
  if (incompleteDeadlines.length === 0) {
    return [];
  }
  
  // Calculate schedule gaps for the next lookAheadHours
  const lookAheadTime = new Date(currentTime.getTime() + lookAheadHours * 60 * 60 * 1000);
  const gaps = calculateScheduleGaps(scheduleEvents, currentTime, lookAheadTime);
  
  if (gaps.length === 0) {
    return [];
  }
  
  // Generate suggestions for each deadline-gap pair
  const suggestions: WorkBlockSuggestion[] = [];
  
  for (const deadline of incompleteDeadlines) {
    const estimatedDuration = estimateWorkDuration(deadline);
    const urgencyMultiplier = calculateUrgencyMultiplier(deadline, currentTime);
    const priorityScore = calculatePriorityScore(deadline);
    
    // Find best gaps for this deadline (top 3)
    const gapScores = gaps
      .map(gap => ({
        gap,
        gapScore: scoreGapQuality(gap, estimatedDuration, currentTime)
      }))
      .filter(item => item.gapScore > 0)
      .sort((a, b) => b.gapScore - a.gapScore)
      .slice(0, 3);
    
    for (const { gap, gapScore } of gapScores) {
      const overallScore = (gapScore + priorityScore * urgencyMultiplier) / 2;
      
      // Only include suggestions with decent quality
      if (overallScore >= 30) {
        const workDuration = Math.min(gap.durationMinutes, estimatedDuration);
        const suggestedEndTime = new Date(gap.startTime.getTime() + workDuration * 60 * 1000);
        
        suggestions.push({
          deadline,
          suggestedStartTime: gap.startTime.toISOString(),
          suggestedEndTime: suggestedEndTime.toISOString(),
          durationMinutes: workDuration,
          gapQualityScore: Math.round(gapScore),
          priorityScore: Math.round(priorityScore * urgencyMultiplier),
          overallScore: Math.round(overallScore),
          rationale: generateRationale(deadline, gap, estimatedDuration, currentTime)
        });
      }
    }
  }
  
  // Sort by overall score (highest first)
  suggestions.sort((a, b) => b.overallScore - a.overallScore);
  
  // Return top 10 suggestions to avoid overwhelming the user
  return suggestions.slice(0, 10);
}
