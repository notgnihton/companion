import { Deadline, LectureEvent, UserContext, DeadlineReminderState } from "./types.js";

export interface ScheduleGap {
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
}

export interface OptimalTimeContext {
  scheduleEvents: LectureEvent[];
  deadlines: Deadline[];
  userContext: UserContext;
  deadlineHistory: DeadlineReminderState[];
  currentTime: Date;
}

/**
 * Calculate schedule gaps (free time between lectures) for today and tomorrow
 */
export function calculateScheduleGaps(
  scheduleEvents: LectureEvent[],
  fromTime: Date,
  toTime: Date
): ScheduleGap[] {
  const gaps: ScheduleGap[] = [];
  
  // Filter events within the time window and sort by start time
  const relevantEvents = scheduleEvents
    .map(event => ({
      ...event,
      startDate: new Date(event.startTime),
      endDate: new Date(new Date(event.startTime).getTime() + event.durationMinutes * 60 * 1000)
    }))
    .filter(event => event.startDate >= fromTime && event.startDate <= toTime)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  if (relevantEvents.length === 0) {
    // No lectures scheduled - entire period is a gap
    const durationMinutes = Math.floor((toTime.getTime() - fromTime.getTime()) / (60 * 1000));
    gaps.push({
      startTime: fromTime,
      endTime: toTime,
      durationMinutes
    });
    return gaps;
  }

  // Gap before first event
  const firstEvent = relevantEvents[0];
  if (firstEvent.startDate.getTime() > fromTime.getTime()) {
    const durationMinutes = Math.floor((firstEvent.startDate.getTime() - fromTime.getTime()) / (60 * 1000));
    if (durationMinutes >= 30) {
      gaps.push({
        startTime: fromTime,
        endTime: firstEvent.startDate,
        durationMinutes
      });
    }
  }

  // Gaps between events
  for (let i = 0; i < relevantEvents.length - 1; i++) {
    const currentEnd = relevantEvents[i].endDate;
    const nextStart = relevantEvents[i + 1].startDate;
    const durationMinutes = Math.floor((nextStart.getTime() - currentEnd.getTime()) / (60 * 1000));
    
    if (durationMinutes >= 30) {
      gaps.push({
        startTime: currentEnd,
        endTime: nextStart,
        durationMinutes
      });
    }
  }

  // Gap after last event
  const lastEvent = relevantEvents[relevantEvents.length - 1];
  if (lastEvent.endDate.getTime() < toTime.getTime()) {
    const durationMinutes = Math.floor((toTime.getTime() - lastEvent.endDate.getTime()) / (60 * 1000));
    if (durationMinutes >= 30) {
      gaps.push({
        startTime: lastEvent.endDate,
        endTime: toTime,
        durationMinutes
      });
    }
  }

  return gaps;
}

/**
 * Analyze historical completion patterns to determine peak productivity hours
 */
export function analyzeCompletionPatterns(
  deadlineHistory: DeadlineReminderState[]
): { peakHours: number[] } {
  const completionHours: Record<number, number> = {};

  for (const reminder of deadlineHistory) {
    if (reminder.lastConfirmedCompleted && reminder.lastConfirmationAt) {
      const hour = new Date(reminder.lastConfirmationAt).getHours();
      completionHours[hour] = (completionHours[hour] || 0) + 1;
    }
  }

  // Find hours with above-average completions
  const hours = Object.keys(completionHours).map(Number);
  if (hours.length === 0) {
    // Default to common productive hours
    return { peakHours: [9, 10, 14, 15, 16, 19, 20] };
  }

  const average = Object.values(completionHours).reduce((a, b) => a + b, 0) / hours.length;
  const peakHours = hours.filter(hour => completionHours[hour] >= average);

  return { peakHours: peakHours.length > 0 ? peakHours : [9, 10, 14, 15, 16, 19, 20] };
}

/**
 * Score a potential notification time based on multiple factors
 */
function scoreNotificationTime(
  time: Date,
  context: OptimalTimeContext,
  peakHours: number[]
): number {
  let score = 0;
  const hour = time.getHours();

  // Factor 1: Energy level alignment (0-40 points)
  if (context.userContext.energyLevel === "high") {
    // High energy - prefer earlier times and peak hours
    if (hour >= 9 && hour <= 12) score += 40;
    else if (hour >= 14 && hour <= 17) score += 30;
    else score += 20;
  } else if (context.userContext.energyLevel === "medium") {
    // Medium energy - prefer mid-day and afternoon
    if (hour >= 10 && hour <= 16) score += 40;
    else if (hour >= 17 && hour <= 20) score += 30;
    else score += 15;
  } else {
    // Low energy - prefer later times, avoid early morning
    if (hour >= 14 && hour <= 18) score += 40;
    else if (hour >= 19 && hour <= 21) score += 30;
    else if (hour < 10) score += 5;
    else score += 20;
  }

  // Factor 2: Historical completion pattern (0-30 points)
  if (peakHours.includes(hour)) {
    score += 30;
  } else if (peakHours.includes(hour - 1) || peakHours.includes(hour + 1)) {
    score += 15;
  }

  // Factor 3: User mode (0-20 points)
  if (context.userContext.mode === "focus") {
    // In focus mode, prefer times soon to avoid interrupting current work
    const hoursFromNow = (time.getTime() - context.currentTime.getTime()) / (60 * 60 * 1000);
    if (hoursFromNow <= 0.5) score += 20; // Within 30 minutes
    else if (hoursFromNow <= 2) score += 15;
    else score += 5;
  } else if (context.userContext.mode === "recovery") {
    // In recovery mode, prefer later times
    const hoursFromNow = (time.getTime() - context.currentTime.getTime()) / (60 * 60 * 1000);
    if (hoursFromNow >= 2) score += 20;
    else if (hoursFromNow >= 1) score += 10;
    else score += 5;
  } else {
    // Balanced mode - moderate delay
    const hoursFromNow = (time.getTime() - context.currentTime.getTime()) / (60 * 60 * 1000);
    if (hoursFromNow >= 0.5 && hoursFromNow <= 2) score += 20;
    else if (hoursFromNow <= 4) score += 15;
    else score += 10;
  }

  // Factor 4: Stress level adjustment (0-10 points)
  if (context.userContext.stressLevel === "low") {
    score += 10; // Can handle notifications better
  } else if (context.userContext.stressLevel === "medium") {
    score += 5;
  }
  // High stress: no bonus points

  return score;
}

/**
 * Calculate optimal time to send a notification based on schedule gaps,
 * energy levels, and historical completion patterns
 */
export function calculateOptimalNotificationTime(
  context: OptimalTimeContext,
  priorityUrgent: boolean = false
): Date {
  // Critical/urgent notifications should be sent immediately
  if (priorityUrgent) {
    return context.currentTime;
  }

  // Calculate schedule gaps for the next 24 hours
  const now = context.currentTime;
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const gaps = calculateScheduleGaps(context.scheduleEvents, now, tomorrow);

  // If no gaps (unlikely), send immediately
  if (gaps.length === 0) {
    return now;
  }

  // Analyze historical patterns
  const { peakHours } = analyzeCompletionPatterns(context.deadlineHistory);

  // Score all potential times (middle of each gap)
  const candidates: Array<{ time: Date; score: number }> = [];
  
  for (const gap of gaps) {
    // Consider multiple times within larger gaps
    if (gap.durationMinutes >= 120) {
      // Large gap - consider start, middle, and end
      const times = [
        new Date(gap.startTime.getTime() + 15 * 60 * 1000), // 15 min after start
        new Date(gap.startTime.getTime() + gap.durationMinutes * 30 * 1000), // middle
        new Date(gap.endTime.getTime() - 30 * 60 * 1000) // 30 min before end
      ];
      
      for (const time of times) {
        if (time >= now) {
          candidates.push({
            time,
            score: scoreNotificationTime(time, context, peakHours)
          });
        }
      }
    } else if (gap.durationMinutes >= 60) {
      // Medium gap - consider start and middle
      const times = [
        new Date(gap.startTime.getTime() + 10 * 60 * 1000),
        new Date(gap.startTime.getTime() + gap.durationMinutes * 30 * 1000)
      ];
      
      for (const time of times) {
        if (time >= now) {
          candidates.push({
            time,
            score: scoreNotificationTime(time, context, peakHours)
          });
        }
      }
    } else {
      // Small gap - just use middle
      const time = new Date(gap.startTime.getTime() + gap.durationMinutes * 30 * 1000);
      if (time >= now) {
        candidates.push({
          time,
          score: scoreNotificationTime(time, context, peakHours)
        });
      }
    }
  }

  // If no valid candidates (all in the past), send immediately
  if (candidates.length === 0) {
    return now;
  }

  // Find the highest scoring time
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].time;
}
