import { FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { RuntimeStore } from "./store.js";
import {
  ChatActionType,
  ChatPendingAction,
  Deadline,
  GmailMessage,
  GoalWithStatus,
  GitHubCourseDocument,
  HabitWithStatus,
  JournalEntry,
  LectureEvent,
  RoutinePreset,
  NutritionDailySummary,
  NutritionCustomFood,
  NutritionMeal,
  NutritionMealPlanBlock,
  NutritionMealType
} from "./types.js";
import { applyRoutinePresetPlacements } from "./routine-presets.js";

/**
 * Function declarations for Gemini function calling.
 * These define the tools that Gemini can invoke to retrieve information on demand.
 */

export const functionDeclarations: FunctionDeclaration[] = [
  {
    name: "getSchedule",
    description:
      "Get today's lecture schedule for the user. Returns list of lectures with times, durations, and course names. Use this when user asks about today's schedule, what lectures they have, or when they're free today.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
      required: []
    }
  },
  {
    name: "getRoutinePresets",
    description:
      "Get reusable routine presets that auto-place into free schedule blocks (for example gym at 07:00 or nightly review at 21:00).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
      required: []
    }
  },
  {
    name: "getDeadlines",
    description:
      "Get upcoming deadlines for assignments and tasks. Returns deadlines with due dates, priority levels, and completion status. Use this when user asks about upcoming work, deadlines, or what's due soon.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        daysAhead: {
          type: SchemaType.NUMBER,
          description: "Number of days ahead to fetch deadlines (default: 30 days)."
        },
        courseCode: {
          type: SchemaType.STRING,
          description: "Optional course filter like DAT520 or DAT560."
        },
        query: {
          type: SchemaType.STRING,
          description: "Optional free-text filter matched against course/task."
        },
        includeOverdue: {
          type: SchemaType.BOOLEAN,
          description: "Set true to include recently overdue deadlines."
        },
        includeCompleted: {
          type: SchemaType.BOOLEAN,
          description: "Set true to include completed deadlines."
        }
      },
      required: []
    }
  },
  {
    name: "searchJournal",
    description:
      "Search journal entries by keywords or date range. Returns journal entries matching the search criteria. Use this when user wants to recall past entries, reflect on previous experiences, or find specific journal content.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: "Search query to match against journal content"
        },
        limit: {
          type: SchemaType.NUMBER,
          description: "Maximum number of entries to return (default: 10)"
        }
      },
      required: []
    }
  },
  {
    name: "getEmails",
    description:
      "Get recent Gmail inbox messages. Returns sender, subject, snippet, read status, and received timestamp. Use this when user asks about emails, inbox, what their latest email said, or message contents.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        limit: {
          type: SchemaType.NUMBER,
          description: "Maximum number of emails to return (default: 5, max: 20)"
        },
        unreadOnly: {
          type: SchemaType.BOOLEAN,
          description: "Set true to return only unread emails"
        }
      },
      required: []
    }
  },
  {
    name: "getSocialDigest",
    description:
      "Get recent social media content digest from YouTube subscriptions and X (Twitter) feed. Returns recent videos and tweets. Use this when user asks about social media updates, YouTube videos, or X posts from accounts they follow.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        daysBack: {
          type: SchemaType.NUMBER,
          description: "Number of days to look back for content (default: 3)"
        }
      },
      required: []
    }
  },
  {
    name: "getHabitsGoalsStatus",
    description:
      "Get current habits and goals progress. Returns streaks, completion rates, and whether today's check-ins are done.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
      required: []
    }
  },
  {
    name: "updateHabitCheckIn",
    description:
      "Update a habit check-in for today. Use this when the user asks to check in or uncheck a specific habit.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        habitId: {
          type: SchemaType.STRING,
          description: "Habit ID (preferred when known)."
        },
        habitName: {
          type: SchemaType.STRING,
          description: "Habit name hint (for name-based matching when ID is unknown)."
        },
        completed: {
          type: SchemaType.BOOLEAN,
          description: "Set true to check in, false to uncheck. Defaults to toggle if omitted."
        }
      },
      required: []
    }
  },
  {
    name: "updateGoalCheckIn",
    description:
      "Update a goal check-in for today. Use this when the user asks to log or undo progress on a specific goal.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        goalId: {
          type: SchemaType.STRING,
          description: "Goal ID (preferred when known)."
        },
        goalTitle: {
          type: SchemaType.STRING,
          description: "Goal title hint (for name-based matching when ID is unknown)."
        },
        completed: {
          type: SchemaType.BOOLEAN,
          description: "Set true to log progress today, false to remove today's check-in. Defaults to toggle."
        }
      },
      required: []
    }
  },
  {
    name: "createHabit",
    description:
      "Create a new habit. Use this when the user asks to add/start tracking a habit.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name: {
          type: SchemaType.STRING,
          description: "Habit name."
        },
        cadence: {
          type: SchemaType.STRING,
          description: "Cadence: daily or weekly. Defaults to daily."
        },
        targetPerWeek: {
          type: SchemaType.NUMBER,
          description: "Target check-ins per week. Defaults based on cadence."
        },
        motivation: {
          type: SchemaType.STRING,
          description: "Optional reason/motivation for the habit."
        }
      },
      required: ["name"]
    }
  },
  {
    name: "deleteHabit",
    description:
      "Delete an existing habit. Prefer habitId; habitName may be used for matching when id is unknown.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        habitId: {
          type: SchemaType.STRING,
          description: "Habit ID (preferred)."
        },
        habitName: {
          type: SchemaType.STRING,
          description: "Habit name hint when ID is unknown."
        }
      },
      required: []
    }
  },
  {
    name: "createGoal",
    description:
      "Create a new goal. Use this when the user asks to add/start tracking a goal.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title: {
          type: SchemaType.STRING,
          description: "Goal title."
        },
        cadence: {
          type: SchemaType.STRING,
          description: "Cadence: daily or weekly. Defaults to weekly."
        },
        targetCount: {
          type: SchemaType.NUMBER,
          description: "Target number of check-ins. Defaults to 1."
        },
        dueDate: {
          type: SchemaType.STRING,
          description: "Optional due date as ISO datetime."
        },
        motivation: {
          type: SchemaType.STRING,
          description: "Optional reason/motivation for the goal."
        }
      },
      required: ["title"]
    }
  },
  {
    name: "deleteGoal",
    description:
      "Delete an existing goal. Prefer goalId; goalTitle may be used for matching when id is unknown.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        goalId: {
          type: SchemaType.STRING,
          description: "Goal ID (preferred)."
        },
        goalTitle: {
          type: SchemaType.STRING,
          description: "Goal title hint when ID is unknown."
        }
      },
      required: []
    }
  },
  {
    name: "getNutritionSummary",
    description:
      "Get a daily nutrition summary with calories and macro totals (protein/carbs/fat), plus logged meals and meal-plan blocks.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        date: {
          type: SchemaType.STRING,
          description: "Optional date in YYYY-MM-DD format. Defaults to today."
        }
      },
      required: []
    }
  },
  {
    name: "getNutritionCustomFoods",
    description:
      "Get saved custom foods for macro tracking. Returns per-unit calories/protein/carbs/fat values and identifiers.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: "Optional name filter."
        },
        limit: {
          type: SchemaType.NUMBER,
          description: "Maximum number of foods to return (default: 20, max: 200)."
        }
      },
      required: []
    }
  },
  {
    name: "createNutritionCustomFood",
    description:
      "Create a reusable custom food with per-unit calories and macros.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name: {
          type: SchemaType.STRING,
          description: "Custom food name."
        },
        unitLabel: {
          type: SchemaType.STRING,
          description: "Unit label such as serving, scoop, piece, or 100g."
        },
        caloriesPerUnit: {
          type: SchemaType.NUMBER,
          description: "Calories per unit."
        },
        proteinGramsPerUnit: {
          type: SchemaType.NUMBER,
          description: "Protein grams per unit."
        },
        carbsGramsPerUnit: {
          type: SchemaType.NUMBER,
          description: "Carb grams per unit."
        },
        fatGramsPerUnit: {
          type: SchemaType.NUMBER,
          description: "Fat grams per unit."
        }
      },
      required: ["name", "caloriesPerUnit"]
    }
  },
  {
    name: "updateNutritionCustomFood",
    description:
      "Update an existing custom food. Use customFoodId when possible; customFoodName can be used for matching.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        customFoodId: {
          type: SchemaType.STRING,
          description: "Custom food ID (preferred)."
        },
        customFoodName: {
          type: SchemaType.STRING,
          description: "Custom food name hint when ID is unknown."
        },
        name: {
          type: SchemaType.STRING,
          description: "Updated custom food name."
        },
        unitLabel: {
          type: SchemaType.STRING,
          description: "Updated unit label."
        },
        caloriesPerUnit: {
          type: SchemaType.NUMBER,
          description: "Updated calories per unit."
        },
        proteinGramsPerUnit: {
          type: SchemaType.NUMBER,
          description: "Updated protein grams per unit."
        },
        carbsGramsPerUnit: {
          type: SchemaType.NUMBER,
          description: "Updated carb grams per unit."
        },
        fatGramsPerUnit: {
          type: SchemaType.NUMBER,
          description: "Updated fat grams per unit."
        }
      },
      required: []
    }
  },
  {
    name: "deleteNutritionCustomFood",
    description:
      "Delete a custom food. Use customFoodId when possible; customFoodName can be used for matching.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        customFoodId: {
          type: SchemaType.STRING,
          description: "Custom food ID (preferred)."
        },
        customFoodName: {
          type: SchemaType.STRING,
          description: "Custom food name hint when ID is unknown."
        }
      },
      required: []
    }
  },
  {
    name: "logMeal",
    description:
      "Log a meal with calories and macros (protein/carbs/fat). You can either provide explicit macros or reference a saved custom food.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        customFoodId: {
          type: SchemaType.STRING,
          description: "Optional custom food ID to derive macros."
        },
        customFoodName: {
          type: SchemaType.STRING,
          description: "Optional custom food name hint when customFoodId is unknown."
        },
        servings: {
          type: SchemaType.NUMBER,
          description: "Multiplier for custom-food macros (default: 1)."
        },
        name: {
          type: SchemaType.STRING,
          description: "Meal name. Optional when custom food is provided."
        },
        mealType: {
          type: SchemaType.STRING,
          description: "Meal type: breakfast, lunch, dinner, snack, or other."
        },
        consumedAt: {
          type: SchemaType.STRING,
          description: "Optional consumed time as ISO datetime. Defaults to now."
        },
        calories: {
          type: SchemaType.NUMBER,
          description: "Calories for the meal."
        },
        proteinGrams: {
          type: SchemaType.NUMBER,
          description: "Protein grams."
        },
        carbsGrams: {
          type: SchemaType.NUMBER,
          description: "Carbohydrate grams."
        },
        fatGrams: {
          type: SchemaType.NUMBER,
          description: "Fat grams."
        },
        notes: {
          type: SchemaType.STRING,
          description: "Optional note."
        }
      },
      required: []
    }
  },
  {
    name: "deleteMeal",
    description:
      "Delete a logged meal entry. Prefer mealId; mealName may be used when id is unknown.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        mealId: {
          type: SchemaType.STRING,
          description: "Meal ID (preferred)."
        },
        mealName: {
          type: SchemaType.STRING,
          description: "Meal name hint when ID is unknown."
        }
      },
      required: []
    }
  },
  {
    name: "getMealPlan",
    description:
      "Get nutrition meal-plan blocks for a day/time window. Use this when user asks about planned meals.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        date: {
          type: SchemaType.STRING,
          description: "Optional date in YYYY-MM-DD format."
        },
        limit: {
          type: SchemaType.NUMBER,
          description: "Maximum number of plan blocks to return (default: 20, max: 100)."
        }
      },
      required: []
    }
  },
  {
    name: "upsertMealPlanBlock",
    description:
      "Create or update a meal-plan block with target macros/calories.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        blockId: {
          type: SchemaType.STRING,
          description: "Existing block ID for updates."
        },
        title: {
          type: SchemaType.STRING,
          description: "Meal-plan block title."
        },
        scheduledFor: {
          type: SchemaType.STRING,
          description: "ISO datetime for scheduled meal block."
        },
        targetCalories: {
          type: SchemaType.NUMBER,
          description: "Optional target calories."
        },
        targetProteinGrams: {
          type: SchemaType.NUMBER,
          description: "Optional target protein grams."
        },
        targetCarbsGrams: {
          type: SchemaType.NUMBER,
          description: "Optional target carbs grams."
        },
        targetFatGrams: {
          type: SchemaType.NUMBER,
          description: "Optional target fat grams."
        },
        notes: {
          type: SchemaType.STRING,
          description: "Optional notes."
        }
      },
      required: []
    }
  },
  {
    name: "removeMealPlanBlock",
    description:
      "Remove a meal-plan block. Prefer blockId; blockTitle may be used when id is unknown.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        blockId: {
          type: SchemaType.STRING,
          description: "Meal-plan block ID (preferred)."
        },
        blockTitle: {
          type: SchemaType.STRING,
          description: "Meal-plan block title hint when ID is unknown."
        }
      },
      required: []
    }
  },
  {
    name: "getGitHubCourseContent",
    description:
      "Get synced GitHub syllabus/course-info documents. Use this for questions about course policies, deliverables, grading, exams, lab expectations, and repository-based course material.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        courseCode: {
          type: SchemaType.STRING,
          description: "Optional course code filter such as DAT560 or DAT520."
        },
        query: {
          type: SchemaType.STRING,
          description: "Optional keyword query to rank matching documents."
        },
        limit: {
          type: SchemaType.NUMBER,
          description: "Maximum number of documents to return (default: 5, max: 10)."
        }
      },
      required: []
    }
  },
  {
    name: "queueDeadlineAction",
    description:
      "Queue a deadline action that REQUIRES explicit user confirmation before execution. Use this to request complete or snooze for a specific deadline.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        deadlineId: {
          type: SchemaType.STRING,
          description: "Deadline ID to modify"
        },
        action: {
          type: SchemaType.STRING,
          description: "Action to queue: complete or snooze"
        },
        snoozeHours: {
          type: SchemaType.NUMBER,
          description: "When action is snooze, number of hours to delay (default: 24)"
        }
      },
      required: ["deadlineId", "action"]
    }
  },
  {
    name: "queueScheduleBlock",
    description:
      "Queue creation of a schedule block that REQUIRES explicit user confirmation before execution.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title: {
          type: SchemaType.STRING,
          description: "Title for the schedule block"
        },
        startTime: {
          type: SchemaType.STRING,
          description: "ISO datetime when the block starts"
        },
        durationMinutes: {
          type: SchemaType.NUMBER,
          description: "Length of block in minutes (default: 60)"
        },
        workload: {
          type: SchemaType.STRING,
          description: "Workload level: low, medium, high (default: medium)"
        }
      },
      required: ["title", "startTime"]
    }
  },
  {
    name: "queueUpdateScheduleBlock",
    description:
      "Queue an update to an existing schedule block that REQUIRES explicit user confirmation before execution.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        scheduleId: {
          type: SchemaType.STRING,
          description: "Existing schedule block ID (preferred)."
        },
        scheduleTitle: {
          type: SchemaType.STRING,
          description: "Existing schedule block title hint when ID is unknown."
        },
        title: {
          type: SchemaType.STRING,
          description: "Updated title for the schedule block."
        },
        startTime: {
          type: SchemaType.STRING,
          description: "Updated ISO datetime when the block starts."
        },
        durationMinutes: {
          type: SchemaType.NUMBER,
          description: "Updated block duration in minutes."
        },
        workload: {
          type: SchemaType.STRING,
          description: "Updated workload level: low, medium, high."
        }
      },
      required: []
    }
  },
  {
    name: "queueCreateRoutinePreset",
    description:
      "Queue creation of a reusable routine preset that REQUIRES explicit user confirmation before execution.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title: {
          type: SchemaType.STRING,
          description: "Routine title, for example 'Morning gym'."
        },
        preferredStartTime: {
          type: SchemaType.STRING,
          description: "Preferred local 24h time in HH:mm format, for example 07:00."
        },
        durationMinutes: {
          type: SchemaType.NUMBER,
          description: "Routine duration in minutes (default: 60)."
        },
        workload: {
          type: SchemaType.STRING,
          description: "Workload level: low, medium, high (default: medium)."
        },
        weekdays: {
          type: SchemaType.ARRAY,
          description: "Optional weekdays to place routine: numbers 0-6 (Sun-Sat). Defaults to all days.",
          items: {
            type: SchemaType.NUMBER
          }
        }
      },
      required: ["title", "preferredStartTime"]
    }
  },
  {
    name: "queueUpdateRoutinePreset",
    description:
      "Queue updates to an existing routine preset that REQUIRES explicit user confirmation before execution.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        presetId: {
          type: SchemaType.STRING,
          description: "Routine preset ID (preferred)."
        },
        presetTitle: {
          type: SchemaType.STRING,
          description: "Routine preset title hint when ID is unknown."
        },
        title: {
          type: SchemaType.STRING,
          description: "Updated routine title."
        },
        preferredStartTime: {
          type: SchemaType.STRING,
          description: "Updated preferred 24h start time (HH:mm)."
        },
        durationMinutes: {
          type: SchemaType.NUMBER,
          description: "Updated duration in minutes."
        },
        workload: {
          type: SchemaType.STRING,
          description: "Updated workload level: low, medium, high."
        },
        weekdays: {
          type: SchemaType.ARRAY,
          description: "Updated weekdays list as numbers 0-6 (Sun-Sat).",
          items: {
            type: SchemaType.NUMBER
          }
        },
        active: {
          type: SchemaType.BOOLEAN,
          description: "Set false to pause placements for this preset."
        }
      },
      required: []
    }
  },
  {
    name: "createJournalEntry",
    description:
      "Create and save a journal entry immediately. Use this when the user asks to save something to their journal right now.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        content: {
          type: SchemaType.STRING,
          description: "Journal text content to save immediately"
        }
      },
      required: ["content"]
    }
  }
];

/**
 * Function handlers that execute the actual function calls.
 */

export interface FunctionCallResult {
  name: string;
  response: unknown;
}

function isSameDay(dateA: Date, dateB: Date): boolean {
  return (
    dateA.getUTCFullYear() === dateB.getUTCFullYear() &&
    dateA.getUTCMonth() === dateB.getUTCMonth() &&
    dateA.getUTCDate() === dateB.getUTCDate()
  );
}

export function handleGetSchedule(store: RuntimeStore, _args: Record<string, unknown> = {}): LectureEvent[] {
  const now = new Date();
  const todaySchedule = store
    .getScheduleEvents()
    .filter((event) => isSameDay(new Date(event.startTime), now));

  return todaySchedule;
}

export function handleGetRoutinePresets(
  store: RuntimeStore,
  _args: Record<string, unknown> = {}
): RoutinePreset[] {
  return store.getRoutinePresets();
}

export function handleGetDeadlines(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): Deadline[] {
  const daysAhead = clampNumber(args.daysAhead, 30, 1, 365);
  const includeOverdue = args.includeOverdue === true;
  const includeCompleted = args.includeCompleted === true;
  const requestedCourseCode = asTrimmedString(args.courseCode);
  const query = asTrimmedString(args.query)?.toLowerCase();
  const normalizedCourseCode = requestedCourseCode
    ? requestedCourseCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
    : null;
  const now = new Date();
  const maxPastDays = 45;

  const deadlines = store
    .getAcademicDeadlines(now)
    .filter((deadline) => (includeCompleted ? true : !deadline.completed))
    .filter((deadline) => {
      const due = new Date(deadline.dueDate);
      if (Number.isNaN(due.getTime())) {
        return false;
      }
      const diffDays = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > daysAhead) {
        return false;
      }
      if (diffDays < 0 && !includeOverdue) {
        return false;
      }
      return diffDays >= -maxPastDays;
    })
    .filter((deadline) => {
      if (!normalizedCourseCode) {
        return true;
      }
      const normalizedCourse = deadline.course.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      const normalizedTask = deadline.task.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      return (
        normalizedCourse.includes(normalizedCourseCode) || normalizedTask.includes(normalizedCourseCode)
      );
    })
    .filter((deadline) => {
      if (!query) {
        return true;
      }
      const haystack = `${deadline.course} ${deadline.task}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((left, right) => {
      const leftDue = new Date(left.dueDate).getTime();
      const rightDue = new Date(right.dueDate).getTime();
      if (leftDue !== rightDue) {
        return leftDue - rightDue;
      }
      const courseCmp = left.course.localeCompare(right.course);
      if (courseCmp !== 0) {
        return courseCmp;
      }
      return left.task.localeCompare(right.task);
    });

  return deadlines;
}

export function handleSearchJournal(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): JournalEntry[] {
  const query = (args.query as string) ?? "";
  const limit = (args.limit as number) ?? 10;

  if (!query) {
    // If no query, return recent entries
    return store.getJournalEntries(limit);
  }

  const results = store.searchJournalEntries({
    query,
    limit
  });

  return results;
}

export function handleGetEmails(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): GmailMessage[] {
  const limit = clampNumber(args.limit, 5, 1, 20);
  const unreadOnly = args.unreadOnly === true;
  const messages = store
    .getGmailMessages()
    .filter((message) => (unreadOnly ? !message.isRead : true))
    .sort((left, right) => {
      const leftMs = new Date(left.receivedAt).getTime();
      const rightMs = new Date(right.receivedAt).getTime();
      const safeLeftMs = Number.isFinite(leftMs) ? leftMs : 0;
      const safeRightMs = Number.isFinite(rightMs) ? rightMs : 0;
      return safeRightMs - safeLeftMs;
    });

  return messages.slice(0, limit);
}

export function handleGetSocialDigest(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { youtube: unknown; x: unknown } {
  const daysBack = (args.daysBack as number) ?? 3;
  const now = new Date();
  const cutoffTime = now.getTime() - daysBack * 24 * 60 * 60 * 1000;

  // Get YouTube data
  const youtubeData = store.getYouTubeData();
  const recentVideos =
    youtubeData?.videos.filter((video) => {
      const publishedAt = new Date(video.publishedAt);
      return !Number.isNaN(publishedAt.getTime()) && publishedAt.getTime() >= cutoffTime;
    }) ?? [];

  // Get X data
  const xData = store.getXData();
  const recentTweets =
    xData?.tweets.filter((tweet) => {
      const createdAt = new Date(tweet.createdAt);
      return !Number.isNaN(createdAt.getTime()) && createdAt.getTime() >= cutoffTime;
    }) ?? [];

  return {
    youtube: {
      videos: recentVideos.slice(0, 10),
      total: recentVideos.length
    },
    x: {
      tweets: recentTweets.slice(0, 10),
      total: recentTweets.length
    }
  };
}

export function handleGetHabitsGoalsStatus(
  store: RuntimeStore
): {
  habits: HabitWithStatus[];
  goals: GoalWithStatus[];
  summary: {
    habitsCompletedToday: number;
    habitsTotal: number;
    goalsCompletedToday: number;
    goalsTotal: number;
  };
} {
  const habits = store.getHabitsWithStatus();
  const goals = store.getGoalsWithStatus();

  return {
    habits,
    goals,
    summary: {
      habitsCompletedToday: habits.filter((habit) => habit.todayCompleted).length,
      habitsTotal: habits.length,
      goalsCompletedToday: goals.filter((goal) => goal.todayCompleted).length,
      goalsTotal: goals.length
    }
  };
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function resolveHabitTarget(
  store: RuntimeStore,
  args: Record<string, unknown>
): HabitWithStatus | { error: string } {
  const habitId = asTrimmedString(args.habitId);
  if (habitId) {
    const byId = store.getHabitsWithStatus().find((habit) => habit.id === habitId);
    if (!byId) {
      return { error: `Habit not found: ${habitId}` };
    }
    return byId;
  }

  const habitName = asTrimmedString(args.habitName);
  const habits = store.getHabitsWithStatus();
  if (habits.length === 0) {
    return { error: "No habits are configured yet." };
  }

  if (!habitName) {
    if (habits.length === 1) {
      return habits[0];
    }
    return { error: "Provide habitId or habitName when multiple habits exist." };
  }

  const needle = normalizeSearchText(habitName);
  const matches = habits.filter((habit) => normalizeSearchText(habit.name).includes(needle));
  if (matches.length === 0) {
    return { error: `No habit matched "${habitName}".` };
  }
  if (matches.length > 1) {
    return {
      error: `Habit name is ambiguous. Matches: ${matches
        .slice(0, 4)
        .map((habit) => habit.name)
        .join(", ")}`
    };
  }
  return matches[0];
}

function resolveGoalTarget(
  store: RuntimeStore,
  args: Record<string, unknown>
): GoalWithStatus | { error: string } {
  const goalId = asTrimmedString(args.goalId);
  if (goalId) {
    const byId = store.getGoalsWithStatus().find((goal) => goal.id === goalId);
    if (!byId) {
      return { error: `Goal not found: ${goalId}` };
    }
    return byId;
  }

  const goalTitle = asTrimmedString(args.goalTitle);
  const goals = store.getGoalsWithStatus();
  if (goals.length === 0) {
    return { error: "No goals are configured yet." };
  }

  if (!goalTitle) {
    if (goals.length === 1) {
      return goals[0];
    }
    return { error: "Provide goalId or goalTitle when multiple goals exist." };
  }

  const needle = normalizeSearchText(goalTitle);
  const matches = goals.filter((goal) => normalizeSearchText(goal.title).includes(needle));
  if (matches.length === 0) {
    return { error: `No goal matched "${goalTitle}".` };
  }
  if (matches.length > 1) {
    return {
      error: `Goal title is ambiguous. Matches: ${matches
        .slice(0, 4)
        .map((goal) => goal.title)
        .join(", ")}`
    };
  }
  return matches[0];
}

function resolveScheduleTarget(
  store: RuntimeStore,
  args: Record<string, unknown>
): LectureEvent | { error: string } {
  const scheduleId = asTrimmedString(args.scheduleId);
  if (scheduleId) {
    const byId = store.getScheduleEventById(scheduleId);
    if (!byId) {
      return { error: `Schedule block not found: ${scheduleId}` };
    }
    return byId;
  }

  const scheduleTitle = asTrimmedString(args.scheduleTitle);
  const schedule = store.getScheduleEvents();
  if (schedule.length === 0) {
    return { error: "No schedule blocks are available yet." };
  }

  if (!scheduleTitle) {
    if (schedule.length === 1) {
      return schedule[0];
    }
    return { error: "Provide scheduleId or scheduleTitle when multiple schedule blocks exist." };
  }

  const needle = normalizeSearchText(scheduleTitle);
  const matches = schedule.filter((event) => normalizeSearchText(event.title).includes(needle));
  if (matches.length === 0) {
    return { error: `No schedule block matched "${scheduleTitle}".` };
  }
  if (matches.length > 1) {
    return {
      error: `Schedule title is ambiguous. Matches: ${matches
        .slice(0, 4)
        .map((event) => event.title)
        .join(", ")}`
    };
  }
  return matches[0]!;
}

function parseRoutinePreferredStartTime(value: unknown): string | null {
  const raw = asTrimmedString(value);
  if (!raw) {
    return null;
  }

  if (/^([01]?\d|2[0-3]):([0-5]\d)$/.test(raw)) {
    const [hoursRaw, minutesRaw] = raw.split(":");
    const hours = hoursRaw.padStart(2, "0");
    const minutes = minutesRaw.padStart(2, "0");
    return `${hours}:${minutes}`;
  }

  const parsedDate = new Date(raw);
  if (!Number.isNaN(parsedDate.getTime())) {
    const hours = String(parsedDate.getUTCHours()).padStart(2, "0");
    const minutes = String(parsedDate.getUTCMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  }

  return null;
}

function parseRoutineWeekdays(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const weekdays = value
    .map((entry) => {
      if (typeof entry === "number") {
        return entry;
      }
      if (typeof entry === "string" && entry.trim().length > 0) {
        return Number(entry);
      }
      return Number.NaN;
    })
    .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6)
    .map((entry) => Number(entry));

  if (weekdays.length === 0) {
    return null;
  }

  return Array.from(new Set(weekdays)).sort((a, b) => a - b);
}

function resolveRoutinePresetTarget(
  store: RuntimeStore,
  args: Record<string, unknown>
): RoutinePreset | { error: string } {
  const presetId = asTrimmedString(args.presetId);
  if (presetId) {
    const byId = store.getRoutinePresetById(presetId);
    if (!byId) {
      return { error: `Routine preset not found: ${presetId}` };
    }
    return byId;
  }

  const presetTitle = asTrimmedString(args.presetTitle);
  const presets = store.getRoutinePresets();
  if (presets.length === 0) {
    return { error: "No routine presets are configured yet." };
  }

  if (!presetTitle) {
    if (presets.length === 1) {
      return presets[0];
    }
    return { error: "Provide presetId or presetTitle when multiple routine presets exist." };
  }

  const needle = normalizeSearchText(presetTitle);
  const matches = presets.filter((preset) => normalizeSearchText(preset.title).includes(needle));
  if (matches.length === 0) {
    return { error: `No routine preset matched "${presetTitle}".` };
  }
  if (matches.length > 1) {
    return {
      error: `Routine title is ambiguous. Matches: ${matches
        .slice(0, 4)
        .map((preset) => preset.title)
        .join(", ")}`
    };
  }
  return matches[0]!;
}

export function handleUpdateHabitCheckIn(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; habit: HabitWithStatus; message: string } | { error: string } {
  const resolved = resolveHabitTarget(store, args);
  if ("error" in resolved) {
    return resolved;
  }

  const next = store.toggleHabitCheckIn(resolved.id, {
    completed: typeof args.completed === "boolean" ? args.completed : undefined
  });

  if (!next) {
    return { error: "Unable to update habit check-in." };
  }

  return {
    success: true,
    habit: next,
    message: next.todayCompleted
      ? `Checked in habit "${next.name}" for today.`
      : `Removed today's check-in for habit "${next.name}".`
  };
}

export function handleUpdateGoalCheckIn(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; goal: GoalWithStatus; message: string } | { error: string } {
  const resolved = resolveGoalTarget(store, args);
  if ("error" in resolved) {
    return resolved;
  }

  const next = store.toggleGoalCheckIn(resolved.id, {
    completed: typeof args.completed === "boolean" ? args.completed : undefined
  });

  if (!next) {
    return { error: "Unable to update goal check-in." };
  }

  return {
    success: true,
    goal: next,
    message: next.todayCompleted
      ? `Logged progress for goal "${next.title}" today.`
      : `Removed today's goal progress for "${next.title}".`
  };
}

function parseCadence(value: unknown, fallback: "daily" | "weekly"): "daily" | "weekly" {
  const raw = asTrimmedString(value)?.toLowerCase();
  if (raw === "daily" || raw === "weekly") {
    return raw;
  }
  return fallback;
}

export function handleCreateHabit(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; habit: HabitWithStatus; created: boolean; message: string } | { error: string } {
  const name = asTrimmedString(args.name);
  if (!name) {
    return { error: "name is required." };
  }

  const existing = store
    .getHabitsWithStatus()
    .find((habit) => normalizeSearchText(habit.name) === normalizeSearchText(name));
  if (existing) {
    return {
      success: true,
      habit: existing,
      created: false,
      message: `Habit "${existing.name}" already exists.`
    };
  }

  const cadence = parseCadence(args.cadence, "daily");
  const targetPerWeek = clampNumber(args.targetPerWeek, cadence === "daily" ? 5 : 3, 1, 14);
  const motivation = asTrimmedString(args.motivation) ?? undefined;

  const habit = store.createHabit({
    name,
    cadence,
    targetPerWeek,
    ...(motivation ? { motivation } : {})
  });

  return {
    success: true,
    habit,
    created: true,
    message: `Created habit "${habit.name}".`
  };
}

export function handleDeleteHabit(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): {
  success: true;
  deleted: boolean;
  habitId?: string;
  habitName?: string;
  message: string;
} | { error: string } {
  const habits = store.getHabitsWithStatus();
  if (habits.length === 0) {
    return {
      success: true,
      deleted: false,
      message: "No habits exist yet."
    };
  }

  const habitId = asTrimmedString(args.habitId);
  const habitName = asTrimmedString(args.habitName);
  let target: HabitWithStatus | null = null;

  if (habitId) {
    target = habits.find((habit) => habit.id === habitId) ?? null;
    if (!target) {
      return {
        success: true,
        deleted: false,
        message: `Habit not found: ${habitId}`
      };
    }
  } else if (habitName) {
    const needle = normalizeSearchText(habitName);
    const matches = habits.filter((habit) => normalizeSearchText(habit.name).includes(needle));
    if (matches.length === 0) {
      return {
        success: true,
        deleted: false,
        message: `No habit matched "${habitName}".`
      };
    }
    if (matches.length > 1) {
      return {
        error: `Habit name is ambiguous. Matches: ${matches
          .slice(0, 4)
          .map((habit) => habit.name)
          .join(", ")}`
      };
    }
    target = matches[0]!;
  } else if (habits.length === 1) {
    target = habits[0]!;
  } else {
    return {
      error: "Provide habitId or habitName when multiple habits exist."
    };
  }

  const deleted = store.deleteHabit(target.id);
  if (!deleted) {
    return { error: "Unable to delete habit." };
  }

  return {
    success: true,
    deleted: true,
    habitId: target.id,
    habitName: target.name,
    message: `Deleted habit "${target.name}".`
  };
}

export function handleCreateGoal(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; goal: GoalWithStatus; created: boolean; message: string } | { error: string } {
  const title = asTrimmedString(args.title);
  if (!title) {
    return { error: "title is required." };
  }

  const existing = store
    .getGoalsWithStatus()
    .find((goal) => normalizeSearchText(goal.title) === normalizeSearchText(title));
  if (existing) {
    return {
      success: true,
      goal: existing,
      created: false,
      message: `Goal "${existing.title}" already exists.`
    };
  }

  const cadence = parseCadence(args.cadence, "weekly");
  const targetCount = clampNumber(args.targetCount, 1, 1, 365);
  const dueDateRaw = asTrimmedString(args.dueDate);
  const dueDate = dueDateRaw
    ? (() => {
        const parsed = new Date(dueDateRaw);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
      })()
    : null;
  if (dueDateRaw && dueDate === null) {
    return { error: "dueDate must be a valid ISO datetime when provided." };
  }
  const motivation = asTrimmedString(args.motivation) ?? undefined;

  const goal = store.createGoal({
    title,
    cadence,
    targetCount,
    dueDate,
    ...(motivation ? { motivation } : {})
  });

  return {
    success: true,
    goal,
    created: true,
    message: `Created goal "${goal.title}".`
  };
}

export function handleDeleteGoal(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): {
  success: true;
  deleted: boolean;
  goalId?: string;
  goalTitle?: string;
  message: string;
} | { error: string } {
  const goals = store.getGoalsWithStatus();
  if (goals.length === 0) {
    return {
      success: true,
      deleted: false,
      message: "No goals exist yet."
    };
  }

  const goalId = asTrimmedString(args.goalId);
  const goalTitle = asTrimmedString(args.goalTitle);
  let target: GoalWithStatus | null = null;

  if (goalId) {
    target = goals.find((goal) => goal.id === goalId) ?? null;
    if (!target) {
      return {
        success: true,
        deleted: false,
        message: `Goal not found: ${goalId}`
      };
    }
  } else if (goalTitle) {
    const needle = normalizeSearchText(goalTitle);
    const matches = goals.filter((goal) => normalizeSearchText(goal.title).includes(needle));
    if (matches.length === 0) {
      return {
        success: true,
        deleted: false,
        message: `No goal matched "${goalTitle}".`
      };
    }
    if (matches.length > 1) {
      return {
        error: `Goal title is ambiguous. Matches: ${matches
          .slice(0, 4)
          .map((goal) => goal.title)
          .join(", ")}`
      };
    }
    target = matches[0]!;
  } else if (goals.length === 1) {
    target = goals[0]!;
  } else {
    return {
      error: "Provide goalId or goalTitle when multiple goals exist."
    };
  }

  const deleted = store.deleteGoal(target.id);
  if (!deleted) {
    return { error: "Unable to delete goal." };
  }

  return {
    success: true,
    deleted: true,
    goalId: target.id,
    goalTitle: target.title,
    message: `Deleted goal "${target.title}".`
  };
}

export function handleGetNutritionSummary(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): NutritionDailySummary {
  const date = parseNutritionDate(args.date);
  return store.getNutritionDailySummary(date ?? new Date());
}

function resolveNutritionCustomFoodTarget(
  store: RuntimeStore,
  args: Record<string, unknown>
): NutritionCustomFood | { error: string } {
  const customFoodId = asTrimmedString(args.customFoodId);
  if (customFoodId) {
    const byId = store.getNutritionCustomFoodById(customFoodId);
    if (!byId) {
      return { error: `Custom food not found: ${customFoodId}` };
    }
    return byId;
  }

  const customFoodName = asTrimmedString(args.customFoodName);
  const foods = store.getNutritionCustomFoods({ limit: 500 });
  if (foods.length === 0) {
    return { error: "No custom foods are configured yet." };
  }

  if (!customFoodName) {
    if (foods.length === 1) {
      return foods[0]!;
    }
    return { error: "Provide customFoodId or customFoodName when multiple custom foods exist." };
  }

  const needle = normalizeSearchText(customFoodName);
  const matches = foods.filter((food) => normalizeSearchText(food.name).includes(needle));
  if (matches.length === 0) {
    return { error: `No custom food matched "${customFoodName}".` };
  }
  if (matches.length > 1) {
    return {
      error: `Custom food name is ambiguous. Matches: ${matches
        .slice(0, 4)
        .map((food) => food.name)
        .join(", ")}`
    };
  }
  return matches[0]!;
}

export function handleGetNutritionCustomFoods(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { foods: NutritionCustomFood[]; total: number } {
  const query = asTrimmedString(args.query) ?? undefined;
  const limit = clampNumber(args.limit, 20, 1, 200);
  const foods = store.getNutritionCustomFoods({
    ...(query ? { query } : {}),
    limit
  });
  return {
    foods,
    total: foods.length
  };
}

export function handleCreateNutritionCustomFood(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; food: NutritionCustomFood; message: string } | { error: string } {
  const name = asTrimmedString(args.name);
  if (!name) {
    return { error: "name is required." };
  }

  if (typeof args.caloriesPerUnit !== "number") {
    return { error: "caloriesPerUnit is required." };
  }

  const food = store.createNutritionCustomFood({
    name,
    unitLabel: asTrimmedString(args.unitLabel) ?? "serving",
    caloriesPerUnit: clampFloat(args.caloriesPerUnit, 0, 0, 10000),
    proteinGramsPerUnit: clampFloat(args.proteinGramsPerUnit, 0, 0, 1000),
    carbsGramsPerUnit: clampFloat(args.carbsGramsPerUnit, 0, 0, 1500),
    fatGramsPerUnit: clampFloat(args.fatGramsPerUnit, 0, 0, 600)
  });

  return {
    success: true,
    food,
    message: `Created custom food "${food.name}".`
  };
}

export function handleUpdateNutritionCustomFood(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; food: NutritionCustomFood; message: string } | { error: string } {
  const resolved = resolveNutritionCustomFoodTarget(store, args);
  if ("error" in resolved) {
    return resolved;
  }

  const patch: Partial<Omit<NutritionCustomFood, "id" | "createdAt" | "updatedAt">> = {};
  const name = asTrimmedString(args.name);
  const unitLabel = asTrimmedString(args.unitLabel);
  if (name) {
    patch.name = name;
  }
  if (unitLabel) {
    patch.unitLabel = unitLabel;
  }
  if (typeof args.caloriesPerUnit === "number") {
    patch.caloriesPerUnit = clampFloat(args.caloriesPerUnit, 0, 0, 10000);
  }
  if (typeof args.proteinGramsPerUnit === "number") {
    patch.proteinGramsPerUnit = clampFloat(args.proteinGramsPerUnit, 0, 0, 1000);
  }
  if (typeof args.carbsGramsPerUnit === "number") {
    patch.carbsGramsPerUnit = clampFloat(args.carbsGramsPerUnit, 0, 0, 1500);
  }
  if (typeof args.fatGramsPerUnit === "number") {
    patch.fatGramsPerUnit = clampFloat(args.fatGramsPerUnit, 0, 0, 600);
  }

  if (Object.keys(patch).length === 0) {
    return {
      error:
        "Provide at least one field to update: name, unitLabel, caloriesPerUnit, proteinGramsPerUnit, carbsGramsPerUnit, or fatGramsPerUnit."
    };
  }

  const updated = store.updateNutritionCustomFood(resolved.id, patch);
  if (!updated) {
    return { error: "Unable to update custom food." };
  }

  return {
    success: true,
    food: updated,
    message: `Updated custom food "${updated.name}".`
  };
}

export function handleDeleteNutritionCustomFood(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
):
  | {
      success: true;
      deleted: boolean;
      customFoodId?: string;
      customFoodName?: string;
      message: string;
    }
  | { error: string } {
  const foods = store.getNutritionCustomFoods({ limit: 500 });
  if (foods.length === 0) {
    return {
      success: true,
      deleted: false,
      message: "No custom foods exist yet."
    };
  }

  const resolved = resolveNutritionCustomFoodTarget(store, args);
  if ("error" in resolved) {
    return resolved;
  }

  const deleted = store.deleteNutritionCustomFood(resolved.id);
  if (!deleted) {
    return { error: "Unable to delete custom food." };
  }

  return {
    success: true,
    deleted: true,
    customFoodId: resolved.id,
    customFoodName: resolved.name,
    message: `Deleted custom food "${resolved.name}".`
  };
}

export function handleLogMeal(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; meal: NutritionMeal; message: string } | { error: string } {
  const customFoodId = asTrimmedString(args.customFoodId);
  const customFoodName = asTrimmedString(args.customFoodName);

  let mealName = asTrimmedString(args.name);
  let calories: number | null = typeof args.calories === "number" ? clampFloat(args.calories, 0, 0, 10000) : null;
  let proteinGrams: number = clampFloat(args.proteinGrams, 0, 0, 1000);
  let carbsGrams: number = clampFloat(args.carbsGrams, 0, 0, 1500);
  let fatGrams: number = clampFloat(args.fatGrams, 0, 0, 600);
  let customFoodMeta: NutritionCustomFood | null = null;
  const servings = typeof args.servings === "number" ? clampFloat(args.servings, 1, 0.1, 100) : 1;

  if (customFoodId || customFoodName) {
    const resolved = resolveNutritionCustomFoodTarget(store, { customFoodId, customFoodName });
    if ("error" in resolved) {
      return resolved;
    }

    customFoodMeta = resolved;
    mealName = mealName ?? resolved.name;
    calories = Math.round(resolved.caloriesPerUnit * servings * 10) / 10;
    proteinGrams = Math.round(resolved.proteinGramsPerUnit * servings * 10) / 10;
    carbsGrams = Math.round(resolved.carbsGramsPerUnit * servings * 10) / 10;
    fatGrams = Math.round(resolved.fatGramsPerUnit * servings * 10) / 10;
  }

  if (!mealName) {
    return { error: "name is required (or provide customFoodId/customFoodName)." };
  }
  if (calories === null) {
    return { error: "calories is required (or provide customFoodId/customFoodName)." };
  }

  const note = asTrimmedString(args.notes);
  const autoNote = customFoodMeta ? `${servings} ${customFoodMeta.unitLabel}` : null;
  const mealItems =
    customFoodMeta !== null
      ? [
          {
            name: customFoodMeta.name,
            quantity: servings,
            unitLabel: customFoodMeta.unitLabel,
            caloriesPerUnit: customFoodMeta.caloriesPerUnit,
            proteinGramsPerUnit: customFoodMeta.proteinGramsPerUnit,
            carbsGramsPerUnit: customFoodMeta.carbsGramsPerUnit,
            fatGramsPerUnit: customFoodMeta.fatGramsPerUnit,
            customFoodId: customFoodMeta.id
          }
        ]
      : [
          {
            name: mealName,
            quantity: 1,
            unitLabel: "serving",
            caloriesPerUnit: calories,
            proteinGramsPerUnit: proteinGrams,
            carbsGramsPerUnit: carbsGrams,
            fatGramsPerUnit: fatGrams
          }
        ];

  const meal = store.createNutritionMeal({
    name: mealName,
    mealType: parseMealType(args.mealType),
    consumedAt: asTrimmedString(args.consumedAt) ?? new Date().toISOString(),
    items: mealItems,
    calories,
    proteinGrams,
    carbsGrams,
    fatGrams,
    ...((note ?? autoNote) ? { notes: note ?? autoNote ?? undefined } : {})
  });

  return {
    success: true,
    meal,
    message: customFoodMeta
      ? `Logged meal "${meal.name}" from custom food "${customFoodMeta.name}".`
      : `Logged meal "${meal.name}".`
  };
}

export function handleDeleteMeal(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
):
  | {
      success: true;
      deleted: boolean;
      mealId?: string;
      mealName?: string;
      message: string;
    }
  | { error: string } {
  const meals = store.getNutritionMeals({ limit: 500 });
  if (meals.length === 0) {
    return {
      success: true,
      deleted: false,
      message: "No meals have been logged yet."
    };
  }

  const mealId = asTrimmedString(args.mealId);
  const mealName = asTrimmedString(args.mealName);
  let target: NutritionMeal | null = null;

  if (mealId) {
    target = meals.find((meal) => meal.id === mealId) ?? null;
    if (!target) {
      return {
        success: true,
        deleted: false,
        message: `Meal not found: ${mealId}`
      };
    }
  } else if (mealName) {
    const needle = normalizeSearchText(mealName);
    const matches = meals.filter((meal) => normalizeSearchText(meal.name).includes(needle));
    if (matches.length === 0) {
      return {
        success: true,
        deleted: false,
        message: `No meal matched "${mealName}".`
      };
    }
    if (matches.length > 1) {
      return {
        error: `Meal name is ambiguous. Matches: ${matches
          .slice(0, 4)
          .map((meal) => meal.name)
          .join(", ")}`
      };
    }
    target = matches[0]!;
  } else if (meals.length === 1) {
    target = meals[0]!;
  } else {
    return {
      error: "Provide mealId or mealName when multiple meal logs exist."
    };
  }

  const deleted = store.deleteNutritionMeal(target.id);
  if (!deleted) {
    return { error: "Unable to delete meal." };
  }

  return {
    success: true,
    deleted: true,
    mealId: target.id,
    mealName: target.name,
    message: `Deleted meal "${target.name}".`
  };
}

export function handleGetMealPlan(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { blocks: NutritionMealPlanBlock[]; total: number } {
  const date = parseNutritionDate(args.date) ?? undefined;
  const limit = clampNumber(args.limit, 20, 1, 100);
  const blocks = store.getNutritionMealPlanBlocks({
    ...(date ? { date } : {}),
    limit
  });

  return {
    blocks,
    total: blocks.length
  };
}

export function handleUpsertMealPlanBlock(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; block: NutritionMealPlanBlock; created: boolean; message: string } | { error: string } {
  const blockId = asTrimmedString(args.blockId);
  const existing = blockId ? store.getNutritionMealPlanBlockById(blockId) : null;
  const title = asTrimmedString(args.title) ?? existing?.title;
  const scheduledFor = asTrimmedString(args.scheduledFor) ?? existing?.scheduledFor;

  if (!title || !scheduledFor) {
    return { error: "title and scheduledFor are required." };
  }

  const block = store.upsertNutritionMealPlanBlock({
    ...(blockId ? { id: blockId } : {}),
    title,
    scheduledFor,
    ...(typeof args.targetCalories === "number"
      ? { targetCalories: clampFloat(args.targetCalories, 0, 0, 10000) }
      : existing?.targetCalories !== undefined
        ? { targetCalories: existing.targetCalories }
        : {}),
    ...(typeof args.targetProteinGrams === "number"
      ? { targetProteinGrams: clampFloat(args.targetProteinGrams, 0, 0, 1000) }
      : existing?.targetProteinGrams !== undefined
        ? { targetProteinGrams: existing.targetProteinGrams }
        : {}),
    ...(typeof args.targetCarbsGrams === "number"
      ? { targetCarbsGrams: clampFloat(args.targetCarbsGrams, 0, 0, 1500) }
      : existing?.targetCarbsGrams !== undefined
        ? { targetCarbsGrams: existing.targetCarbsGrams }
        : {}),
    ...(typeof args.targetFatGrams === "number"
      ? { targetFatGrams: clampFloat(args.targetFatGrams, 0, 0, 600) }
      : existing?.targetFatGrams !== undefined
        ? { targetFatGrams: existing.targetFatGrams }
        : {}),
    ...(asTrimmedString(args.notes)
      ? { notes: asTrimmedString(args.notes)! }
      : existing?.notes
        ? { notes: existing.notes }
        : {})
  });

  return {
    success: true,
    block,
    created: !existing,
    message: `${existing ? "Updated" : "Created"} meal-plan block "${block.title}".`
  };
}

export function handleRemoveMealPlanBlock(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
):
  | {
      success: true;
      deleted: boolean;
      blockId?: string;
      blockTitle?: string;
      message: string;
    }
  | { error: string } {
  const blocks = store.getNutritionMealPlanBlocks({ limit: 500 });
  if (blocks.length === 0) {
    return {
      success: true,
      deleted: false,
      message: "No meal-plan blocks exist yet."
    };
  }

  const blockId = asTrimmedString(args.blockId);
  const blockTitle = asTrimmedString(args.blockTitle);
  let target: NutritionMealPlanBlock | null = null;

  if (blockId) {
    target = blocks.find((block) => block.id === blockId) ?? null;
    if (!target) {
      return {
        success: true,
        deleted: false,
        message: `Meal-plan block not found: ${blockId}`
      };
    }
  } else if (blockTitle) {
    const needle = normalizeSearchText(blockTitle);
    const matches = blocks.filter((block) => normalizeSearchText(block.title).includes(needle));
    if (matches.length === 0) {
      return {
        success: true,
        deleted: false,
        message: `No meal-plan block matched "${blockTitle}".`
      };
    }
    if (matches.length > 1) {
      return {
        error: `Meal-plan title is ambiguous. Matches: ${matches
          .slice(0, 4)
          .map((block) => block.title)
          .join(", ")}`
      };
    }
    target = matches[0]!;
  } else if (blocks.length === 1) {
    target = blocks[0]!;
  } else {
    return {
      error: "Provide blockId or blockTitle when multiple meal-plan blocks exist."
    };
  }

  const deleted = store.deleteNutritionMealPlanBlock(target.id);
  if (!deleted) {
    return { error: "Unable to remove meal-plan block." };
  }

  return {
    success: true,
    deleted: true,
    blockId: target.id,
    blockTitle: target.title,
    message: `Removed meal-plan block "${target.title}".`
  };
}

export interface PendingActionToolResponse {
  requiresConfirmation: true;
  pendingAction: ChatPendingAction;
  confirmationCommand: string;
  cancelCommand: string;
  message: string;
}

export interface PendingActionExecutionResult {
  actionId: string;
  actionType: ChatActionType;
  success: boolean;
  message: string;
  deadline?: Deadline;
  lecture?: LectureEvent;
  routinePreset?: RoutinePreset;
  journal?: JournalEntry;
  habit?: HabitWithStatus;
  goal?: GoalWithStatus;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.NaN;
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function clampFloat(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.NaN;
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  const clamped = Math.min(max, Math.max(min, parsed));
  return Math.round(clamped * 10) / 10;
}

function parseNutritionDate(value: unknown): string | null {
  const raw = asTrimmedString(value);
  if (!raw) {
    return null;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function parseMealType(value: unknown): NutritionMealType {
  const raw = asTrimmedString(value)?.toLowerCase();
  if (raw === "breakfast" || raw === "lunch" || raw === "dinner" || raw === "snack" || raw === "other") {
    return raw;
  }
  return "other";
}

function normalizeSearchTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreGitHubCourseDocument(doc: GitHubCourseDocument, queryTokens: string[]): number {
  if (queryTokens.length === 0) {
    return 1;
  }

  const title = doc.title.toLowerCase();
  const summary = doc.summary.toLowerCase();
  const snippet = doc.snippet.toLowerCase();
  const path = doc.path.toLowerCase();
  const repo = `${doc.owner}/${doc.repo}`.toLowerCase();
  const highlights = doc.highlights.join(" ").toLowerCase();

  let score = 0;
  queryTokens.forEach((token) => {
    if (title.includes(token)) score += 6;
    if (summary.includes(token)) score += 5;
    if (snippet.includes(token)) score += 4;
    if (highlights.includes(token)) score += 3;
    if (path.includes(token)) score += 2;
    if (repo.includes(token)) score += 2;
    if (doc.courseCode.toLowerCase().includes(token)) score += 3;
  });

  return score;
}

export function handleGetGitHubCourseContent(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): GitHubCourseDocument[] {
  const githubData = store.getGitHubCourseData();
  if (!githubData || githubData.documents.length === 0) {
    return [];
  }

  const requestedCourseCode = asTrimmedString(args.courseCode)?.toUpperCase();
  const query = asTrimmedString(args.query);
  const limit = clampNumber(args.limit, 5, 1, 10);
  const queryTokens = query ? normalizeSearchTokens(query) : [];

  const filteredByCourse = githubData.documents.filter((doc) => {
    if (!requestedCourseCode) {
      return true;
    }
    return doc.courseCode.toUpperCase().includes(requestedCourseCode);
  });

  const scored = filteredByCourse
    .map((doc) => ({
      doc,
      score: scoreGitHubCourseDocument(doc, queryTokens)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return new Date(right.doc.syncedAt).getTime() - new Date(left.doc.syncedAt).getTime();
    })
    .map((item) => item.doc);

  return scored.slice(0, limit);
}

function toPendingActionResponse(action: ChatPendingAction, message: string): PendingActionToolResponse {
  return {
    requiresConfirmation: true,
    pendingAction: action,
    confirmationCommand: `confirm ${action.id}`,
    cancelCommand: `cancel ${action.id}`,
    message
  };
}

export function handleQueueDeadlineAction(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): PendingActionToolResponse | { error: string } {
  const deadlineId = asTrimmedString(args.deadlineId);
  const action = asTrimmedString(args.action)?.toLowerCase();

  if (!deadlineId || !action) {
    return { error: "deadlineId and action are required." };
  }

  const deadline = store.getDeadlineById(deadlineId, false);
  if (!deadline) {
    return { error: `Deadline not found: ${deadlineId}` };
  }

  if (action !== "complete" && action !== "snooze") {
    return { error: "Unsupported deadline action. Use complete or snooze." };
  }

  if (action === "complete") {
    const pending = store.createPendingChatAction({
      actionType: "complete-deadline",
      summary: `Mark ${deadline.course} ${deadline.task} as completed`,
      payload: {
        deadlineId: deadline.id
      }
    });

    return toPendingActionResponse(pending, "Action queued. Ask user for explicit confirmation before executing.");
  }

  const snoozeHours = clampNumber(args.snoozeHours, 24, 1, 168);
  const pending = store.createPendingChatAction({
    actionType: "snooze-deadline",
    summary: `Snooze ${deadline.course} ${deadline.task} by ${snoozeHours} hours`,
    payload: {
      deadlineId: deadline.id,
      snoozeHours
    }
  });

  return toPendingActionResponse(pending, "Action queued. Ask user for explicit confirmation before executing.");
}

export function handleQueueScheduleBlock(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): PendingActionToolResponse | { error: string } {
  const title = asTrimmedString(args.title);
  const startTime = asTrimmedString(args.startTime);
  const workloadRaw = asTrimmedString(args.workload)?.toLowerCase();
  const durationMinutes = clampNumber(args.durationMinutes, 60, 15, 240);

  if (!title || !startTime) {
    return { error: "title and startTime are required." };
  }

  const startDate = new Date(startTime);
  if (Number.isNaN(startDate.getTime())) {
    return { error: "startTime must be a valid ISO datetime." };
  }

  const workload: LectureEvent["workload"] =
    workloadRaw === "low" || workloadRaw === "medium" || workloadRaw === "high" ? workloadRaw : "medium";

  const pending = store.createPendingChatAction({
    actionType: "create-schedule-block",
    summary: `Create schedule block "${title}" at ${startDate.toISOString()} (${durationMinutes} min)`,
    payload: {
      title,
      startTime: startDate.toISOString(),
      durationMinutes,
      workload
    }
  });

  return toPendingActionResponse(pending, "Action queued. Ask user for explicit confirmation before executing.");
}

export function handleQueueUpdateScheduleBlock(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): PendingActionToolResponse | { error: string } {
  const resolved = resolveScheduleTarget(store, args);
  if ("error" in resolved) {
    return resolved;
  }

  const nextTitle = asTrimmedString(args.title);
  const nextStartTime = asTrimmedString(args.startTime);
  const nextDurationMinutes = typeof args.durationMinutes === "number"
    ? clampNumber(args.durationMinutes, resolved.durationMinutes, 15, 240)
    : undefined;
  const workloadRaw = asTrimmedString(args.workload)?.toLowerCase();
  const nextWorkload: LectureEvent["workload"] | undefined =
    workloadRaw === "low" || workloadRaw === "medium" || workloadRaw === "high" ? workloadRaw : undefined;

  let normalizedStartTime: string | undefined;
  if (nextStartTime) {
    const startDate = new Date(nextStartTime);
    if (Number.isNaN(startDate.getTime())) {
      return { error: "startTime must be a valid ISO datetime." };
    }
    normalizedStartTime = startDate.toISOString();
  }

  if (!nextTitle && !normalizedStartTime && !nextDurationMinutes && !nextWorkload) {
    return {
      error: "Provide at least one field to update: title, startTime, durationMinutes, or workload."
    };
  }

  const pending = store.createPendingChatAction({
    actionType: "update-schedule-block",
    summary: `Update schedule block "${resolved.title}"`,
    payload: {
      scheduleId: resolved.id,
      ...(nextTitle ? { title: nextTitle } : {}),
      ...(normalizedStartTime ? { startTime: normalizedStartTime } : {}),
      ...(nextDurationMinutes ? { durationMinutes: nextDurationMinutes } : {}),
      ...(nextWorkload ? { workload: nextWorkload } : {})
    }
  });

  return toPendingActionResponse(pending, "Action queued. Ask user for explicit confirmation before executing.");
}

export function handleQueueCreateRoutinePreset(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): PendingActionToolResponse | { error: string } {
  const title = asTrimmedString(args.title);
  const preferredStartTime = parseRoutinePreferredStartTime(args.preferredStartTime);
  const durationMinutes = clampNumber(args.durationMinutes, 60, 15, 240);
  const weekdays = parseRoutineWeekdays(args.weekdays) ?? [0, 1, 2, 3, 4, 5, 6];
  const workloadRaw = asTrimmedString(args.workload)?.toLowerCase();
  const workload: RoutinePreset["workload"] =
    workloadRaw === "low" || workloadRaw === "medium" || workloadRaw === "high" ? workloadRaw : "medium";

  if (!title || !preferredStartTime) {
    return { error: "title and preferredStartTime (HH:mm) are required." };
  }

  const pending = store.createPendingChatAction({
    actionType: "create-routine-preset",
    summary: `Create routine preset "${title}" at ${preferredStartTime}`,
    payload: {
      title,
      preferredStartTime,
      durationMinutes,
      workload,
      weekdays,
      active: true
    }
  });

  return toPendingActionResponse(pending, "Action queued. Ask user for explicit confirmation before executing.");
}

export function handleQueueUpdateRoutinePreset(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): PendingActionToolResponse | { error: string } {
  const resolved = resolveRoutinePresetTarget(store, args);
  if ("error" in resolved) {
    return resolved;
  }

  const nextTitle = asTrimmedString(args.title);
  const nextPreferredStartTime = parseRoutinePreferredStartTime(args.preferredStartTime);
  const nextDurationMinutes = typeof args.durationMinutes === "number"
    ? clampNumber(args.durationMinutes, resolved.durationMinutes, 15, 240)
    : undefined;
  const nextWeekdays = parseRoutineWeekdays(args.weekdays) ?? undefined;
  const workloadRaw = asTrimmedString(args.workload)?.toLowerCase();
  const nextWorkload: RoutinePreset["workload"] | undefined =
    workloadRaw === "low" || workloadRaw === "medium" || workloadRaw === "high" ? workloadRaw : undefined;
  const nextActive = typeof args.active === "boolean" ? args.active : undefined;

  if (!nextTitle && !nextPreferredStartTime && !nextDurationMinutes && !nextWorkload && !nextWeekdays && typeof nextActive !== "boolean") {
    return {
      error: "Provide at least one field to update: title, preferredStartTime, durationMinutes, workload, weekdays, or active."
    };
  }

  const pending = store.createPendingChatAction({
    actionType: "update-routine-preset",
    summary: `Update routine preset "${resolved.title}"`,
    payload: {
      presetId: resolved.id,
      ...(nextTitle ? { title: nextTitle } : {}),
      ...(nextPreferredStartTime ? { preferredStartTime: nextPreferredStartTime } : {}),
      ...(typeof nextDurationMinutes === "number" ? { durationMinutes: nextDurationMinutes } : {}),
      ...(nextWorkload ? { workload: nextWorkload } : {}),
      ...(nextWeekdays ? { weekdays: nextWeekdays } : {}),
      ...(typeof nextActive === "boolean" ? { active: nextActive } : {})
    }
  });

  return toPendingActionResponse(pending, "Action queued. Ask user for explicit confirmation before executing.");
}

export function handleCreateJournalEntry(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; entry: JournalEntry; message: string } | { error: string } {
  const content = asTrimmedString(args.content);

  if (!content) {
    return { error: "content is required." };
  }

  const entry = store.recordJournalEntry(content);
  return {
    success: true,
    entry,
    message: "Journal entry saved."
  };
}

export function executePendingChatAction(
  pendingAction: ChatPendingAction,
  store: RuntimeStore
): PendingActionExecutionResult {
  switch (pendingAction.actionType) {
    case "complete-deadline": {
      const deadlineId = asTrimmedString(pendingAction.payload.deadlineId);
      if (!deadlineId) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Invalid deadline action payload."
        };
      }

      const updated = store.updateDeadline(deadlineId, { completed: true });
      if (!updated) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Deadline not found for completion."
        };
      }

      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message: `Marked ${updated.course} ${updated.task} as completed.`,
        deadline: updated
      };
    }
    case "snooze-deadline": {
      const deadlineId = asTrimmedString(pendingAction.payload.deadlineId);
      if (!deadlineId) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Invalid snooze action payload."
        };
      }

      const existing = store.getDeadlineById(deadlineId, false);
      if (!existing) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Deadline not found for snooze."
        };
      }

      const dueDate = new Date(existing.dueDate);
      if (Number.isNaN(dueDate.getTime())) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Deadline due date is invalid."
        };
      }

      const snoozeHours = clampNumber(pendingAction.payload.snoozeHours, 24, 1, 168);
      dueDate.setHours(dueDate.getHours() + snoozeHours);
      const updated = store.updateDeadline(deadlineId, { dueDate: dueDate.toISOString() });

      if (!updated) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Unable to snooze deadline."
        };
      }

      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message: `Snoozed ${updated.course} ${updated.task} by ${snoozeHours} hours.`,
        deadline: updated
      };
    }
    case "create-schedule-block": {
      const title = asTrimmedString(pendingAction.payload.title);
      const startTime = asTrimmedString(pendingAction.payload.startTime);
      if (!title || !startTime) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Invalid schedule block payload."
        };
      }

      const startDate = new Date(startTime);
      if (Number.isNaN(startDate.getTime())) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Schedule block start time is invalid."
        };
      }

      const durationMinutes = clampNumber(pendingAction.payload.durationMinutes, 60, 15, 240);
      const workloadRaw = asTrimmedString(pendingAction.payload.workload)?.toLowerCase();
      const workload: LectureEvent["workload"] =
        workloadRaw === "low" || workloadRaw === "medium" || workloadRaw === "high" ? workloadRaw : "medium";

      const lecture = store.createLectureEvent({
        title,
        startTime: startDate.toISOString(),
        durationMinutes,
        workload
      });

      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message: `Created schedule block "${lecture.title}".`,
        lecture
      };
    }
    case "update-schedule-block": {
      const scheduleId = asTrimmedString(pendingAction.payload.scheduleId);
      if (!scheduleId) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Invalid schedule update payload."
        };
      }

      const existing = store.getScheduleEventById(scheduleId);
      if (!existing) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Schedule block not found for update."
        };
      }

      const patch: Partial<Omit<LectureEvent, "id">> = {};

      const title = asTrimmedString(pendingAction.payload.title);
      if (title) {
        patch.title = title;
      }

      const startTime = asTrimmedString(pendingAction.payload.startTime);
      if (startTime) {
        const startDate = new Date(startTime);
        if (Number.isNaN(startDate.getTime())) {
          return {
            actionId: pendingAction.id,
            actionType: pendingAction.actionType,
            success: false,
            message: "Schedule block start time is invalid."
          };
        }
        patch.startTime = startDate.toISOString();
      }

      if (typeof pendingAction.payload.durationMinutes === "number") {
        patch.durationMinutes = clampNumber(pendingAction.payload.durationMinutes, existing.durationMinutes, 15, 240);
      }

      const workloadRaw = asTrimmedString(pendingAction.payload.workload)?.toLowerCase();
      if (workloadRaw === "low" || workloadRaw === "medium" || workloadRaw === "high") {
        patch.workload = workloadRaw;
      }

      if (Object.keys(patch).length === 0) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "No valid schedule update fields were provided."
        };
      }

      const lecture = store.updateScheduleEvent(scheduleId, patch);
      if (!lecture) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Unable to update schedule block."
        };
      }

      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message: `Updated schedule block "${lecture.title}".`,
        lecture
      };
    }
    case "create-routine-preset": {
      const title = asTrimmedString(pendingAction.payload.title);
      const preferredStartTime = parseRoutinePreferredStartTime(pendingAction.payload.preferredStartTime);
      if (!title || !preferredStartTime) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Invalid routine preset payload."
        };
      }

      const durationMinutes = clampNumber(pendingAction.payload.durationMinutes, 60, 15, 240);
      const weekdays = parseRoutineWeekdays(pendingAction.payload.weekdays) ?? [0, 1, 2, 3, 4, 5, 6];
      const workloadRaw = asTrimmedString(pendingAction.payload.workload)?.toLowerCase();
      const workload: RoutinePreset["workload"] =
        workloadRaw === "low" || workloadRaw === "medium" || workloadRaw === "high" ? workloadRaw : "medium";
      const active = typeof pendingAction.payload.active === "boolean" ? pendingAction.payload.active : true;

      const routinePreset = store.createRoutinePreset({
        title,
        preferredStartTime,
        durationMinutes,
        workload,
        weekdays,
        active
      });
      const placement = applyRoutinePresetPlacements(store, { horizonDays: 7 });

      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message:
          `Created routine preset "${routinePreset.title}" and placed ${placement.createdEvents} routine blocks ` +
          `(cleared ${placement.clearedEvents}).`,
        routinePreset
      };
    }
    case "update-routine-preset": {
      const presetId = asTrimmedString(pendingAction.payload.presetId);
      if (!presetId) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Invalid routine preset update payload."
        };
      }

      const patch: Partial<Omit<RoutinePreset, "id" | "createdAt" | "updatedAt">> = {};
      const title = asTrimmedString(pendingAction.payload.title);
      if (title) {
        patch.title = title;
      }

      const preferredStartTime = parseRoutinePreferredStartTime(pendingAction.payload.preferredStartTime);
      if (preferredStartTime) {
        patch.preferredStartTime = preferredStartTime;
      }

      if (typeof pendingAction.payload.durationMinutes === "number") {
        patch.durationMinutes = clampNumber(pendingAction.payload.durationMinutes, 60, 15, 240);
      }

      const weekdays = parseRoutineWeekdays(pendingAction.payload.weekdays);
      if (weekdays) {
        patch.weekdays = weekdays;
      }

      const workloadRaw = asTrimmedString(pendingAction.payload.workload)?.toLowerCase();
      if (workloadRaw === "low" || workloadRaw === "medium" || workloadRaw === "high") {
        patch.workload = workloadRaw;
      }

      if (typeof pendingAction.payload.active === "boolean") {
        patch.active = pendingAction.payload.active;
      }

      if (Object.keys(patch).length === 0) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "No valid routine preset update fields were provided."
        };
      }

      const routinePreset = store.updateRoutinePreset(presetId, patch);
      if (!routinePreset) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Routine preset not found for update."
        };
      }

      const placement = applyRoutinePresetPlacements(store, { horizonDays: 7 });
      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message:
          `Updated routine preset "${routinePreset.title}" and placed ${placement.createdEvents} routine blocks ` +
          `(cleared ${placement.clearedEvents}).`,
        routinePreset
      };
    }
    case "create-journal-draft": {
      const content = asTrimmedString(pendingAction.payload.content);
      if (!content) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Journal draft content is missing."
        };
      }

      const journal = store.recordJournalEntry(content);
      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message: "Saved journal draft entry.",
        journal
      };
    }
    case "create-habit": {
      const name = asTrimmedString(pendingAction.payload.name);
      if (!name) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Habit name is missing."
        };
      }

      const cadenceRaw = asTrimmedString(pendingAction.payload.cadence)?.toLowerCase();
      const cadence = cadenceRaw === "weekly" ? "weekly" : "daily";
      const targetPerWeek = clampNumber(
        pendingAction.payload.targetPerWeek,
        cadence === "daily" ? 5 : 3,
        1,
        7
      );
      const motivation = asTrimmedString(pendingAction.payload.motivation);

      const existingHabit = store
        .getHabitsWithStatus()
        .find((habit) => habit.name.trim().toLowerCase() === name.trim().toLowerCase());

      if (existingHabit) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: true,
          message: `Habit "${existingHabit.name}" already exists.`,
          habit: existingHabit
        };
      }

      const habit = store.createHabit({
        name,
        cadence,
        targetPerWeek,
        ...(motivation ? { motivation } : {})
      });

      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message: `Created habit "${habit.name}".`,
        habit
      };
    }
    case "update-habit": {
      const habitId = asTrimmedString(pendingAction.payload.habitId);
      if (!habitId) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Habit ID is missing for update."
        };
      }

      const patch: Parameters<RuntimeStore["updateHabit"]>[1] = {};
      const name = asTrimmedString(pendingAction.payload.name);
      if (name) {
        patch.name = name;
      }

      const cadenceRaw = asTrimmedString(pendingAction.payload.cadence)?.toLowerCase();
      if (cadenceRaw === "daily" || cadenceRaw === "weekly") {
        patch.cadence = cadenceRaw;
      }

      if (typeof pendingAction.payload.targetPerWeek === "number") {
        patch.targetPerWeek = clampNumber(pendingAction.payload.targetPerWeek, 5, 1, 7);
      }

      if (Object.prototype.hasOwnProperty.call(pendingAction.payload, "motivation")) {
        patch.motivation = asTrimmedString(pendingAction.payload.motivation) ?? undefined;
      }

      if (Object.keys(patch).length === 0) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "No valid habit update fields were provided."
        };
      }

      const habit = store.updateHabit(habitId, patch);
      if (!habit) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Habit not found for update."
        };
      }

      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message: `Updated habit "${habit.name}".`,
        habit
      };
    }
    case "create-goal": {
      const title = asTrimmedString(pendingAction.payload.title);
      if (!title) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Goal title is missing."
        };
      }

      const cadenceRaw = asTrimmedString(pendingAction.payload.cadence)?.toLowerCase();
      const cadence = cadenceRaw === "daily" ? "daily" : "weekly";
      const targetCount = clampNumber(pendingAction.payload.targetCount, cadence === "daily" ? 7 : 5, 1, 50);
      const dueDateRaw = asTrimmedString(pendingAction.payload.dueDate);
      const motivation = asTrimmedString(pendingAction.payload.motivation);

      let dueDate: string | null = null;
      if (dueDateRaw) {
        const parsedDueDate = new Date(dueDateRaw);
        if (Number.isNaN(parsedDueDate.getTime())) {
          return {
            actionId: pendingAction.id,
            actionType: pendingAction.actionType,
            success: false,
            message: "Goal due date is invalid."
          };
        }
        dueDate = parsedDueDate.toISOString();
      }

      const existingGoal = store
        .getGoalsWithStatus()
        .find((goal) => goal.title.trim().toLowerCase() === title.trim().toLowerCase());

      if (existingGoal) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: true,
          message: `Goal "${existingGoal.title}" already exists.`,
          goal: existingGoal
        };
      }

      const goal = store.createGoal({
        title,
        cadence,
        targetCount,
        dueDate,
        ...(motivation ? { motivation } : {})
      });

      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message: `Created goal "${goal.title}".`,
        goal
      };
    }
    case "update-goal": {
      const goalId = asTrimmedString(pendingAction.payload.goalId);
      if (!goalId) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Goal ID is missing for update."
        };
      }

      const patch: Parameters<RuntimeStore["updateGoal"]>[1] = {};
      const title = asTrimmedString(pendingAction.payload.title);
      if (title) {
        patch.title = title;
      }

      const cadenceRaw = asTrimmedString(pendingAction.payload.cadence)?.toLowerCase();
      if (cadenceRaw === "daily" || cadenceRaw === "weekly") {
        patch.cadence = cadenceRaw;
      }

      if (typeof pendingAction.payload.targetCount === "number") {
        patch.targetCount = clampNumber(pendingAction.payload.targetCount, 5, 1, 50);
      }

      if (Object.prototype.hasOwnProperty.call(pendingAction.payload, "motivation")) {
        patch.motivation = asTrimmedString(pendingAction.payload.motivation) ?? undefined;
      }

      if (Object.prototype.hasOwnProperty.call(pendingAction.payload, "dueDate")) {
        if (pendingAction.payload.dueDate === null) {
          patch.dueDate = null;
        } else {
          const dueDateRaw = asTrimmedString(pendingAction.payload.dueDate);
          if (dueDateRaw) {
            const parsedDueDate = new Date(dueDateRaw);
            if (Number.isNaN(parsedDueDate.getTime())) {
              return {
                actionId: pendingAction.id,
                actionType: pendingAction.actionType,
                success: false,
                message: "Goal due date is invalid."
              };
            }
            patch.dueDate = parsedDueDate.toISOString();
          }
        }
      }

      if (Object.keys(patch).length === 0) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "No valid goal update fields were provided."
        };
      }

      const goal = store.updateGoal(goalId, patch);
      if (!goal) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Goal not found for update."
        };
      }

      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message: `Updated goal "${goal.title}".`,
        goal
      };
    }
    default:
      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: false,
        message: "Unsupported pending action type."
      };
  }
}

/**
 * Execute a function call by name with provided arguments.
 */
export function executeFunctionCall(
  name: string,
  args: Record<string, unknown>,
  store: RuntimeStore
): FunctionCallResult {
  let response: unknown;

  switch (name) {
    case "getSchedule":
      response = handleGetSchedule(store, args);
      break;
    case "getRoutinePresets":
      response = handleGetRoutinePresets(store, args);
      break;
    case "getDeadlines":
      response = handleGetDeadlines(store, args);
      break;
    case "searchJournal":
      response = handleSearchJournal(store, args);
      break;
    case "getEmails":
      response = handleGetEmails(store, args);
      break;
    case "getSocialDigest":
      response = handleGetSocialDigest(store, args);
      break;
    case "getHabitsGoalsStatus":
      response = handleGetHabitsGoalsStatus(store);
      break;
    case "updateHabitCheckIn":
      response = handleUpdateHabitCheckIn(store, args);
      break;
    case "updateGoalCheckIn":
      response = handleUpdateGoalCheckIn(store, args);
      break;
    case "createHabit":
      response = handleCreateHabit(store, args);
      break;
    case "deleteHabit":
      response = handleDeleteHabit(store, args);
      break;
    case "createGoal":
      response = handleCreateGoal(store, args);
      break;
    case "deleteGoal":
      response = handleDeleteGoal(store, args);
      break;
    case "getNutritionSummary":
      response = handleGetNutritionSummary(store, args);
      break;
    case "getNutritionCustomFoods":
      response = handleGetNutritionCustomFoods(store, args);
      break;
    case "createNutritionCustomFood":
      response = handleCreateNutritionCustomFood(store, args);
      break;
    case "updateNutritionCustomFood":
      response = handleUpdateNutritionCustomFood(store, args);
      break;
    case "deleteNutritionCustomFood":
      response = handleDeleteNutritionCustomFood(store, args);
      break;
    case "logMeal":
      response = handleLogMeal(store, args);
      break;
    case "deleteMeal":
      response = handleDeleteMeal(store, args);
      break;
    case "getMealPlan":
      response = handleGetMealPlan(store, args);
      break;
    case "upsertMealPlanBlock":
      response = handleUpsertMealPlanBlock(store, args);
      break;
    case "removeMealPlanBlock":
      response = handleRemoveMealPlanBlock(store, args);
      break;
    case "getGitHubCourseContent":
      response = handleGetGitHubCourseContent(store, args);
      break;
    case "queueDeadlineAction":
      response = handleQueueDeadlineAction(store, args);
      break;
    case "queueScheduleBlock":
      response = handleQueueScheduleBlock(store, args);
      break;
    case "queueUpdateScheduleBlock":
      response = handleQueueUpdateScheduleBlock(store, args);
      break;
    case "queueCreateRoutinePreset":
      response = handleQueueCreateRoutinePreset(store, args);
      break;
    case "queueUpdateRoutinePreset":
      response = handleQueueUpdateRoutinePreset(store, args);
      break;
    case "createJournalEntry":
      response = handleCreateJournalEntry(store, args);
      break;
    default:
      throw new Error(`Unknown function: ${name}`);
  }

  return { name, response };
}
