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
  LectureEvent,
  RoutinePreset,
  NutritionDailySummary,
  NutritionDayHistoryEntry,
  NutritionCustomFood,
  NutritionMeal,
  NutritionPlanSnapshot,
  NutritionMealType,
  WithingsSleepSummaryEntry,
  WithingsWeightEntry
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
      "Get schedule events for a date window. Returns lectures and planned blocks with times, durations, and course names. Use this for today's schedule, future planning, and free-time questions.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        date: {
          type: SchemaType.STRING,
          description: "Optional anchor date/time (ISO or natural time like 'tomorrow 09:00'). Defaults to today."
        },
        daysAhead: {
          type: SchemaType.NUMBER,
          description: "Number of days in the window starting from date (default: 1, max: 30)."
        },
        includeSuggestions: {
          type: SchemaType.BOOLEAN,
          description: "When true, include timeline suggestions for today's window (default: true)."
        }
      },
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
    name: "getWithingsHealthSummary",
    description:
      "Get recent Withings body/sleep metrics synced from the user's smart scale and sleep data. Returns latest weight trend and sleep summaries for a date window.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        daysBack: {
          type: SchemaType.NUMBER,
          description: "Number of days to include (default: 14, max: 90)."
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
      "Get a daily nutrition summary with calories and macro totals (protein/carbs/fat), plus logged meals.",
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
    name: "getNutritionHistory",
    description:
      "Get multi-day nutrition history with daily totals, targets, and weight data. Use this to analyze trends, compare actual intake vs targets over time, and correlate nutrition with weight changes. Returns an array of daily entries.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        from: {
          type: SchemaType.STRING,
          description: "Start date in YYYY-MM-DD format. If omitted, defaults to (days) before 'to'."
        },
        to: {
          type: SchemaType.STRING,
          description: "End date in YYYY-MM-DD format. Defaults to today."
        },
        days: {
          type: SchemaType.NUMBER,
          description: "Number of days to look back from 'to' (default: 7, max: 90). Ignored when both from/to are set."
        }
      },
      required: []
    }
  },
  {
    name: "getNutritionTargets",
    description:
      "Get nutrition target profile for a specific date (weight, maintenance, surplus, and target macros/calories).",
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
    name: "updateNutritionTargets",
    description:
      "Create or update nutrition target profile values for a date (weight, maintenance, surplus, and/or target macros).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        date: {
          type: SchemaType.STRING,
          description: "Optional date in YYYY-MM-DD format. Defaults to today."
        },
        weightKg: {
          type: SchemaType.NUMBER,
          description: "Body weight in kg (set null to clear)."
        },
        maintenanceCalories: {
          type: SchemaType.NUMBER,
          description: "Maintenance calories (set null to clear)."
        },
        surplusCalories: {
          type: SchemaType.NUMBER,
          description: "Calorie surplus/deficit (set null to clear)."
        },
        targetCalories: {
          type: SchemaType.NUMBER,
          description: "Explicit calorie target (set null to clear)."
        },
        targetProteinGrams: {
          type: SchemaType.NUMBER,
          description: "Explicit protein target in grams (set null to clear)."
        },
        targetCarbsGrams: {
          type: SchemaType.NUMBER,
          description: "Explicit carb target in grams (set null to clear)."
        },
        targetFatGrams: {
          type: SchemaType.NUMBER,
          description: "Explicit fat target in grams (set null to clear)."
        }
      },
      required: []
    }
  },
  {
    name: "getNutritionMeals",
    description:
      "Get logged meals with meal items for a date or date-time range.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        date: {
          type: SchemaType.STRING,
          description: "Optional date in YYYY-MM-DD format."
        },
        from: {
          type: SchemaType.STRING,
          description: "Optional range start as ISO datetime."
        },
        to: {
          type: SchemaType.STRING,
          description: "Optional range end as ISO datetime."
        },
        limit: {
          type: SchemaType.NUMBER,
          description: "Maximum number of meals to return (default: 30, max: 500)."
        }
      },
      required: []
    }
  },
  {
    name: "getNutritionPlanSnapshots",
    description:
      "List saved nutrition meal-plan snapshots (reusable day templates) that can be loaded later.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: "Optional snapshot name filter."
        },
        limit: {
          type: SchemaType.NUMBER,
          description: "Maximum number of snapshots to return (default: 20, max: 200)."
        }
      },
      required: []
    }
  },
  {
    name: "saveNutritionPlanSnapshot",
    description:
      "Save a reusable nutrition meal-plan snapshot from a date's meals/targets so it can be loaded later. Fails if the source date has zero meals.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name: {
          type: SchemaType.STRING,
          description: "Snapshot name (for example 'FUCK MPB 😈')."
        },
        date: {
          type: SchemaType.STRING,
          description: "Optional source date in YYYY-MM-DD format. Defaults to today."
        },
        replaceSnapshotId: {
          type: SchemaType.STRING,
          description: "Optional existing snapshot ID to overwrite."
        }
      },
      required: []
    }
  },
  {
    name: "applyNutritionPlanSnapshot",
    description:
      "Load/apply a saved nutrition meal-plan snapshot to a date. By default, replace that day's existing meals and set it as the default baseline for upcoming days.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        snapshotId: {
          type: SchemaType.STRING,
          description: "Snapshot ID (preferred)."
        },
        snapshotName: {
          type: SchemaType.STRING,
          description: "Snapshot name hint when ID is unknown."
        },
        date: {
          type: SchemaType.STRING,
          description: "Target date in YYYY-MM-DD format. Defaults to today."
        },
        replaceMeals: {
          type: SchemaType.BOOLEAN,
          description: "Set true to replace existing meals on that day (default: true)."
        },
        setAsDefault: {
          type: SchemaType.BOOLEAN,
          description: "Set true to make this snapshot the default daily baseline (default: true)."
        }
      },
      required: []
    }
  },
  {
    name: "deleteNutritionPlanSnapshot",
    description:
      "Delete a saved nutrition meal-plan snapshot.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        snapshotId: {
          type: SchemaType.STRING,
          description: "Snapshot ID (preferred)."
        },
        snapshotName: {
          type: SchemaType.STRING,
          description: "Snapshot name hint when ID is unknown."
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
      "Create a reusable custom food with per-unit macros. Use 'g' for foods measured by weight, 'ml' for liquids, 'ea' for items counted by quantity (e.g. eggs). All macro values should be per single unit. IMPORTANT: always set unitLabel to match the source data — do NOT default everything to 'g'.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name: {
          type: SchemaType.STRING,
          description: "Custom food name."
        },
        unitLabel: {
          type: SchemaType.STRING,
          description: "REQUIRED. Measurement unit: 'g' (grams), 'ml' (millilitres), or 'ea' (each/quantity). Must match the unit used in the source meal plan or recipe exactly — do not guess or change the unit."
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
      required: ["name", "caloriesPerUnit", "unitLabel"]
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
          description: "Updated measurement unit: 'g' (grams), 'ml' (millilitres), or 'ea' (each/quantity)."
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
      "Log a simple/single-item meal with calories and macros (protein/carbs/fat). For image-based or mixed meals with multiple foods, prefer createNutritionMeal with a detailed items array.",
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
        quantity: {
          type: SchemaType.NUMBER,
          description:
            "Amount in grams for gram-based foods (required when custom food unit is grams)."
        },
        estimatedWeightGrams: {
          type: SchemaType.NUMBER,
          description:
            "Estimated meal weight in grams for image-based meal logging."
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
    name: "createNutritionMeal",
    description:
      "Create a meal entry with optional item list and macros. Preferred for image-based and mixed meals; include one item per recognizable food component with realistic grams.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name: {
          type: SchemaType.STRING,
          description: "Meal name."
        },
        mealType: {
          type: SchemaType.STRING,
          description: "Meal type: breakfast, lunch, dinner, snack, other."
        },
        consumedAt: {
          type: SchemaType.STRING,
          description: "Optional consumed time (ISO or natural time like 'today 19:30'). Defaults to now."
        },
        notes: {
          type: SchemaType.STRING,
          description: "Optional note for the meal."
        },
        calories: {
          type: SchemaType.NUMBER,
          description: "Optional total calories (required when no items are provided)."
        },
        proteinGrams: {
          type: SchemaType.NUMBER,
          description: "Optional total protein grams."
        },
        carbsGrams: {
          type: SchemaType.NUMBER,
          description: "Optional total carbs grams."
        },
        fatGrams: {
          type: SchemaType.NUMBER,
          description: "Optional total fat grams."
        },
        items: {
          type: SchemaType.ARRAY,
          description:
            "Optional meal items. Each item can reference a custom food via customFoodId/customFoodName and must include quantity. For image-estimated meals, split the dish into distinct food components and provide realistic grams per item (for example 220, 350).",
          items: {
            type: SchemaType.OBJECT,
            properties: {
              customFoodId: { type: SchemaType.STRING },
              customFoodName: { type: SchemaType.STRING },
              quantity: { type: SchemaType.NUMBER, description: "Food amount in grams." },
              name: { type: SchemaType.STRING },
              unitLabel: { type: SchemaType.STRING },
              caloriesPerUnit: { type: SchemaType.NUMBER },
              proteinGramsPerUnit: { type: SchemaType.NUMBER },
              carbsGramsPerUnit: { type: SchemaType.NUMBER },
              fatGramsPerUnit: { type: SchemaType.NUMBER }
            }
          }
        }
      },
      required: ["name"]
    }
  },
  {
    name: "updateNutritionMeal",
    description:
      "Update meal metadata and status (name, type, consumedAt, notes, completed, and optional macro totals).",
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
        },
        name: {
          type: SchemaType.STRING,
          description: "Updated meal name."
        },
        mealType: {
          type: SchemaType.STRING,
          description: "Updated meal type: breakfast, lunch, dinner, snack, other."
        },
        consumedAt: {
          type: SchemaType.STRING,
          description: "Updated consumed time (ISO or natural time)."
        },
        notes: {
          type: SchemaType.STRING,
          description: "Updated notes text (empty clears notes)."
        },
        completed: {
          type: SchemaType.BOOLEAN,
          description: "Mark meal as eaten (true) or not eaten (false)."
        },
        calories: {
          type: SchemaType.NUMBER,
          description: "Optional total calories override."
        },
        proteinGrams: {
          type: SchemaType.NUMBER,
          description: "Optional total protein grams override."
        },
        carbsGrams: {
          type: SchemaType.NUMBER,
          description: "Optional total carb grams override."
        },
        fatGrams: {
          type: SchemaType.NUMBER,
          description: "Optional total fat grams override."
        }
      },
      required: []
    }
  },
  {
    name: "addNutritionMealItem",
    description:
      "Add a custom food item to an existing meal.",
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
        },
        customFoodId: {
          type: SchemaType.STRING,
          description: "Custom food ID (preferred)."
        },
        customFoodName: {
          type: SchemaType.STRING,
          description: "Custom food name hint when ID is unknown."
        },
        quantity: {
          type: SchemaType.NUMBER,
          description: "Amount in grams (default: 100)."
        }
      },
      required: []
    }
  },
  {
    name: "updateNutritionMealItem",
    description:
      "Update a meal item amount by setting quantity (grams) or applying a delta in grams.",
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
        },
        itemId: {
          type: SchemaType.STRING,
          description: "Meal item ID (preferred)."
        },
        itemName: {
          type: SchemaType.STRING,
          description: "Meal item name hint when ID is unknown."
        },
        quantity: {
          type: SchemaType.NUMBER,
          description: "New absolute quantity in grams."
        },
        delta: {
          type: SchemaType.NUMBER,
          description: "Relative quantity adjustment in grams (for example +1 or -1)."
        }
      },
      required: []
    }
  },
  {
    name: "removeNutritionMealItem",
    description:
      "Remove one item from a meal.",
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
        },
        itemId: {
          type: SchemaType.STRING,
          description: "Meal item ID (preferred)."
        },
        itemName: {
          type: SchemaType.STRING,
          description: "Meal item name hint when ID is unknown."
        }
      },
      required: []
    }
  },
  {
    name: "moveNutritionMeal",
    description:
      "Move meal ordering up or down within a day.",
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
        },
        direction: {
          type: SchemaType.STRING,
          description: "Direction: up or down."
        },
        date: {
          type: SchemaType.STRING,
          description: "Optional day key YYYY-MM-DD to constrain ordering window."
        }
      },
      required: []
    }
  },
  {
    name: "setNutritionMealOrder",
    description:
      "Set exact top-to-bottom meal order for a day in one call using ordered meal names. Unspecified meals are appended in their current order.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        date: {
          type: SchemaType.STRING,
          description: "Optional day key YYYY-MM-DD. Defaults to today."
        },
        orderedMealNames: {
          type: SchemaType.ARRAY,
          description: "Desired meal names in display order (first name appears at the top).",
          items: {
            type: SchemaType.STRING
          }
        }
      },
      required: ["orderedMealNames"]
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
      "Modify a deadline immediately by action. Supports complete and snooze without extra confirmation.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        deadlineId: {
          type: SchemaType.STRING,
          description: "Deadline ID to modify"
        },
        action: {
          type: SchemaType.STRING,
          description: "Action: complete or snooze"
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
    name: "createScheduleBlock",
    description:
      "Create a schedule block immediately. Use this when the user asks to add or plan something on their schedule.",
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
    name: "updateScheduleBlock",
    description:
      "Update an existing schedule block immediately.",
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
    name: "deleteScheduleBlock",
    description:
      "Delete one schedule block immediately.",
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
        }
      },
      required: []
    }
  },
  {
    name: "clearScheduleWindow",
    description:
      "Clear schedule blocks and timeline suggestions in a time window (for example freeing up the rest of today) immediately.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        startTime: {
          type: SchemaType.STRING,
          description: "Window start ISO datetime. Defaults to now."
        },
        endTime: {
          type: SchemaType.STRING,
          description: "Window end ISO datetime. Defaults to end of the same day."
        },
        titleQuery: {
          type: SchemaType.STRING,
          description: "Optional text filter matched against schedule block title."
        },
        includeAcademicBlocks: {
          type: SchemaType.BOOLEAN,
          description:
            "Set true to include lecture/lab/forelesning/undervisning blocks. Default false to protect core classes."
        }
      },
      required: []
    }
  },
  {
    name: "queueCreateRoutinePreset",
    description:
      "Create a reusable routine preset immediately and auto-place it in upcoming schedule gaps.",
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
      "Update an existing routine preset immediately and re-apply placements in upcoming schedule gaps.",
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
    name: "setResponseMood",
    description: "Set the emotional mood/tone for this response. Call this alongside other tools to reflect the appropriate emotional context. Only call when you are already invoking other tools — do not call on its own.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        mood: {
          type: SchemaType.STRING,
          description: "The mood that best fits the emotional tone of this interaction. One of: neutral, encouraging, focused, celebratory, empathetic, urgent."
        }
      },
      required: ["mood"]
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

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function parseFlexibleDateTime(value: string, referenceDate: Date = new Date()): Date | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const normalized = trimmed
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const relativeMatch = normalized.match(/^in\s+(\d+)\s*(minute|minutes|min|mins|hour|hours|hr|hrs|h)$/);
  if (relativeMatch) {
    const amount = Number.parseInt(relativeMatch[1] ?? "0", 10);
    const unit = relativeMatch[2] ?? "";
    if (amount > 0) {
      const deltaMinutes = unit.startsWith("h") ? amount * 60 : amount;
      return new Date(referenceDate.getTime() + deltaMinutes * 60 * 1000);
    }
  }

  const hasToday = /\btoday\b/.test(normalized);
  const hasTomorrow = /\btomorrow\b/.test(normalized);
  const timeMatch = normalized.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!timeMatch) {
    return null;
  }

  let hours = Number.parseInt(timeMatch[1] ?? "0", 10);
  const minutes = Number.parseInt(timeMatch[2] ?? "0", 10);
  const meridiem = timeMatch[3] ?? null;
  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes < 0 || minutes > 59) {
    return null;
  }

  if (meridiem) {
    if (hours < 1 || hours > 12) {
      return null;
    }
    if (meridiem === "pm" && hours !== 12) {
      hours += 12;
    }
    if (meridiem === "am" && hours === 12) {
      hours = 0;
    }
  } else if (hours < 0 || hours > 23) {
    return null;
  }

  const candidate = new Date(referenceDate);
  candidate.setSeconds(0, 0);
  if (hasTomorrow) {
    candidate.setDate(candidate.getDate() + 1);
  }
  candidate.setHours(hours, minutes, 0, 0);

  if (!hasToday && !hasTomorrow && candidate.getTime() < referenceDate.getTime() - 5 * 60 * 1000) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate;
}

function isPlannedSuggestionMuted(start: Date, end: Date, muteWindows: Array<{ startTime: string; endTime: string }>): boolean {
  return muteWindows.some((muteWindow) => {
    const muteStart = new Date(muteWindow.startTime);
    const muteEnd = new Date(muteWindow.endTime);
    if (Number.isNaN(muteStart.getTime()) || Number.isNaN(muteEnd.getTime())) {
      return false;
    }
    return start.getTime() < muteEnd.getTime() && end.getTime() > muteStart.getTime();
  });
}

function suggestGapActivity(
  gapStart: Date,
  gapDurationMinutes: number,
  deadlineSuggestions: string[],
  consumedDeadlineIndex: { value: number }
): string {
  const hour = gapStart.getHours();

  if (hour < 9) {
    return "Morning routine (gym, breakfast, planning)";
  }

  if (consumedDeadlineIndex.value < deadlineSuggestions.length) {
    const suggestion = deadlineSuggestions[consumedDeadlineIndex.value]!;
    consumedDeadlineIndex.value += 1;
    return suggestion;
  }

  if (gapDurationMinutes >= 90) {
    return "Focus block for assignments or revision";
  }

  return "Buffer, review notes, or take a short reset";
}

function buildTodayTimelineSuggestions(
  store: RuntimeStore,
  todaySchedule: LectureEvent[],
  now: Date
): LectureEvent[] {
  const sorted = [...todaySchedule].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const pendingDeadlines = store
    .getAcademicDeadlines(now)
    .filter((deadline) => !deadline.completed)
    .filter((deadline) => {
      const due = new Date(deadline.dueDate);
      if (Number.isNaN(due.getTime())) {
        return false;
      }
      const diffDays = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays >= -2 && diffDays <= 14;
    })
    .sort((left, right) => new Date(left.dueDate).getTime() - new Date(right.dueDate).getTime())
    .slice(0, 8)
    .map((deadline) => `${deadline.course} ${deadline.task}`);

  const firstStart = sorted.length > 0 ? new Date(sorted[0].startTime) : new Date(now);
  const timelineStart = new Date(now);
  timelineStart.setHours(Math.min(7, firstStart.getHours()), 0, 0, 0);

  const lastLecture = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const lastEnd = lastLecture
    ? new Date(new Date(lastLecture.startTime).getTime() + lastLecture.durationMinutes * 60000)
    : new Date(now);
  const timelineEnd = new Date(now);
  timelineEnd.setHours(Math.max(20, lastEnd.getHours() + 1), 0, 0, 0);

  const muteWindows = store.getScheduleSuggestionMutes({ day: now });
  const suggestions: LectureEvent[] = [];
  let cursor = timelineStart;
  let suggestionIndex = 0;
  const consumedDeadlineIndex = { value: 0 };

  const pushSuggestionsForGap = (gapStart: Date, gapEnd: Date): void => {
    let remaining = minutesBetween(gapStart, gapEnd);
    let blockStart = new Date(gapStart);

    while (remaining >= 25) {
      let blockMinutes: number;
      if (remaining >= 210) {
        blockMinutes = 90;
      } else if (remaining >= 140) {
        blockMinutes = 75;
      } else if (remaining >= 95) {
        blockMinutes = 60;
      } else if (remaining >= 70) {
        blockMinutes = 45;
      } else {
        blockMinutes = remaining;
      }

      const leftover = remaining - blockMinutes;
      if (leftover > 0 && leftover < 25) {
        blockMinutes = remaining;
      }

      const blockEnd = new Date(blockStart.getTime() + blockMinutes * 60000);
      if (!isPlannedSuggestionMuted(blockStart, blockEnd, muteWindows)) {
        const title = suggestGapActivity(blockStart, blockMinutes, pendingDeadlines, consumedDeadlineIndex);
        suggestions.push({
          id: `suggested-gap-${blockStart.getTime()}-${suggestionIndex}`,
          title,
          startTime: blockStart.toISOString(),
          durationMinutes: blockMinutes,
          workload: title.toLowerCase().includes("focus") ? "high" : "medium",
          recurrenceParentId: "timeline-suggested"
        });
        suggestionIndex += 1;
      }

      blockStart = blockEnd;
      remaining = minutesBetween(blockStart, gapEnd);
    }
  };

  sorted.forEach((event) => {
    const start = new Date(event.startTime);
    const end = new Date(start.getTime() + event.durationMinutes * 60000);
    if (minutesBetween(cursor, start) >= 25) {
      pushSuggestionsForGap(new Date(cursor), start);
    }
    cursor = end;
  });

  if (minutesBetween(cursor, timelineEnd) >= 25) {
    pushSuggestionsForGap(new Date(cursor), timelineEnd);
  }

  return suggestions;
}

export function handleGetSchedule(store: RuntimeStore, _args: Record<string, unknown> = {}): LectureEvent[] {
  const now = new Date();
  const args = _args;
  const requestedDate = asTrimmedString(args.date);
  const daysAhead = clampNumber(args.daysAhead, 1, 1, 30);
  const includeSuggestions = args.includeSuggestions !== false;

  const startOfUtcDay = (date: Date): Date =>
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));

  const parseRequestedWindowStart = (): Date | null => {
    if (!requestedDate) {
      return startOfUtcDay(now);
    }

    const dayOnly = requestedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dayOnly) {
      return new Date(`${requestedDate}T00:00:00.000Z`);
    }

    const parsed = parseFlexibleDateTime(requestedDate, now);
    if (!parsed) {
      return null;
    }
    return startOfUtcDay(parsed);
  };

  const windowStart = parseRequestedWindowStart();
  if (!windowStart) {
    return [];
  }
  const windowEnd = new Date(windowStart);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + daysAhead);

  const scheduleInWindow = store
    .getScheduleEvents()
    .filter((event) => {
      const eventStart = new Date(event.startTime).getTime();
      if (Number.isNaN(eventStart)) {
        return false;
      }
      return eventStart >= windowStart.getTime() && eventStart < windowEnd.getTime();
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const todayStart = startOfUtcDay(now).getTime();
  const isTodayWindow = daysAhead === 1 && windowStart.getTime() === todayStart;
  if (!includeSuggestions || !isTodayWindow) {
    return scheduleInWindow;
  }

  const timelineSuggestions = buildTodayTimelineSuggestions(store, scheduleInWindow, now);
  return [...scheduleInWindow, ...timelineSuggestions];
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
  const parseDueDate = (value: string): Date => {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return new Date(`${trimmed}T23:59:59.999Z`);
    }
    return new Date(trimmed);
  };

  const deadlines = store
    .getAcademicDeadlines(now)
    .filter((deadline) => (includeCompleted ? true : !deadline.completed))
    .filter((deadline) => {
      const due = parseDueDate(deadline.dueDate);
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

export function handleGetWithingsHealthSummary(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): {
  connected: boolean;
  lastSyncedAt: string | null;
  latestWeight: WithingsWeightEntry | null;
  latestSleep: WithingsSleepSummaryEntry | null;
  weight: WithingsWeightEntry[];
  sleepSummary: WithingsSleepSummaryEntry[];
} {
  const daysBack = clampNumber(args.daysBack, 14, 1, 90);
  const data = store.getWithingsData();
  const connected = store.getWithingsTokens() !== null;
  const cutoffMs = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  const weight = data.weight
    .filter((entry) => {
      const measuredMs = Date.parse(entry.measuredAt);
      return Number.isFinite(measuredMs) && measuredMs >= cutoffMs;
    })
    .sort((left, right) => Date.parse(right.measuredAt) - Date.parse(left.measuredAt))
    .slice(0, 60);

  const sleepSummary = data.sleepSummary
    .filter((entry) => {
      const dayMs = Date.parse(`${entry.date}T00:00:00.000Z`);
      return Number.isFinite(dayMs) && dayMs >= cutoffMs;
    })
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 60);

  return {
    connected,
    lastSyncedAt: data.lastSyncedAt,
    latestWeight: weight[0] ?? null,
    latestSleep: sleepSummary[0] ?? null,
    weight,
    sleepSummary
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
  const exactHabit = habits.find((habit) => normalizeSearchText(habit.name) === needle);
  if (exactHabit) {
    return exactHabit;
  }
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
  const exactGoal = goals.find((goal) => normalizeSearchText(goal.title) === needle);
  if (exactGoal) {
    return exactGoal;
  }
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
  const exactSchedule = schedule.find((event) => normalizeSearchText(event.title) === needle);
  if (exactSchedule) {
    return exactSchedule;
  }
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

function isAcademicScheduleBlockTitle(title: string): boolean {
  const normalized = normalizeSearchText(title);
  return /(lecture|forelesning|lab|laboratorium|undervisning|seminar|class)/.test(normalized);
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
  const exactPreset = presets.find((preset) => normalizeSearchText(preset.title) === needle);
  if (exactPreset) {
    return exactPreset;
  }
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
    const exactHabit = habits.find((habit) => normalizeSearchText(habit.name) === needle);
    if (exactHabit) {
      target = exactHabit;
    } else {
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
    }
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
    const exactGoal = goals.find((goal) => normalizeSearchText(goal.title) === needle);
    if (exactGoal) {
      target = exactGoal;
    } else {
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
    }
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

export function handleGetNutritionHistory(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { entries: NutritionDayHistoryEntry[]; from: string; to: string } {
  const rawFrom = parseNutritionDate(args.from);
  const rawTo = parseNutritionDate(args.to);
  const days = Math.min(Math.max(Number(args.days) || 7, 1), 90);

  let fromDate: string;
  let toDate: string;

  if (rawFrom && rawTo) {
    fromDate = rawFrom;
    toDate = rawTo;
  } else {
    const end = rawTo ? new Date(rawTo + "T00:00:00Z") : new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    fromDate = start.toISOString().slice(0, 10);
    toDate = end.toISOString().slice(0, 10);
  }

  const entries = store.getNutritionDailyHistory(fromDate, toDate);
  return { entries, from: fromDate, to: toDate };
}

const NUTRITION_MEAL_DONE_TOKEN = "[done]";

function mealNotesWithDoneToken(notes: string | undefined, completed: boolean): string | undefined {
  const cleaned = (notes ?? "")
    .replaceAll(NUTRITION_MEAL_DONE_TOKEN, "")
    .trim();
  if (completed) {
    return cleaned.length > 0 ? `${NUTRITION_MEAL_DONE_TOKEN} ${cleaned}` : NUTRITION_MEAL_DONE_TOKEN;
  }
  return cleaned.length > 0 ? cleaned : undefined;
}

function resolveNutritionMealTarget(
  store: RuntimeStore,
  args: Record<string, unknown>
): NutritionMeal | { error: string } {
  const mealId = asTrimmedString(args.mealId);
  if (mealId) {
    const byId = store.getNutritionMealById(mealId);
    if (!byId) {
      return { error: `Meal not found: ${mealId}` };
    }
    return byId;
  }

  const mealName = asTrimmedString(args.mealName);
  const meals = store.getNutritionMeals({ limit: 500 });
  if (meals.length === 0) {
    return { error: "No meals have been logged yet." };
  }

  if (!mealName) {
    if (meals.length === 1) {
      return meals[0]!;
    }
    return { error: "Provide mealId or mealName when multiple meals exist." };
  }

  const needle = normalizeSearchText(mealName);
  const exactMeal = meals.find((meal) => normalizeSearchText(meal.name) === needle);
  if (exactMeal) {
    return exactMeal;
  }
  const matches = meals.filter((meal) => normalizeSearchText(meal.name).includes(needle));
  if (matches.length === 0) {
    return { error: `No meal matched "${mealName}".` };
  }
  if (matches.length > 1) {
    return {
      error: `Meal name is ambiguous. Matches: ${matches
        .slice(0, 4)
        .map((meal) => meal.name)
        .join(", ")}`
    };
  }
  return matches[0]!;
}

function resolveNutritionMealItemTarget(
  meal: NutritionMeal,
  args: Record<string, unknown>
): { index: number; item: NutritionMeal["items"][number] } | { error: string } {
  const itemId = asTrimmedString(args.itemId);
  if (itemId) {
    const index = meal.items.findIndex((item) => item.id === itemId);
    if (index === -1) {
      return { error: `Meal item not found: ${itemId}` };
    }
    return { index, item: meal.items[index]! };
  }

  const itemName = asTrimmedString(args.itemName);
  if (!itemName) {
    if (meal.items.length === 1) {
      return { index: 0, item: meal.items[0]! };
    }
    return { error: "Provide itemId or itemName when multiple meal items exist." };
  }

  const needle = normalizeSearchText(itemName);
  const exactItemEntry = meal.items
    .map((item, index) => ({ item, index }))
    .find((entry) => normalizeSearchText(entry.item.name) === needle);
  if (exactItemEntry) {
    return exactItemEntry;
  }
  const matches = meal.items
    .map((item, index) => ({ item, index }))
    .filter((entry) => normalizeSearchText(entry.item.name).includes(needle));
  if (matches.length === 0) {
    return { error: `No meal item matched "${itemName}".` };
  }
  if (matches.length > 1) {
    return {
      error: `Meal item name is ambiguous. Matches: ${matches
        .slice(0, 4)
        .map((entry) => entry.item.name)
        .join(", ")}`
    };
  }
  return matches[0]!;
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseNutritionConsumedAt(value: unknown): string | null {
  const raw = asTrimmedString(value);
  if (!raw) {
    return null;
  }
  const parsed = parseFlexibleDateTime(raw, new Date());
  return parsed ? parsed.toISOString() : null;
}

export function handleGetNutritionTargets(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { date: string; profile: ReturnType<RuntimeStore["getNutritionTargetProfile"]> } {
  const date = parseNutritionDate(args.date) ?? toDateKey(new Date());
  return {
    date,
    profile: store.getNutritionTargetProfile(date)
  };
}

export function handleUpdateNutritionTargets(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; profile: ReturnType<RuntimeStore["upsertNutritionTargetProfile"]>; message: string } | { error: string } {
  const entry: {
    date?: string;
    weightKg?: number | null;
    maintenanceCalories?: number | null;
    surplusCalories?: number | null;
    targetCalories?: number | null;
    targetProteinGrams?: number | null;
    targetCarbsGrams?: number | null;
    targetFatGrams?: number | null;
  } = {};

  const requestedDate = parseNutritionDate(args.date);
  if (requestedDate) {
    entry.date = requestedDate;
  } else if (asTrimmedString(args.date)) {
    return { error: "date must be YYYY-MM-DD when provided." };
  }

  const setNumberOrNull = (
    key:
      | "weightKg"
      | "maintenanceCalories"
      | "surplusCalories"
      | "targetCalories"
      | "targetProteinGrams"
      | "targetCarbsGrams"
      | "targetFatGrams",
    min: number,
    max: number
  ): true | { error: string } => {
    if (!Object.prototype.hasOwnProperty.call(args, key)) {
      return true;
    }
    const raw = args[key];
    if (raw === null) {
      entry[key] = null;
      return true;
    }
    if (typeof raw !== "number" || Number.isNaN(raw)) {
      return { error: `${key} must be a number or null.` };
    }
    entry[key] = clampFloat(raw, 0, min, max);
    return true;
  };

  for (const [key, min, max] of [
    ["weightKg", 0, 500],
    ["maintenanceCalories", 0, 10000],
    ["surplusCalories", -5000, 5000],
    ["targetCalories", 0, 15000],
    ["targetProteinGrams", 0, 1000],
    ["targetCarbsGrams", 0, 1500],
    ["targetFatGrams", 0, 600]
  ] as const) {
    const applied = setNumberOrNull(key, min, max);
    if (applied !== true) {
      return applied;
    }
  }

  const hasPatchField = [
    "weightKg",
    "maintenanceCalories",
    "surplusCalories",
    "targetCalories",
    "targetProteinGrams",
    "targetCarbsGrams",
    "targetFatGrams"
  ].some((key) => Object.prototype.hasOwnProperty.call(entry, key));

  if (!hasPatchField) {
    return {
      error:
        "Provide at least one field to update: weightKg, maintenanceCalories, surplusCalories, targetCalories, targetProteinGrams, targetCarbsGrams, targetFatGrams."
    };
  }

  const profile = store.upsertNutritionTargetProfile(entry);
  return {
    success: true,
    profile,
    message: `Updated nutrition targets for ${profile.date}.`
  };
}

export function handleGetNutritionMeals(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { meals: NutritionMeal[]; total: number } | { error: string } {
  const dateRaw = asTrimmedString(args.date);
  const date = parseNutritionDate(dateRaw);
  if (dateRaw && !date) {
    return { error: "date must be YYYY-MM-DD when provided." };
  }

  const fromRaw = asTrimmedString(args.from);
  const toRaw = asTrimmedString(args.to);
  if (fromRaw && Number.isNaN(new Date(fromRaw).getTime())) {
    return { error: "from must be a valid ISO datetime when provided." };
  }
  if (toRaw && Number.isNaN(new Date(toRaw).getTime())) {
    return { error: "to must be a valid ISO datetime when provided." };
  }

  const limit = clampNumber(args.limit, 30, 1, 500);
  const meals = store.getNutritionMeals({
    ...(date ? { date } : {}),
    ...(fromRaw ? { from: fromRaw } : {}),
    ...(toRaw ? { to: toRaw } : {}),
    limit
  });
  return {
    meals,
    total: meals.length
  };
}

function resolveNutritionPlanSnapshotTarget(
  store: RuntimeStore,
  args: Record<string, unknown>
): NutritionPlanSnapshot | { error: string } {
  const snapshotId = asTrimmedString(args.snapshotId);
  if (snapshotId) {
    const byId = store.getNutritionPlanSnapshotById(snapshotId);
    if (!byId) {
      return { error: `Nutrition plan snapshot not found: ${snapshotId}` };
    }
    return byId;
  }

  const snapshotName = asTrimmedString(args.snapshotName);
  const snapshots = store.getNutritionPlanSnapshots({ limit: 500 });
  if (snapshots.length === 0) {
    return { error: "No nutrition plan snapshots exist yet." };
  }

  if (!snapshotName) {
    if (snapshots.length === 1) {
      return snapshots[0]!;
    }
    return { error: "Provide snapshotId or snapshotName when multiple snapshots exist." };
  }

  const needle = normalizeSearchText(snapshotName);
  const exactSnapshot = snapshots.find((snapshot) => normalizeSearchText(snapshot.name) === needle);
  if (exactSnapshot) {
    return exactSnapshot;
  }
  const matches = snapshots.filter((snapshot) => normalizeSearchText(snapshot.name).includes(needle));
  if (matches.length === 0) {
    return { error: `No nutrition plan snapshot matched "${snapshotName}".` };
  }
  if (matches.length > 1) {
    return {
      error: `Snapshot name is ambiguous. Matches: ${matches
        .slice(0, 4)
        .map((snapshot) => snapshot.name)
        .join(", ")}`
    };
  }
  return matches[0]!;
}

export function handleGetNutritionPlanSnapshots(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { snapshots: NutritionPlanSnapshot[]; total: number } {
  const query = asTrimmedString(args.query) ?? undefined;
  const limit = clampNumber(args.limit, 20, 1, 200);
  const snapshots = store.getNutritionPlanSnapshots({
    ...(query ? { query } : {}),
    limit
  });
  return {
    snapshots,
    total: snapshots.length
  };
}

export function handleSaveNutritionPlanSnapshot(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; snapshot: NutritionPlanSnapshot; mealsSaved: number; message: string } | { error: string } {
  const dateRaw = asTrimmedString(args.date);
  const date = parseNutritionDate(dateRaw);
  if (dateRaw && !date) {
    return { error: "date must be YYYY-MM-DD when provided." };
  }

  const effectiveDate = date ?? toDateKey(new Date());
  const name = asTrimmedString(args.name) ?? `Meal plan ${effectiveDate}`;
  const replaceSnapshotId = asTrimmedString(args.replaceSnapshotId) ?? asTrimmedString(args.snapshotId);
  const snapshot = store.createNutritionPlanSnapshot({
    name,
    date: effectiveDate,
    ...(replaceSnapshotId ? { replaceId: replaceSnapshotId } : {})
  });

  if (!snapshot) {
    return { error: "Unable to save nutrition plan snapshot. Add at least one meal first." };
  }

  return {
    success: true,
    snapshot,
    mealsSaved: snapshot.meals.length,
    message: `Saved nutrition plan snapshot "${snapshot.name}" with ${snapshot.meals.length} meals.`
  };
}

export function handleApplyNutritionPlanSnapshot(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
):
  | {
      success: true;
      snapshot: NutritionPlanSnapshot;
      appliedDate: string;
      mealsCreated: number;
      message: string;
    }
  | { error: string } {
  const resolvedSnapshot = resolveNutritionPlanSnapshotTarget(store, args);
  if ("error" in resolvedSnapshot) {
    return resolvedSnapshot;
  }

  const dateRaw = asTrimmedString(args.date);
  const date = parseNutritionDate(dateRaw);
  if (dateRaw && !date) {
    return { error: "date must be YYYY-MM-DD when provided." };
  }

  const replaceMeals = typeof args.replaceMeals === "boolean" ? args.replaceMeals : true;
  const setAsDefault = typeof args.setAsDefault === "boolean" ? args.setAsDefault : true;
  const applied = store.applyNutritionPlanSnapshot(resolvedSnapshot.id, {
    date: date ?? toDateKey(new Date()),
    replaceMeals,
    setAsDefault
  });
  if (!applied) {
    return { error: "Unable to apply nutrition plan snapshot." };
  }

  return {
    success: true,
    snapshot: applied.snapshot,
    appliedDate: applied.appliedDate,
    mealsCreated: applied.mealsCreated.length,
    message: `Applied nutrition plan snapshot "${applied.snapshot.name}" to ${applied.appliedDate}.`
  };
}

export function handleDeleteNutritionPlanSnapshot(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
):
  | { success: true; deleted: true; snapshotId: string; snapshotName: string; message: string }
  | { success: true; deleted: false; message: string }
  | { error: string } {
  const snapshots = store.getNutritionPlanSnapshots({ limit: 500 });
  if (snapshots.length === 0) {
    return {
      success: true,
      deleted: false,
      message: "No nutrition plan snapshots exist yet."
    };
  }

  const resolvedSnapshot = resolveNutritionPlanSnapshotTarget(store, args);
  if ("error" in resolvedSnapshot) {
    return resolvedSnapshot;
  }

  const deleted = store.deleteNutritionPlanSnapshot(resolvedSnapshot.id);
  if (!deleted) {
    return { error: "Unable to delete nutrition plan snapshot." };
  }

  return {
    success: true,
    deleted: true,
    snapshotId: resolvedSnapshot.id,
    snapshotName: resolvedSnapshot.name,
    message: `Deleted nutrition plan snapshot "${resolvedSnapshot.name}".`
  };
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
  const exactMatch = foods.find((food) => normalizeSearchText(food.name) === needle);
  if (exactMatch) {
    return exactMatch;
  }
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

  // Check for existing custom food with the same name (case-insensitive)
  const existingFoods = store.getNutritionCustomFoods({ limit: 500 });
  const needle = normalizeSearchText(name);
  const duplicate = existingFoods.find((f) => normalizeSearchText(f.name) === needle);
  if (duplicate) {
    return {
      success: true,
      food: duplicate,
      message: `Custom food "${duplicate.name}" already exists (id: ${duplicate.id}). Use updateNutritionCustomFood to modify it.`
    };
  }

  if (typeof args.caloriesPerUnit !== "number") {
    return { error: "caloriesPerUnit is required." };
  }

  const unitLabel = asTrimmedString(args.unitLabel) ?? "g";
  const caloriesPerUnit = clampFloat(args.caloriesPerUnit, 0, 0, 10000, 4);
  const proteinGramsPerUnit = clampFloat(args.proteinGramsPerUnit, 0, 0, 1000, 4);
  const carbsGramsPerUnit = clampFloat(args.carbsGramsPerUnit, 0, 0, 1500, 4);
  const fatGramsPerUnit = clampFloat(args.fatGramsPerUnit, 0, 0, 600, 4);

  const densityError = assertPlausibleGramDensityForCustomFood({
    name,
    unitLabel,
    caloriesPerUnit,
    proteinGramsPerUnit,
    carbsGramsPerUnit,
    fatGramsPerUnit
  });
  if (densityError) {
    return { error: densityError };
  }

  const food = store.createNutritionCustomFood({
    name,
    unitLabel,
    caloriesPerUnit,
    proteinGramsPerUnit,
    carbsGramsPerUnit,
    fatGramsPerUnit
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
    patch.caloriesPerUnit = clampFloat(args.caloriesPerUnit, 0, 0, 10000, 4);
  }
  if (typeof args.proteinGramsPerUnit === "number") {
    patch.proteinGramsPerUnit = clampFloat(args.proteinGramsPerUnit, 0, 0, 1000, 4);
  }
  if (typeof args.carbsGramsPerUnit === "number") {
    patch.carbsGramsPerUnit = clampFloat(args.carbsGramsPerUnit, 0, 0, 1500, 4);
  }
  if (typeof args.fatGramsPerUnit === "number") {
    patch.fatGramsPerUnit = clampFloat(args.fatGramsPerUnit, 0, 0, 600, 4);
  }

  const effectiveUnitLabel = patch.unitLabel ?? resolved.unitLabel;
  const effectiveCaloriesPerUnit = patch.caloriesPerUnit ?? resolved.caloriesPerUnit;
  const effectiveProteinGramsPerUnit = patch.proteinGramsPerUnit ?? resolved.proteinGramsPerUnit;
  const effectiveCarbsGramsPerUnit = patch.carbsGramsPerUnit ?? resolved.carbsGramsPerUnit;
  const effectiveFatGramsPerUnit = patch.fatGramsPerUnit ?? resolved.fatGramsPerUnit;
  const densityError = assertPlausibleGramDensityForCustomFood({
    name: patch.name ?? resolved.name,
    unitLabel: effectiveUnitLabel,
    caloriesPerUnit: effectiveCaloriesPerUnit,
    proteinGramsPerUnit: effectiveProteinGramsPerUnit,
    carbsGramsPerUnit: effectiveCarbsGramsPerUnit,
    fatGramsPerUnit: effectiveFatGramsPerUnit
  });
  if (densityError) {
    return { error: densityError };
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

function buildNutritionMealItemFromCustomFood(
  customFood: NutritionCustomFood,
  quantity: number
): NutritionMeal["items"][number] {
  return {
    name: customFood.name,
    quantity,
    unitLabel: customFood.unitLabel,
    caloriesPerUnit: customFood.caloriesPerUnit,
    proteinGramsPerUnit: customFood.proteinGramsPerUnit,
    carbsGramsPerUnit: customFood.carbsGramsPerUnit,
    fatGramsPerUnit: customFood.fatGramsPerUnit,
    customFoodId: customFood.id
  };
}

const MAX_PLAUSIBLE_KCAL_PER_GRAM = 9.5;
const MAX_PLAUSIBLE_MACRO_GRAMS_PER_GRAM = 1.1;

function roundToDecimal(value: number, precision = 1): number {
  const decimals = Number.isInteger(precision) ? Math.min(Math.max(precision, 0), 6) : 1;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundToTenth(value: number): number {
  return roundToDecimal(value, 1);
}

function isGramUnitLabel(unitLabel: string | null | undefined): boolean {
  if (!unitLabel) {
    return false;
  }
  const normalized = unitLabel.trim().toLowerCase();
  return normalized === "g" || normalized === "gram" || normalized === "grams" || normalized === "gr";
}

function hasImplausiblePerGramDensity(item: Pick<NutritionMeal["items"][number], "caloriesPerUnit" | "proteinGramsPerUnit" | "carbsGramsPerUnit" | "fatGramsPerUnit">): boolean {
  const macroDensity = item.proteinGramsPerUnit + item.carbsGramsPerUnit + item.fatGramsPerUnit;
  return item.caloriesPerUnit > MAX_PLAUSIBLE_KCAL_PER_GRAM || macroDensity > MAX_PLAUSIBLE_MACRO_GRAMS_PER_GRAM;
}

function assertPlausibleGramDensityForCustomFood(candidate: {
  name: string;
  unitLabel: string;
  caloriesPerUnit: number;
  proteinGramsPerUnit: number;
  carbsGramsPerUnit: number;
  fatGramsPerUnit: number;
}): string | null {
  if (!isGramUnitLabel(candidate.unitLabel)) {
    return null;
  }

  if (
    hasImplausiblePerGramDensity({
      caloriesPerUnit: candidate.caloriesPerUnit,
      proteinGramsPerUnit: candidate.proteinGramsPerUnit,
      carbsGramsPerUnit: candidate.carbsGramsPerUnit,
      fatGramsPerUnit: candidate.fatGramsPerUnit
    })
  ) {
    return `Custom food "${candidate.name}" uses gram units but has implausible per-gram nutrition values. Provide realistic per-gram values (or change unitLabel).`;
  }

  return null;
}

function parseNutritionMealItemsArg(
  store: RuntimeStore,
  value: unknown
): NutritionMeal["items"] | { error: string } {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: NutritionMeal["items"] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const customFoodId = asTrimmedString(record.customFoodId);
    const customFoodName = asTrimmedString(record.customFoodName);
    if (typeof record.quantity !== "number") {
      return { error: "Each meal item must include quantity in grams/units." };
    }
    const quantity = clampFloat(record.quantity, 1, 1, 1000);

    if (customFoodId || customFoodName) {
      const resolvedFood = resolveNutritionCustomFoodTarget(store, {
        customFoodId,
        customFoodName
      });
      if ("error" in resolvedFood) {
        return resolvedFood;
      }
      if (
        isGramUnitLabel(resolvedFood.unitLabel) &&
        hasImplausiblePerGramDensity({
          caloriesPerUnit: resolvedFood.caloriesPerUnit,
          proteinGramsPerUnit: resolvedFood.proteinGramsPerUnit,
          carbsGramsPerUnit: resolvedFood.carbsGramsPerUnit,
          fatGramsPerUnit: resolvedFood.fatGramsPerUnit
        })
      ) {
        return {
          error:
            `Custom food "${resolvedFood.name}" has implausible per-gram nutrition values. Update it with realistic per-gram values before using it in meals.`
        };
      }
      items.push(buildNutritionMealItemFromCustomFood(resolvedFood, quantity));
      continue;
    }

    const name = asTrimmedString(record.name);
    if (!name) {
      return { error: "Each meal item must include name or customFoodId/customFoodName." };
    }

    if (typeof record.caloriesPerUnit !== "number") {
      return { error: `Item "${name}" must include caloriesPerUnit when no custom food is provided.` };
    }

    const nextItem = {
      name,
      quantity,
      unitLabel: asTrimmedString(record.unitLabel) ?? "g",
      caloriesPerUnit: clampFloat(record.caloriesPerUnit, 0, 0, 10000, 4),
      proteinGramsPerUnit: clampFloat(record.proteinGramsPerUnit, 0, 0, 1000, 4),
      carbsGramsPerUnit: clampFloat(record.carbsGramsPerUnit, 0, 0, 1500, 4),
      fatGramsPerUnit: clampFloat(record.fatGramsPerUnit, 0, 0, 600, 4),
      ...(customFoodId ? { customFoodId } : {})
    };
    if (isGramUnitLabel(nextItem.unitLabel) && hasImplausiblePerGramDensity(nextItem)) {
      return {
        error:
          `Item "${name}" uses gram units but has implausible per-gram nutrition values. Provide realistic per-gram values and explicit quantity.`
      };
    }

    items.push(nextItem);
  }

  return items;
}

export function handleCreateNutritionMeal(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; meal: NutritionMeal; message: string } | { error: string } {
  const name = asTrimmedString(args.name);
  if (!name) {
    return { error: "name is required." };
  }

  const parsedItems = parseNutritionMealItemsArg(store, args.items);
  if ("error" in parsedItems) {
    return parsedItems;
  }

  let items = parsedItems;
  if (items.length === 0 && (asTrimmedString(args.customFoodId) || asTrimmedString(args.customFoodName))) {
    const resolvedFood = resolveNutritionCustomFoodTarget(store, {
      customFoodId: asTrimmedString(args.customFoodId),
      customFoodName: asTrimmedString(args.customFoodName)
    });
    if ("error" in resolvedFood) {
      return resolvedFood;
    }
    if (typeof args.quantity !== "number") {
      return { error: "quantity is required when creating a meal from a custom food." };
    }
    items = [buildNutritionMealItemFromCustomFood(resolvedFood, clampFloat(args.quantity, 1, 1, 1000))];
  }

  const caloriesInput = typeof args.calories === "number" ? clampFloat(args.calories, 0, 0, 10000) : null;
  const proteinGrams = clampFloat(args.proteinGrams, 0, 0, 1000);
  const carbsGrams = clampFloat(args.carbsGrams, 0, 0, 1500);
  const fatGrams = clampFloat(args.fatGrams, 0, 0, 600);

  let calories = caloriesInput;
  if (calories === null && items.length === 0 && (proteinGrams > 0 || carbsGrams > 0 || fatGrams > 0)) {
    calories = Math.round((proteinGrams * 4 + carbsGrams * 4 + fatGrams * 9) * 10) / 10;
  }

  if (items.length === 0 && calories === null) {
    return { error: "Provide items or calories/macros when creating a meal." };
  }

  const consumedAt = parseNutritionConsumedAt(args.consumedAt) ?? new Date().toISOString();
  if (asTrimmedString(args.consumedAt) && !parseNutritionConsumedAt(args.consumedAt)) {
    return { error: "consumedAt must be a valid datetime when provided." };
  }

  const meal = store.createNutritionMeal({
    name,
    mealType: parseMealType(args.mealType),
    consumedAt,
    items,
    ...(calories !== null ? { calories } : {}),
    proteinGrams,
    carbsGrams,
    fatGrams,
    ...(asTrimmedString(args.notes) ? { notes: asTrimmedString(args.notes)! } : {})
  });

  return {
    success: true,
    meal,
    message: `Created meal "${meal.name}".`
  };
}

export function handleUpdateNutritionMeal(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; meal: NutritionMeal; message: string } | { error: string } {
  const resolved = resolveNutritionMealTarget(store, args);
  if ("error" in resolved) {
    return resolved;
  }

  const patch: Partial<Omit<NutritionMeal, "id" | "createdAt">> = {};

  const nextName = asTrimmedString(args.name);
  if (nextName) {
    patch.name = nextName;
  }

  const mealTypeRaw = asTrimmedString(args.mealType);
  if (mealTypeRaw) {
    patch.mealType = parseMealType(mealTypeRaw);
  }

  const consumedAtRaw = asTrimmedString(args.consumedAt);
  if (consumedAtRaw) {
    const parsedConsumedAt = parseNutritionConsumedAt(consumedAtRaw);
    if (!parsedConsumedAt) {
      return { error: "consumedAt must be a valid datetime when provided." };
    }
    patch.consumedAt = parsedConsumedAt;
  }

  if (Object.prototype.hasOwnProperty.call(args, "notes")) {
    patch.notes = asTrimmedString(args.notes) ?? "";
  }

  if (Object.prototype.hasOwnProperty.call(args, "completed")) {
    if (typeof args.completed !== "boolean") {
      return { error: "completed must be a boolean when provided." };
    }
    const baseNotes = typeof patch.notes === "string" ? patch.notes : resolved.notes;
    patch.notes = mealNotesWithDoneToken(baseNotes, args.completed) ?? "";
    if (args.completed && !consumedAtRaw) {
      patch.consumedAt = new Date().toISOString();
    }
  }

  if (typeof args.calories === "number") {
    patch.calories = clampFloat(args.calories, 0, 0, 10000);
  }
  if (typeof args.proteinGrams === "number") {
    patch.proteinGrams = clampFloat(args.proteinGrams, 0, 0, 1000);
  }
  if (typeof args.carbsGrams === "number") {
    patch.carbsGrams = clampFloat(args.carbsGrams, 0, 0, 1500);
  }
  if (typeof args.fatGrams === "number") {
    patch.fatGrams = clampFloat(args.fatGrams, 0, 0, 600);
  }

  if (Object.keys(patch).length === 0) {
    return {
      error:
        "Provide at least one field to update: name, mealType, consumedAt, notes, completed, calories, proteinGrams, carbsGrams, fatGrams."
    };
  }

  const updated = store.updateNutritionMeal(resolved.id, patch);
  if (!updated) {
    return { error: "Unable to update meal." };
  }

  return {
    success: true,
    meal: updated,
    message: `Updated meal "${updated.name}".`
  };
}

export function handleAddNutritionMealItem(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; meal: NutritionMeal; item: NutritionMeal["items"][number]; message: string } | { error: string } {
  const resolvedMeal = resolveNutritionMealTarget(store, args);
  if ("error" in resolvedMeal) {
    return resolvedMeal;
  }

  const resolvedFood = resolveNutritionCustomFoodTarget(store, args);
  if ("error" in resolvedFood) {
    return resolvedFood;
  }

  const quantity = clampFloat(args.quantity, 100, 1, 1000);
  const nextItem = buildNutritionMealItemFromCustomFood(resolvedFood, quantity);
  const nextItems = [...resolvedMeal.items, nextItem];

  const updated = store.updateNutritionMeal(resolvedMeal.id, { items: nextItems });
  if (!updated) {
    return { error: "Unable to add meal item." };
  }

  const added = updated.items[updated.items.length - 1];
  if (!added) {
    return { error: "Meal item was not added." };
  }

  return {
    success: true,
    meal: updated,
    item: added,
    message: `Added "${resolvedFood.name}" to "${updated.name}".`
  };
}

export function handleUpdateNutritionMealItem(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; meal: NutritionMeal; item: NutritionMeal["items"][number]; message: string } | { error: string } {
  const resolvedMeal = resolveNutritionMealTarget(store, args);
  if ("error" in resolvedMeal) {
    return resolvedMeal;
  }
  if (resolvedMeal.items.length === 0) {
    return { error: "This meal has no items to update." };
  }

  const resolvedItem = resolveNutritionMealItemTarget(resolvedMeal, args);
  if ("error" in resolvedItem) {
    return resolvedItem;
  }

  const hasQuantity = typeof args.quantity === "number";
  const hasDelta = typeof args.delta === "number";
  if (!hasQuantity && !hasDelta) {
    return { error: "Provide quantity or delta to update a meal item." };
  }

  const nextQuantity = hasQuantity
    ? clampFloat(args.quantity, resolvedItem.item.quantity, 1, 1000)
    : clampFloat(resolvedItem.item.quantity + Number(args.delta ?? 0), resolvedItem.item.quantity, 1, 1000);

  const nextItems = resolvedMeal.items.map((item, index) =>
    index === resolvedItem.index
      ? {
          ...item,
          quantity: nextQuantity
        }
      : item
  );

  const updated = store.updateNutritionMeal(resolvedMeal.id, { items: nextItems });
  if (!updated) {
    return { error: "Unable to update meal item." };
  }

  const updatedItem = updated.items.find((item) => item.id && item.id === resolvedItem.item.id) ?? updated.items[resolvedItem.index];
  if (!updatedItem) {
    return { error: "Meal item update could not be verified." };
  }

  return {
    success: true,
    meal: updated,
    item: updatedItem,
    message: `Updated "${updatedItem.name}" to ${updatedItem.quantity}g in "${updated.name}".`
  };
}

export function handleRemoveNutritionMealItem(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; meal: NutritionMeal; removedItemId?: string; message: string } | { error: string } {
  const resolvedMeal = resolveNutritionMealTarget(store, args);
  if ("error" in resolvedMeal) {
    return resolvedMeal;
  }
  if (resolvedMeal.items.length === 0) {
    return { error: "This meal has no items to remove." };
  }

  const resolvedItem = resolveNutritionMealItemTarget(resolvedMeal, args);
  if ("error" in resolvedItem) {
    return resolvedItem;
  }

  const nextItems = resolvedMeal.items.filter((_, index) => index !== resolvedItem.index);
  const updated = store.updateNutritionMeal(resolvedMeal.id, {
    items: nextItems,
    ...(nextItems.length === 0
      ? {
          calories: 0,
          proteinGrams: 0,
          carbsGrams: 0,
          fatGrams: 0
        }
      : {})
  });
  if (!updated) {
    return { error: "Unable to remove meal item." };
  }

  return {
    success: true,
    meal: updated,
    ...(resolvedItem.item.id ? { removedItemId: resolvedItem.item.id } : {}),
    message: `Removed "${resolvedItem.item.name}" from "${updated.name}".`
  };
}

export function handleMoveNutritionMeal(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
):
  | { success: true; moved: false; meal: NutritionMeal; message: string }
  | { success: true; moved: true; meal: NutritionMeal; message: string }
  | { error: string } {
  const resolvedMeal = resolveNutritionMealTarget(store, args);
  if ("error" in resolvedMeal) {
    return resolvedMeal;
  }

  const direction = asTrimmedString(args.direction)?.toLowerCase();
  if (direction !== "up" && direction !== "down") {
    return { error: "direction must be either up or down." };
  }

  const date = parseNutritionDate(args.date) ?? toDateKey(new Date(resolvedMeal.consumedAt));
  const meals = store.getNutritionMeals({ date, limit: 1000 });
  const index = meals.findIndex((meal) => meal.id === resolvedMeal.id);
  if (index === -1) {
    return { error: "Meal is not in the requested day window." };
  }

  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= meals.length) {
    return {
      success: true,
      moved: false,
      meal: resolvedMeal,
      message: `Meal "${resolvedMeal.name}" is already at the ${direction === "up" ? "top" : "bottom"} of that day.`
    };
  }

  const reordered = [...meals];
  const [movedMeal] = reordered.splice(index, 1);
  reordered.splice(nextIndex, 0, movedMeal!);

  const dayStart = new Date(`${date}T00:00:00.000Z`).getTime();
  const updatedMeals = new Map<string, NutritionMeal>();
  reordered.forEach((meal, orderIndex) => {
    const consumedAt = new Date(dayStart + orderIndex * 60_000).toISOString();
    const updated = store.updateNutritionMeal(meal.id, { consumedAt });
    if (updated) {
      updatedMeals.set(updated.id, updated);
    }
  });

  const updatedMovedMeal = updatedMeals.get(resolvedMeal.id);
  if (!updatedMovedMeal) {
    return { error: "Unable to reorder meals." };
  }

  return {
    success: true,
    moved: true,
    meal: updatedMovedMeal,
    message: `Moved "${updatedMovedMeal.name}" ${direction}.`
  };
}

export function handleSetNutritionMealOrder(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
):
  | { success: true; orderedMealNames: string[]; message: string }
  | { error: string } {
  const rawNames = Array.isArray(args.orderedMealNames)
    ? args.orderedMealNames
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];
  if (rawNames.length === 0) {
    return { error: "orderedMealNames must contain at least one meal name." };
  }

  const uniqueNames: string[] = [];
  const seen = new Set<string>();
  rawNames.forEach((name) => {
    const key = normalizeSearchText(name);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueNames.push(name);
    }
  });

  const date = parseNutritionDate(args.date) ?? toDateKey(new Date());
  const meals = store.getNutritionMeals({ date, limit: 1000 });
  if (meals.length === 0) {
    return { error: `No meals found for ${date}.` };
  }

  const remaining = [...meals];
  const ordered: NutritionMeal[] = [];
  for (const name of uniqueNames) {
    const needle = normalizeSearchText(name);
    const exactMatches = remaining.filter((meal) => normalizeSearchText(meal.name) === needle);
    const partialMatches =
      exactMatches.length > 0
        ? exactMatches
        : remaining.filter((meal) => {
            const normalized = normalizeSearchText(meal.name);
            return normalized.includes(needle) || needle.includes(normalized);
          });
    if (partialMatches.length === 0) {
      return { error: `Could not find meal "${name}" on ${date}.` };
    }
    if (partialMatches.length > 1) {
      return {
        error: `Meal name "${name}" is ambiguous on ${date}. Matches: ${partialMatches
          .slice(0, 4)
          .map((meal) => meal.name)
          .join(", ")}`
      };
    }

    const matched = partialMatches[0]!;
    const index = remaining.findIndex((meal) => meal.id === matched.id);
    if (index !== -1) {
      const [meal] = remaining.splice(index, 1);
      if (meal) {
        ordered.push(meal);
      }
    }
  }

  const finalOrder = [...ordered, ...remaining];
  const dayStart = new Date(`${date}T00:00:00.000Z`).getTime();
  const updatedNames: string[] = [];
  for (const [orderIndex, meal] of finalOrder.entries()) {
    const consumedAt = new Date(dayStart + orderIndex * 60_000).toISOString();
    const updated = store.updateNutritionMeal(meal.id, { consumedAt });
    if (!updated) {
      return { error: `Unable to reorder meal "${meal.name}".` };
    }
    updatedNames.push(updated.name);
  }

  return {
    success: true,
    orderedMealNames: updatedNames,
    message: `Set meal order for ${date}: ${updatedNames.join(" → ")}`
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
  const servings = typeof args.servings === "number" ? clampFloat(args.servings, 1, 0.1, 100) : 1;
  const quantityArg = typeof args.quantity === "number" ? clampFloat(args.quantity, 1, 1, 2000) : null;
  const estimatedWeightArg =
    typeof args.estimatedWeightGrams === "number"
      ? clampFloat(args.estimatedWeightGrams, 1, 1, 2000)
      : null;

  if (customFoodId || customFoodName) {
    const resolved = resolveNutritionCustomFoodTarget(store, { customFoodId, customFoodName });
    if ("error" in resolved) {
      return resolved;
    }

    mealName = mealName ?? resolved.name;

    const useGramQuantity = isGramUnitLabel(resolved.unitLabel);
    const explicitQuantity = quantityArg ?? estimatedWeightArg;
    if (useGramQuantity && explicitQuantity === null) {
      return { error: "quantity (grams) is required when logging a gram-based custom food." };
    }
    const baseQuantity = explicitQuantity ?? servings;

    const nextItem = buildNutritionMealItemFromCustomFood(resolved, baseQuantity);
    if (useGramQuantity && hasImplausiblePerGramDensity(nextItem)) {
      return {
        error:
          `Custom food "${resolved.name}" has implausible per-gram nutrition values. Update that food with realistic per-gram macros before logging it.`
      };
    }

    const item = {
      name: resolved.name,
      quantity: baseQuantity,
      unitLabel: resolved.unitLabel,
      caloriesPerUnit: resolved.caloriesPerUnit,
      proteinGramsPerUnit: resolved.proteinGramsPerUnit,
      carbsGramsPerUnit: resolved.carbsGramsPerUnit,
      fatGramsPerUnit: resolved.fatGramsPerUnit,
      customFoodId: resolved.id
    };

    calories = roundToTenth(item.quantity * item.caloriesPerUnit);
    proteinGrams = roundToTenth(item.quantity * item.proteinGramsPerUnit);
    carbsGrams = roundToTenth(item.quantity * item.carbsGramsPerUnit);
    fatGrams = roundToTenth(item.quantity * item.fatGramsPerUnit);

    const note = asTrimmedString(args.notes);
    const autoNote = useGramQuantity
      ? `${item.quantity} g`
      : `${roundToTenth(item.quantity)} ${resolved.unitLabel}`;

    const meal = store.createNutritionMeal({
      name: mealName,
      mealType: parseMealType(args.mealType),
      consumedAt: asTrimmedString(args.consumedAt) ?? new Date().toISOString(),
      items: [item],
      calories,
      proteinGrams,
      carbsGrams,
      fatGrams,
      ...((note ?? autoNote) ? { notes: note ?? autoNote ?? undefined } : {})
    });

    return {
      success: true,
      meal,
      message: explicitQuantity !== null
        ? `Logged meal "${meal.name}" from custom food "${resolved.name}".`
        : `Logged meal "${meal.name}" from custom food "${resolved.name}".`
    };
  }

  if (!mealName) {
    return { error: "name is required (or provide customFoodId/customFoodName)." };
  }
  if (calories === null) {
    return { error: "calories is required (or provide customFoodId/customFoodName)." };
  }

  const note = asTrimmedString(args.notes);
  const explicitWeight = quantityArg ?? estimatedWeightArg;
  const mealItems =
    explicitWeight !== null
      ? [
          {
            name: mealName,
            quantity: explicitWeight,
            unitLabel: "g",
            caloriesPerUnit: roundToDecimal(calories / explicitWeight, 3),
            proteinGramsPerUnit: roundToDecimal(proteinGrams / explicitWeight, 3),
            carbsGramsPerUnit: roundToDecimal(carbsGrams / explicitWeight, 3),
            fatGramsPerUnit: roundToDecimal(fatGrams / explicitWeight, 3)
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
    ...(note ? { notes: note } : {})
  });

  return {
    success: true,
    meal,
    message: `Logged meal "${meal.name}".`
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
    const exactMeal = meals.find((meal) => normalizeSearchText(meal.name) === needle);
    if (exactMeal) {
      target = exactMeal;
    } else {
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
    }
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

export interface PendingActionToolResponse {
  requiresConfirmation: true;
  pendingAction: ChatPendingAction;
  confirmationCommand: string;
  cancelCommand: string;
  message: string;
}

export interface ImmediateDeadlineActionResponse {
  success: true;
  requiresConfirmation: false;
  action: "complete" | "snooze";
  snoozeHours?: number;
  message: string;
  deadline: Deadline;
}

export interface ImmediateRoutinePresetActionResponse {
  success: true;
  requiresConfirmation: false;
  action: "create-routine-preset" | "update-routine-preset";
  message: string;
  routinePreset: RoutinePreset;
  placement: {
    createdEvents: number;
    clearedEvents: number;
  };
}

export interface PendingActionExecutionResult {
  actionId: string;
  actionType: ChatActionType;
  success: boolean;
  message: string;
  deadline?: Deadline;
  lecture?: LectureEvent;
  routinePreset?: RoutinePreset;
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

function clampFloat(value: unknown, fallback: number, min: number, max: number, precision = 1): number {
  const parsed = typeof value === "number" ? value : Number.NaN;
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  const clamped = Math.min(max, Math.max(min, parsed));
  return roundToDecimal(clamped, precision);
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
): PendingActionToolResponse | ImmediateDeadlineActionResponse | { error: string } {
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
    const updated = store.updateDeadline(deadline.id, { completed: true });
    if (!updated) {
      return { error: "Unable to complete deadline." };
    }

    return {
      success: true,
      requiresConfirmation: false,
      action: "complete",
      message: `Marked ${updated.course} ${updated.task} as completed.`,
      deadline: updated
    };
  }

  const snoozeHours = clampNumber(args.snoozeHours, 24, 1, 168);
  const dueDate = new Date(deadline.dueDate);
  if (Number.isNaN(dueDate.getTime())) {
    return { error: "Deadline due date is invalid." };
  }

  dueDate.setHours(dueDate.getHours() + snoozeHours);
  const updated = store.updateDeadline(deadline.id, { dueDate: dueDate.toISOString() });
  if (!updated) {
    return { error: "Unable to snooze deadline." };
  }

  return {
    success: true,
    requiresConfirmation: false,
    action: "snooze",
    snoozeHours,
    message: `Snoozed ${updated.course} ${updated.task} by ${snoozeHours} hours.`,
    deadline: updated
  };
}

export function handleCreateScheduleBlock(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; lecture: LectureEvent; message: string } | { error: string } {
  const title = asTrimmedString(args.title);
  const startTime = asTrimmedString(args.startTime);
  const workloadRaw = asTrimmedString(args.workload)?.toLowerCase();
  const durationMinutes = clampNumber(args.durationMinutes, 60, 15, 240);

  if (!title || !startTime) {
    return { error: "title and startTime are required." };
  }

  const startDate = parseFlexibleDateTime(startTime, new Date());
  if (!startDate) {
    return { error: "startTime must be a valid datetime (ISO or natural time like 'today 16:00')." };
  }

  const workload: LectureEvent["workload"] =
    workloadRaw === "low" || workloadRaw === "medium" || workloadRaw === "high" ? workloadRaw : "medium";

  const lecture = store.createLectureEvent({
    title,
    startTime: startDate.toISOString(),
    durationMinutes,
    workload
  });

  return {
    success: true,
    lecture,
    message: `Added "${lecture.title}" to your schedule.`
  };
}

export function handleUpdateScheduleBlock(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; lecture: LectureEvent; message: string } | { error: string } {
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
    const startDate = parseFlexibleDateTime(nextStartTime, new Date());
    if (!startDate) {
      return { error: "startTime must be a valid datetime (ISO or natural time like 'today 16:00')." };
    }
    normalizedStartTime = startDate.toISOString();
  }

  if (!nextTitle && !normalizedStartTime && !nextDurationMinutes && !nextWorkload) {
    return {
      error: "Provide at least one field to update: title, startTime, durationMinutes, or workload."
    };
  }

  const lecture = store.updateScheduleEvent(resolved.id, {
    ...(nextTitle ? { title: nextTitle } : {}),
    ...(normalizedStartTime ? { startTime: normalizedStartTime } : {}),
    ...(typeof nextDurationMinutes === "number" ? { durationMinutes: nextDurationMinutes } : {}),
    ...(nextWorkload ? { workload: nextWorkload } : {})
  });

  if (!lecture) {
    return { error: "Unable to update schedule block." };
  }

  return {
    success: true,
    lecture,
    message: `Updated "${lecture.title}" in your schedule.`
  };
}

export function handleDeleteScheduleBlock(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; deleted: boolean; scheduleId: string; message: string } | { error: string } {
  const resolved = resolveScheduleTarget(store, args);
  if ("error" in resolved) {
    return resolved;
  }

  const deleted = store.deleteScheduleEvent(resolved.id);
  if (!deleted) {
    return { error: "Unable to delete schedule block." };
  }

  return {
    success: true,
    deleted: true,
    scheduleId: resolved.id,
    message: `Deleted "${resolved.title}" from your schedule.`
  };
}

export function handleClearScheduleWindow(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; deletedCount: number; mutedSuggestions: boolean; message: string } | { error: string } {
  const now = new Date();
  const requestedStart = asTrimmedString(args.startTime);
  const requestedEnd = asTrimmedString(args.endTime);
  const titleQuery = asTrimmedString(args.titleQuery);
  const includeAcademicBlocks = args.includeAcademicBlocks === true;

  const startDate = requestedStart ? parseFlexibleDateTime(requestedStart, now) : new Date(now);
  if (!startDate) {
    return { error: "startTime must be a valid datetime." };
  }

  let endDate: Date;
  if (requestedEnd) {
    const parsedEnd = parseFlexibleDateTime(requestedEnd, startDate);
    if (!parsedEnd) {
      return { error: "endTime must be a valid datetime." };
    }
    endDate = parsedEnd;
  } else {
    endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 999);
  }

  if (endDate.getTime() <= startDate.getTime()) {
    return { error: "endTime must be after startTime." };
  }

  const normalizedQuery = titleQuery ? normalizeSearchText(titleQuery) : null;
  const matchingEvents = store
    .getScheduleEvents()
    .filter((event) => {
      const eventStart = new Date(event.startTime);
      if (Number.isNaN(eventStart.getTime())) {
        return false;
      }
      return eventStart.getTime() >= startDate.getTime() && eventStart.getTime() <= endDate.getTime();
    })
    .filter((event) => (normalizedQuery ? normalizeSearchText(event.title).includes(normalizedQuery) : true))
    .filter((event) => (includeAcademicBlocks ? true : !isAcademicScheduleBlockTitle(event.title)));

  let deletedCount = 0;
  for (const event of matchingEvents) {
    if (store.deleteScheduleEvent(event.id)) {
      deletedCount += 1;
    }
  }

  const mutedSuggestions = Boolean(
    store.createScheduleSuggestionMute({
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString()
    })
  );

  if (!mutedSuggestions && deletedCount === 0) {
    return { error: "No matching schedule blocks or timeline suggestions were found." };
  }

  const messageParts: string[] = [];
  if (deletedCount > 0) {
    messageParts.push(`Cleared ${deletedCount} schedule block${deletedCount === 1 ? "" : "s"}.`);
  }
  if (mutedSuggestions) {
    messageParts.push("Cleared timeline suggestions for that window.");
  }

  return {
    success: true,
    deletedCount,
    mutedSuggestions,
    message: messageParts.join(" ")
  };
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

  const startDate = parseFlexibleDateTime(startTime, new Date());
  if (!startDate) {
    return { error: "startTime must be a valid datetime." };
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
    const startDate = parseFlexibleDateTime(nextStartTime, new Date());
    if (!startDate) {
      return { error: "startTime must be a valid datetime." };
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

export function handleQueueDeleteScheduleBlock(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): PendingActionToolResponse | { error: string } {
  const resolved = resolveScheduleTarget(store, args);
  if ("error" in resolved) {
    return resolved;
  }

  const pending = store.createPendingChatAction({
    actionType: "delete-schedule-block",
    summary: `Delete schedule block "${resolved.title}"`,
    payload: {
      scheduleIds: [resolved.id]
    }
  });

  return toPendingActionResponse(pending, "Action queued. Ask user for explicit confirmation before executing.");
}

export function handleQueueClearScheduleWindow(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): PendingActionToolResponse | { error: string } {
  const now = new Date();
  const requestedStart = asTrimmedString(args.startTime);
  const requestedEnd = asTrimmedString(args.endTime);
  const titleQuery = asTrimmedString(args.titleQuery);
  const includeAcademicBlocks = args.includeAcademicBlocks === true;

  const startDate = requestedStart ? parseFlexibleDateTime(requestedStart, now) : new Date(now);
  if (!startDate) {
    return { error: "startTime must be a valid datetime." };
  }

  let endDate: Date;
  if (requestedEnd) {
    const parsedEnd = parseFlexibleDateTime(requestedEnd, startDate);
    if (!parsedEnd) {
      return { error: "endTime must be a valid datetime." };
    }
    endDate = parsedEnd;
  } else {
    endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 999);
  }

  if (endDate.getTime() <= startDate.getTime()) {
    return { error: "endTime must be after startTime." };
  }

  const normalizedQuery = titleQuery ? normalizeSearchText(titleQuery) : null;
  const matchingEvents = store
    .getScheduleEvents()
    .filter((event) => {
      const eventStart = new Date(event.startTime);
      if (Number.isNaN(eventStart.getTime())) {
        return false;
      }
      return eventStart.getTime() >= startDate.getTime() && eventStart.getTime() <= endDate.getTime();
    })
    .filter((event) => (normalizedQuery ? normalizeSearchText(event.title).includes(normalizedQuery) : true))
    .filter((event) => (includeAcademicBlocks ? true : !isAcademicScheduleBlockTitle(event.title)));

  const affectedCount = matchingEvents.length;
  const pending = store.createPendingChatAction({
    actionType: "clear-schedule-window",
    summary:
      affectedCount > 0
        ? `Clear ${affectedCount} schedule block${affectedCount === 1 ? "" : "s"} between ${startDate.toISOString()} and ${endDate.toISOString()}`
        : `Free timeline suggestions between ${startDate.toISOString()} and ${endDate.toISOString()}`,
    payload: {
      scheduleIds: matchingEvents.map((event) => event.id),
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      ...(titleQuery ? { titleQuery } : {}),
      includeAcademicBlocks
    }
  });

  return toPendingActionResponse(pending, "Action queued. Ask user for explicit confirmation before executing.");
}

export function handleQueueCreateRoutinePreset(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): ImmediateRoutinePresetActionResponse | { error: string } {
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

  const routinePreset = store.createRoutinePreset({
    title,
    preferredStartTime,
    durationMinutes,
    workload,
    weekdays,
    active: true
  });
  const placement = applyRoutinePresetPlacements(store, { horizonDays: 7 });

  return {
    success: true,
    requiresConfirmation: false,
    action: "create-routine-preset",
    message:
      `Created routine preset "${routinePreset.title}" and placed ${placement.createdEvents} routine blocks ` +
      `(cleared ${placement.clearedEvents}).`,
    routinePreset,
    placement
  };
}

export function handleQueueUpdateRoutinePreset(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): ImmediateRoutinePresetActionResponse | { error: string } {
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

  const patch: Partial<Omit<RoutinePreset, "id" | "createdAt" | "updatedAt">> = {};
  if (nextTitle) {
    patch.title = nextTitle;
  }
  if (nextPreferredStartTime) {
    patch.preferredStartTime = nextPreferredStartTime;
  }
  if (typeof nextDurationMinutes === "number") {
    patch.durationMinutes = nextDurationMinutes;
  }
  if (nextWorkload) {
    patch.workload = nextWorkload;
  }
  if (nextWeekdays) {
    patch.weekdays = nextWeekdays;
  }
  if (typeof nextActive === "boolean") {
    patch.active = nextActive;
  }

  const routinePreset = store.updateRoutinePreset(resolved.id, patch);
  if (!routinePreset) {
    return { error: "Unable to update routine preset." };
  }
  const placement = applyRoutinePresetPlacements(store, { horizonDays: 7 });

  return {
    success: true,
    requiresConfirmation: false,
    action: "update-routine-preset",
    message:
      `Updated routine preset "${routinePreset.title}" and re-applied routines ` +
      `(placed ${placement.createdEvents}, cleared ${placement.clearedEvents}).`,
    routinePreset,
    placement
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

      const startDate = parseFlexibleDateTime(startTime, new Date());
      if (!startDate) {
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
        const startDate = parseFlexibleDateTime(startTime, new Date());
        if (!startDate) {
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
    case "delete-schedule-block": {
      const scheduleIds = Array.isArray(pendingAction.payload.scheduleIds)
        ? pendingAction.payload.scheduleIds
            .map((entry) => asTrimmedString(entry))
            .filter((entry): entry is string => Boolean(entry))
        : [];

      if (scheduleIds.length === 0) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Invalid schedule delete payload."
        };
      }

      let deletedCount = 0;
      for (const scheduleId of new Set(scheduleIds)) {
        if (store.deleteScheduleEvent(scheduleId)) {
          deletedCount += 1;
        }
      }

      if (deletedCount === 0) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "No matching schedule blocks were deleted."
        };
      }

      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message: "Deleted the schedule block."
      };
    }
    case "clear-schedule-window": {
      const scheduleIds = Array.isArray(pendingAction.payload.scheduleIds)
        ? pendingAction.payload.scheduleIds
            .map((entry) => asTrimmedString(entry))
            .filter((entry): entry is string => Boolean(entry))
        : [];
      const startTime = asTrimmedString(pendingAction.payload.startTime);
      const endTime = asTrimmedString(pendingAction.payload.endTime);

      let deletedCount = 0;
      for (const scheduleId of new Set(scheduleIds)) {
        if (store.deleteScheduleEvent(scheduleId)) {
          deletedCount += 1;
        }
      }

      let mutedSuggestions = false;
      if (startTime && endTime) {
        mutedSuggestions = Boolean(
          store.createScheduleSuggestionMute({
            startTime,
            endTime
          })
        );
      }

      if (!mutedSuggestions && deletedCount === 0) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "No matching schedule blocks or timeline suggestions were found."
        };
      }

      const messageParts: string[] = [];
      if (deletedCount > 0) {
        messageParts.push(`Cleared ${deletedCount} schedule block${deletedCount === 1 ? "" : "s"}.`);
      }
      if (mutedSuggestions) {
        messageParts.push("Cleared timeline suggestions for that window.");
      }

      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message: messageParts.join(" ")
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
    case "getEmails":
      response = handleGetEmails(store, args);
      break;
    case "getWithingsHealthSummary":
      response = handleGetWithingsHealthSummary(store, args);
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
    case "getNutritionHistory":
      response = handleGetNutritionHistory(store, args);
      break;
    case "getNutritionTargets":
      response = handleGetNutritionTargets(store, args);
      break;
    case "updateNutritionTargets":
      response = handleUpdateNutritionTargets(store, args);
      break;
    case "getNutritionMeals":
      response = handleGetNutritionMeals(store, args);
      break;
    case "getNutritionPlanSnapshots":
      response = handleGetNutritionPlanSnapshots(store, args);
      break;
    case "saveNutritionPlanSnapshot":
      response = handleSaveNutritionPlanSnapshot(store, args);
      break;
    case "applyNutritionPlanSnapshot":
      response = handleApplyNutritionPlanSnapshot(store, args);
      break;
    case "deleteNutritionPlanSnapshot":
      response = handleDeleteNutritionPlanSnapshot(store, args);
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
    case "createNutritionMeal":
      response = handleCreateNutritionMeal(store, args);
      break;
    case "updateNutritionMeal":
      response = handleUpdateNutritionMeal(store, args);
      break;
    case "addNutritionMealItem":
      response = handleAddNutritionMealItem(store, args);
      break;
    case "updateNutritionMealItem":
      response = handleUpdateNutritionMealItem(store, args);
      break;
    case "removeNutritionMealItem":
      response = handleRemoveNutritionMealItem(store, args);
      break;
    case "moveNutritionMeal":
      response = handleMoveNutritionMeal(store, args);
      break;
    case "setNutritionMealOrder":
      response = handleSetNutritionMealOrder(store, args);
      break;
    case "logMeal":
      response = handleLogMeal(store, args);
      break;
    case "deleteMeal":
      response = handleDeleteMeal(store, args);
      break;
    case "getGitHubCourseContent":
      response = handleGetGitHubCourseContent(store, args);
      break;
    case "queueDeadlineAction":
      response = handleQueueDeadlineAction(store, args);
      break;
    case "createScheduleBlock":
      response = handleCreateScheduleBlock(store, args);
      break;
    case "updateScheduleBlock":
      response = handleUpdateScheduleBlock(store, args);
      break;
    case "deleteScheduleBlock":
      response = handleDeleteScheduleBlock(store, args);
      break;
    case "clearScheduleWindow":
      response = handleClearScheduleWindow(store, args);
      break;
    case "queueScheduleBlock":
      response = handleQueueScheduleBlock(store, args);
      break;
    case "queueUpdateScheduleBlock":
      response = handleQueueUpdateScheduleBlock(store, args);
      break;
    case "queueDeleteScheduleBlock":
      response = handleQueueDeleteScheduleBlock(store, args);
      break;
    case "queueClearScheduleWindow":
      response = handleQueueClearScheduleWindow(store, args);
      break;
    case "queueCreateRoutinePreset":
      response = handleQueueCreateRoutinePreset(store, args);
      break;
    case "queueUpdateRoutinePreset":
      response = handleQueueUpdateRoutinePreset(store, args);
      break;
    case "setResponseMood": {
      const validMoodSet = new Set(["neutral", "encouraging", "focused", "celebratory", "empathetic", "urgent"]);
      const rawMood = typeof args.mood === "string" ? args.mood.toLowerCase().trim() : "neutral";
      const mood = validMoodSet.has(rawMood) ? rawMood : "neutral";
      console.log(`[mood] setResponseMood called: raw="${String(args.mood)}" → resolved="${mood}"`);
      response = { mood };
      break;
    }
    default:
      throw new Error(`Unknown function: ${name}`);
  }

  return { name, response };
}
