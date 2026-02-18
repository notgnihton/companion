import { describe, it, expect, beforeEach } from "vitest";
import {
  functionDeclarations,
  handleGetSchedule,
  handleGetRoutinePresets,
  handleGetDeadlines,
  handleSearchJournal,
  handleGetEmails,
  handleGetSocialDigest,
  handleGetHabitsGoalsStatus,
  handleUpdateHabitCheckIn,
  handleUpdateGoalCheckIn,
  handleCreateHabit,
  handleDeleteHabit,
  handleCreateGoal,
  handleDeleteGoal,
  handleGetNutritionSummary,
  handleGetNutritionCustomFoods,
  handleCreateNutritionCustomFood,
  handleUpdateNutritionCustomFood,
  handleDeleteNutritionCustomFood,
  handleLogMeal,
  handleDeleteMeal,
  handleGetGitHubCourseContent,
  handleQueueDeadlineAction,
  handleQueueScheduleBlock,
  handleQueueUpdateScheduleBlock,
  handleQueueDeleteScheduleBlock,
  handleQueueClearScheduleWindow,
  handleQueueCreateRoutinePreset,
  handleQueueUpdateRoutinePreset,
  handleCreateJournalEntry,
  executePendingChatAction,
  executeFunctionCall
} from "./gemini-tools.js";
import { RuntimeStore } from "./store.js";

describe("gemini-tools", () => {
  let store: RuntimeStore;
  const testDbPath = ":memory:";

  beforeEach(() => {
    store = new RuntimeStore(testDbPath);
  });

  describe("functionDeclarations", () => {
    it("should define 29 function declarations", () => {
      expect(functionDeclarations).toHaveLength(29);
    });

    it("should include getSchedule function", () => {
      const getSchedule = functionDeclarations.find((f) => f.name === "getSchedule");
      expect(getSchedule).toBeDefined();
      expect(getSchedule?.description).toContain("schedule");
    });

    it("should include routine preset functions", () => {
      expect(functionDeclarations.find((f) => f.name === "getRoutinePresets")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "queueCreateRoutinePreset")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "queueUpdateRoutinePreset")).toBeDefined();
    });

    it("should include getDeadlines function", () => {
      const getDeadlines = functionDeclarations.find((f) => f.name === "getDeadlines");
      expect(getDeadlines).toBeDefined();
      expect(getDeadlines?.description).toContain("deadline");
    });

    it("should include searchJournal function", () => {
      const searchJournal = functionDeclarations.find((f) => f.name === "searchJournal");
      expect(searchJournal).toBeDefined();
      expect(searchJournal?.description).toContain("journal");
    });

    it("should include getEmails function", () => {
      const getEmails = functionDeclarations.find((f) => f.name === "getEmails");
      expect(getEmails).toBeDefined();
      expect(getEmails?.description).toContain("email");
    });

    it("should include getSocialDigest function", () => {
      const getSocialDigest = functionDeclarations.find((f) => f.name === "getSocialDigest");
      expect(getSocialDigest).toBeDefined();
      expect(getSocialDigest?.description).toContain("social media");
    });

    it("should include habits and goals functions", () => {
      expect(functionDeclarations.find((f) => f.name === "getHabitsGoalsStatus")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "updateHabitCheckIn")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "updateGoalCheckIn")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "createHabit")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "deleteHabit")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "createGoal")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "deleteGoal")).toBeDefined();
    });

    it("should include nutrition functions", () => {
      expect(functionDeclarations.find((f) => f.name === "getNutritionSummary")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "getNutritionCustomFoods")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "createNutritionCustomFood")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "updateNutritionCustomFood")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "deleteNutritionCustomFood")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "logMeal")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "deleteMeal")).toBeDefined();
    });

    it("should include getGitHubCourseContent function", () => {
      const getGitHubCourseContent = functionDeclarations.find((f) => f.name === "getGitHubCourseContent");
      expect(getGitHubCourseContent).toBeDefined();
      expect(getGitHubCourseContent?.description).toContain("GitHub");
    });

    it("should include queue action functions", () => {
      expect(functionDeclarations.find((f) => f.name === "queueDeadlineAction")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "queueScheduleBlock")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "queueUpdateScheduleBlock")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "queueDeleteScheduleBlock")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "queueClearScheduleWindow")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "queueCreateRoutinePreset")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "queueUpdateRoutinePreset")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "createJournalEntry")).toBeDefined();
    });
  });

  describe("handleGetSchedule", () => {
    it("should return today's schedule events", () => {
      const today = new Date();
      today.setHours(10, 0, 0, 0);

      const event = store.createLectureEvent({
        title: "DAT520 Lecture",
        startTime: today.toISOString(),
        durationMinutes: 90,
        workload: "medium"
      });

      const result = handleGetSchedule(store);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(event.id);
      expect(result[0]?.title).toBe("DAT520 Lecture");
    });

    it("should return empty array if no events today", () => {
      const result = handleGetSchedule(store);
      expect(result).toEqual([]);
    });
  });

  describe("handleGetRoutinePresets", () => {
    it("returns configured routine presets", () => {
      store.createRoutinePreset({
        title: "Morning gym",
        preferredStartTime: "07:00",
        durationMinutes: 60,
        workload: "medium",
        weekdays: [1, 3, 5],
        active: true
      });

      const result = handleGetRoutinePresets(store);
      expect(result).toHaveLength(1);
      expect(result[0]?.title).toBe("Morning gym");
    });
  });

  describe("handleGetDeadlines", () => {
    it("should return upcoming deadlines within default 30 days", () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const deadline = store.createDeadline({
        course: "DAT520",
        task: "Assignment 1",
        dueDate: tomorrow.toISOString(),
        priority: "high",
        completed: false
      });

      const result = handleGetDeadlines(store);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.id).toBe(deadline.id);
    });

    it("filters out completed deadlines by default", () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      store.createDeadline({
        course: "DAT520",
        task: "Completed assignment",
        dueDate: tomorrow.toISOString(),
        priority: "high",
        completed: true
      });

      const active = store.createDeadline({
        course: "DAT560",
        task: "Active assignment",
        dueDate: tomorrow.toISOString(),
        priority: "high",
        completed: false
      });

      const result = handleGetDeadlines(store);
      expect(result.map((item) => item.id)).toContain(active.id);
      expect(result.some((item) => item.task.includes("Completed assignment"))).toBe(false);
    });

    it("should respect daysAhead parameter", () => {
      const farFuture = new Date();
      farFuture.setDate(farFuture.getDate() + 20);

      const deadline = store.createDeadline({
        course: "DAT520",
        task: "Assignment 1",
        dueDate: farFuture.toISOString(),
        priority: "high",
        completed: false
      });

      const result7Days = handleGetDeadlines(store, { daysAhead: 7 });
      const result30Days = handleGetDeadlines(store, { daysAhead: 30 });

      expect(result7Days).toHaveLength(0);
      expect(result30Days.length).toBeGreaterThan(0);
    });

    it("should filter out past deadlines", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const deadline = store.createDeadline({
        course: "DAT520",
        task: "Assignment 1",
        dueDate: yesterday.toISOString(),
        priority: "high",
        completed: false
      });

      const result = handleGetDeadlines(store);
      expect(result).toHaveLength(0);
    });

    it("supports courseCode filtering for DAT520/DAT560 queries", () => {
      const soon = new Date();
      soon.setDate(soon.getDate() + 3);

      const dat520 = store.createDeadline({
        course: "DAT520-1 26V",
        task: "Assignment 3",
        dueDate: soon.toISOString(),
        priority: "high",
        completed: false
      });

      store.createDeadline({
        course: "DAT560-1 26V",
        task: "Assignment 2",
        dueDate: soon.toISOString(),
        priority: "high",
        completed: false
      });

      const result = handleGetDeadlines(store, { courseCode: "DAT520", daysAhead: 30 });
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(dat520.id);
    });
  });

  describe("handleSearchJournal", () => {
    it("should search journal entries by query", () => {
      store.recordJournalEntry("Today I worked on distributed systems");
      store.recordJournalEntry("Machine learning assignment completed");

      const result = handleSearchJournal(store, { query: "distributed", limit: 10 });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.content).toContain("distributed");
    });

    it("should return recent entries when no query provided", () => {
      store.recordJournalEntry("Entry 1");

      const result = handleSearchJournal(store, { limit: 5 });
      expect(result.length).toBeGreaterThan(0);
    });

    it("should respect limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        store.recordJournalEntry(`Entry ${i}`);
      }

      const result = handleSearchJournal(store, { limit: 3 });
      expect(result.length).toBeLessThanOrEqual(3);
    });
  });

  describe("handleGetEmails", () => {
    it("returns synced Gmail messages (not local digest records)", () => {
      store.recordEmailDigest({
        type: "daily",
        reason: "inactivity",
        recipient: "lucy@example.com",
        subject: "Companion daily digest",
        body: "Digest body",
        timeframeStart: "2026-02-17T00:00:00.000Z",
        timeframeEnd: "2026-02-17T23:59:59.000Z"
      });
      store.setGmailMessages(
        [
          {
            id: "gmail-1",
            from: "course@uis.no",
            subject: "DAT560 Assignment 2 feedback",
            snippet: "Great progress. Please improve section 3.",
            receivedAt: "2026-02-17T11:00:00.000Z",
            labels: ["INBOX", "UNREAD"],
            isRead: false
          }
        ],
        "2026-02-17T11:05:00.000Z"
      );

      const result = handleGetEmails(store);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]?.subject).toBe("DAT560 Assignment 2 feedback");
    });

    it("respects limit and unreadOnly parameters", () => {
      store.setGmailMessages(
        [
          {
            id: "gmail-older",
            from: "a@uis.no",
            subject: "Older read email",
            snippet: "Already read",
            receivedAt: "2026-02-17T08:00:00.000Z",
            labels: ["INBOX"],
            isRead: true
          },
          {
            id: "gmail-newer",
            from: "b@uis.no",
            subject: "Newest unread email",
            snippet: "Unread details",
            receivedAt: "2026-02-17T12:00:00.000Z",
            labels: ["INBOX", "UNREAD"],
            isRead: false
          }
        ],
        "2026-02-17T12:05:00.000Z"
      );

      const result = handleGetEmails(store, { limit: 1, unreadOnly: true });
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("gmail-newer");
    });
  });

  describe("handleGetSocialDigest", () => {
    it("should return social media digest structure", () => {
      const result = handleGetSocialDigest(store);

      expect(result).toHaveProperty("youtube");
      expect(result).toHaveProperty("x");
      expect(result.youtube).toHaveProperty("videos");
      expect(result.youtube).toHaveProperty("total");
      expect(result.x).toHaveProperty("tweets");
      expect(result.x).toHaveProperty("total");
    });

    it("should filter by daysBack parameter", () => {
      const result = handleGetSocialDigest(store, { daysBack: 7 });

      expect(result).toHaveProperty("youtube");
      expect(result).toHaveProperty("x");
    });
  });

  describe("habits and goals handlers", () => {
    it("returns habits/goals status summary", () => {
      const habit = store.createHabit({
        name: "Unit Test Habit",
        cadence: "daily",
        targetPerWeek: 6
      });
      const goal = store.createGoal({
        title: "Unit Test Goal",
        cadence: "weekly",
        targetCount: 3,
        dueDate: null
      });

      const result = handleGetHabitsGoalsStatus(store);
      expect(result.habits.some((item) => item.id === habit.id)).toBe(true);
      expect(result.goals.some((item) => item.id === goal.id)).toBe(true);
      expect(result.summary.habitsTotal).toBe(result.habits.length);
      expect(result.summary.goalsTotal).toBe(result.goals.length);
    });

    it("updates a habit check-in by habitName", () => {
      store.createHabit({
        name: "Unit Test Habit Checkin",
        cadence: "daily",
        targetPerWeek: 6
      });

      const result = handleUpdateHabitCheckIn(store, {
        habitName: "unit test habit checkin",
        completed: true
      });

      if ("error" in result) {
        throw new Error(result.error);
      }

      expect(result.success).toBe(true);
      expect(result.habit.todayCompleted).toBe(true);
      expect(result.message).toContain("Checked in habit");
    });

    it("updates a goal check-in by goalTitle", () => {
      store.createGoal({
        title: "Ship DAT520 Lab 4",
        cadence: "weekly",
        targetCount: 4,
        dueDate: null
      });

      const result = handleUpdateGoalCheckIn(store, {
        goalTitle: "lab 4",
        completed: true
      });

      if ("error" in result) {
        throw new Error(result.error);
      }

      expect(result.success).toBe(true);
      expect(result.goal.todayCompleted).toBe(true);
      expect(result.message).toContain("Logged progress");
    });

    it("creates a habit from empty state", () => {
      const result = handleCreateHabit(store, {
        name: "Deep work",
        cadence: "daily",
        targetPerWeek: 5
      });

      if ("error" in result) {
        throw new Error(result.error);
      }

      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      expect(result.habit.name).toBe("Deep work");
      expect(store.getHabitsWithStatus().length).toBe(1);
    });

    it("returns non-deleted success when deleting habit with empty state", () => {
      const result = handleDeleteHabit(store, {
        habitName: "study sprint"
      });

      if ("error" in result) {
        throw new Error(result.error);
      }

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(false);
      expect(result.message).toContain("No habits");
    });

    it("creates and deletes a goal", () => {
      const created = handleCreateGoal(store, {
        title: "Finish DAT560 lab",
        cadence: "weekly",
        targetCount: 2
      });

      if ("error" in created) {
        throw new Error(created.error);
      }

      expect(created.success).toBe(true);
      expect(created.created).toBe(true);

      const deleted = handleDeleteGoal(store, {
        goalTitle: "dat560 lab"
      });

      if ("error" in deleted) {
        throw new Error(deleted.error);
      }

      expect(deleted.success).toBe(true);
      expect(deleted.deleted).toBe(true);
      expect(store.getGoalsWithStatus()).toHaveLength(0);
    });
  });

  describe("nutrition handlers", () => {
    it("returns daily nutrition summary", () => {
      store.createNutritionMeal({
        name: "Overnight oats",
        mealType: "breakfast",
        consumedAt: "2026-02-17T07:30:00.000Z",
        calories: 480,
        proteinGrams: 28,
        carbsGrams: 62,
        fatGrams: 14
      });

      const result = handleGetNutritionSummary(store, { date: "2026-02-17" });
      expect(result.mealsLogged).toBe(1);
      expect(result.totals.calories).toBe(480);
    });

    it("logs and deletes meals", () => {
      const logged = handleLogMeal(store, {
        name: "Chicken wrap",
        mealType: "lunch",
        calories: 640,
        proteinGrams: 44,
        carbsGrams: 58,
        fatGrams: 18
      });

      if ("error" in logged) {
        throw new Error(logged.error);
      }

      expect(logged.success).toBe(true);
      expect(logged.meal.name).toBe("Chicken wrap");

      const deleted = handleDeleteMeal(store, { mealId: logged.meal.id });
      if ("error" in deleted) {
        throw new Error(deleted.error);
      }
      expect(deleted.deleted).toBe(true);
    });

    it("creates, lists, updates, and deletes custom foods", () => {
      const created = handleCreateNutritionCustomFood(store, {
        name: "Whey isolate",
        unitLabel: "scoop",
        caloriesPerUnit: 110,
        proteinGramsPerUnit: 25,
        carbsGramsPerUnit: 2,
        fatGramsPerUnit: 1
      });

      if ("error" in created) {
        throw new Error(created.error);
      }
      expect(created.success).toBe(true);
      expect(created.food.name).toBe("Whey isolate");

      const listed = handleGetNutritionCustomFoods(store, { query: "whey" });
      expect(listed.foods).toHaveLength(1);
      expect(listed.foods[0]?.id).toBe(created.food.id);

      const updated = handleUpdateNutritionCustomFood(store, {
        customFoodId: created.food.id,
        caloriesPerUnit: 115
      });
      if ("error" in updated) {
        throw new Error(updated.error);
      }
      expect(updated.food.caloriesPerUnit).toBe(115);

      const deleted = handleDeleteNutritionCustomFood(store, {
        customFoodId: created.food.id
      });
      if ("error" in deleted) {
        throw new Error(deleted.error);
      }
      expect(deleted.deleted).toBe(true);
    });

    it("logs meal from custom food with servings multiplier", () => {
      const created = handleCreateNutritionCustomFood(store, {
        name: "Greek yogurt",
        unitLabel: "cup",
        caloriesPerUnit: 150,
        proteinGramsPerUnit: 20,
        carbsGramsPerUnit: 9,
        fatGramsPerUnit: 4
      });
      if ("error" in created) {
        throw new Error(created.error);
      }

      const logged = handleLogMeal(store, {
        customFoodId: created.food.id,
        servings: 1.5,
        mealType: "snack"
      });
      if ("error" in logged) {
        throw new Error(logged.error);
      }

      expect(logged.success).toBe(true);
      expect(logged.meal.name).toBe("Greek yogurt");
      expect(logged.meal.calories).toBe(225);
      expect(logged.meal.proteinGrams).toBe(30);
      expect(logged.meal.carbsGrams).toBe(13.5);
      expect(logged.meal.fatGrams).toBe(6);
    });

  });

  describe("handleGetGitHubCourseContent", () => {
    it("returns empty array when no GitHub data is synced", () => {
      const result = handleGetGitHubCourseContent(store);
      expect(result).toEqual([]);
    });

    it("filters GitHub docs by course code and query terms", () => {
      const now = new Date().toISOString();
      store.setGitHubCourseData({
        repositories: [
          { owner: "dat560-2026", repo: "info", courseCode: "DAT560" },
          { owner: "dat520-2026", repo: "assignments", courseCode: "DAT520" }
        ],
        documents: [
          {
            id: "doc-dat560-syllabus",
            courseCode: "DAT560",
            owner: "dat560-2026",
            repo: "info",
            path: "docs/syllabus.md",
            url: "https://github.com/dat560-2026/info/blob/HEAD/docs/syllabus.md",
            title: "DAT560 Syllabus",
            summary: "Project deliverables and grading details.",
            highlights: ["Project milestone deadlines", "Exam policy"],
            snippet: "Project deliverables: proposal, implementation, report.",
            syncedAt: now
          },
          {
            id: "doc-dat520-lab",
            courseCode: "DAT520",
            owner: "dat520-2026",
            repo: "assignments",
            path: "labs/lab-1.md",
            url: "https://github.com/dat520-2026/assignments/blob/HEAD/labs/lab-1.md",
            title: "Lab 1",
            summary: "Raft implementation details.",
            highlights: ["Leader election"],
            snippet: "Implement RPC handlers.",
            syncedAt: now
          }
        ],
        deadlinesSynced: 2,
        lastSyncedAt: now
      });

      const result = handleGetGitHubCourseContent(store, {
        courseCode: "dat560",
        query: "deliverables",
        limit: 5
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("doc-dat560-syllabus");
    });
  });

  describe("queue action handlers", () => {
    it("queues a deadline completion action", () => {
      const deadline = store.createDeadline({
        course: "DAT560",
        task: "Assignment 2",
        dueDate: "2026-02-20T12:00:00.000Z",
        priority: "high",
        completed: false
      });

      const result = handleQueueDeadlineAction(store, {
        deadlineId: deadline.id,
        action: "complete"
      });

      expect(result).toHaveProperty("requiresConfirmation", true);
      if (!("pendingAction" in result)) {
        throw new Error("Expected pendingAction in queue result");
      }

      expect(result.pendingAction.actionType).toBe("complete-deadline");
      expect(result.confirmationCommand).toContain(`confirm ${result.pendingAction.id}`);
      expect(store.getPendingChatActions()).toHaveLength(1);
    });

    it("queues a schedule block action", () => {
      const result = handleQueueScheduleBlock(store, {
        title: "DAT520 revision",
        startTime: "2026-02-18T13:00:00.000Z",
        durationMinutes: 90,
        workload: "high"
      });

      expect(result).toHaveProperty("requiresConfirmation", true);
      if (!("pendingAction" in result)) {
        throw new Error("Expected pendingAction in queue result");
      }

      expect(result.pendingAction.actionType).toBe("create-schedule-block");
      expect(store.getPendingChatActions()).toHaveLength(1);
    });

    it("queues a schedule block update action", () => {
      const scheduleBlock = store.createLectureEvent({
        title: "Gym",
        startTime: "2026-02-18T07:00:00.000Z",
        durationMinutes: 60,
        workload: "medium"
      });

      const result = handleQueueUpdateScheduleBlock(store, {
        scheduleId: scheduleBlock.id,
        startTime: "2026-02-18T08:00:00.000Z"
      });

      expect(result).toHaveProperty("requiresConfirmation", true);
      if (!("pendingAction" in result)) {
        throw new Error("Expected pendingAction in queue result");
      }

      expect(result.pendingAction.actionType).toBe("update-schedule-block");
      expect(store.getPendingChatActions()).toHaveLength(1);
    });

    it("queues a schedule block delete action", () => {
      const scheduleBlock = store.createLectureEvent({
        title: "Optional focus block",
        startTime: "2026-02-18T18:00:00.000Z",
        durationMinutes: 60,
        workload: "medium"
      });

      const result = handleQueueDeleteScheduleBlock(store, {
        scheduleId: scheduleBlock.id
      });

      expect(result).toHaveProperty("requiresConfirmation", true);
      if (!("pendingAction" in result)) {
        throw new Error("Expected pendingAction in queue result");
      }

      expect(result.pendingAction.actionType).toBe("delete-schedule-block");
      expect(store.getPendingChatActions()).toHaveLength(1);
    });

    it("queues clear schedule window while preserving classes by default", () => {
      store.createLectureEvent({
        title: "DAT520 Lecture",
        startTime: "2026-02-18T10:00:00.000Z",
        durationMinutes: 90,
        workload: "medium"
      });
      const optionalBlock = store.createLectureEvent({
        title: "Project deep work",
        startTime: "2026-02-18T13:00:00.000Z",
        durationMinutes: 90,
        workload: "high"
      });

      const result = handleQueueClearScheduleWindow(store, {
        startTime: "2026-02-18T00:00:00.000Z",
        endTime: "2026-02-18T23:59:59.999Z"
      });

      expect(result).toHaveProperty("requiresConfirmation", true);
      if (!("pendingAction" in result)) {
        throw new Error("Expected pendingAction in clear-window result");
      }

      const scheduleIds = result.pendingAction.payload.scheduleIds as string[];
      expect(result.pendingAction.actionType).toBe("clear-schedule-window");
      expect(scheduleIds).toContain(optionalBlock.id);
      expect(scheduleIds.length).toBe(1);
    });

    it("queues routine preset create and update actions", () => {
      const createResult = handleQueueCreateRoutinePreset(store, {
        title: "Morning gym",
        preferredStartTime: "07:00",
        durationMinutes: 60,
        weekdays: [1, 3, 5]
      });

      expect(createResult).toHaveProperty("requiresConfirmation", true);
      if (!("pendingAction" in createResult)) {
        throw new Error("Expected pendingAction in routine create result");
      }
      expect(createResult.pendingAction.actionType).toBe("create-routine-preset");

      const preset = store.createRoutinePreset({
        title: "Nightly review",
        preferredStartTime: "21:00",
        durationMinutes: 45,
        workload: "low",
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        active: true
      });

      const updateResult = handleQueueUpdateRoutinePreset(store, {
        presetId: preset.id,
        preferredStartTime: "20:30",
        active: false
      });

      expect(updateResult).toHaveProperty("requiresConfirmation", true);
      if (!("pendingAction" in updateResult)) {
        throw new Error("Expected pendingAction in routine update result");
      }
      expect(updateResult.pendingAction.actionType).toBe("update-routine-preset");
    });

    it("creates a journal entry immediately", () => {
      const result = handleCreateJournalEntry(store, {
        content: "Draft reflection about today's lab."
      });

      if (!("success" in result)) {
        throw new Error("Expected success response for journal create");
      }

      expect(result.success).toBe(true);
      expect(result.entry.content).toContain("Draft reflection");
      expect(store.getPendingChatActions()).toHaveLength(0);
    });
  });

  describe("executePendingChatAction", () => {
    it("executes queued deadline completion", () => {
      const deadline = store.createDeadline({
        course: "DAT560",
        task: "Assignment 3",
        dueDate: "2026-02-21T12:00:00.000Z",
        priority: "high",
        completed: false
      });
      const pending = store.createPendingChatAction({
        actionType: "complete-deadline",
        summary: "Complete deadline",
        payload: { deadlineId: deadline.id }
      });

      const result = executePendingChatAction(pending, store);

      expect(result.success).toBe(true);
      expect(result.deadline?.completed).toBe(true);
    });

    it("executes queued schedule block creation", () => {
      const pending = store.createPendingChatAction({
        actionType: "create-schedule-block",
        summary: "Create DAT600 block",
        payload: {
          title: "DAT600 writing",
          startTime: "2026-02-22T09:00:00.000Z",
          durationMinutes: 60,
          workload: "medium"
        }
      });

      const result = executePendingChatAction(pending, store);

      expect(result.success).toBe(true);
      expect(result.lecture?.title).toContain("DAT600");
    });

    it("executes queued schedule block update", () => {
      const scheduleBlock = store.createLectureEvent({
        title: "Morning gym",
        startTime: "2026-02-22T07:00:00.000Z",
        durationMinutes: 60,
        workload: "medium"
      });

      const pending = store.createPendingChatAction({
        actionType: "update-schedule-block",
        summary: "Move morning gym to 08:00",
        payload: {
          scheduleId: scheduleBlock.id,
          startTime: "2026-02-22T08:00:00.000Z",
          durationMinutes: 75
        }
      });

      const result = executePendingChatAction(pending, store);

      expect(result.success).toBe(true);
      expect(result.lecture?.startTime).toContain("T08:00:00.000Z");
      expect(result.lecture?.durationMinutes).toBe(75);
    });

    it("executes queued clear schedule window action", () => {
      const blockA = store.createLectureEvent({
        title: "Optional deep work",
        startTime: "2026-02-22T15:00:00.000Z",
        durationMinutes: 60,
        workload: "medium"
      });
      const blockB = store.createLectureEvent({
        title: "Gym",
        startTime: "2026-02-22T17:00:00.000Z",
        durationMinutes: 60,
        workload: "medium"
      });

      const pending = store.createPendingChatAction({
        actionType: "clear-schedule-window",
        summary: "Clear the evening",
        payload: {
          scheduleIds: [blockA.id, blockB.id]
        }
      });

      const result = executePendingChatAction(pending, store);
      expect(result.success).toBe(true);
      expect(result.message).toContain("Cleared 2 schedule blocks");
      expect(store.getScheduleEventById(blockA.id)).toBeNull();
      expect(store.getScheduleEventById(blockB.id)).toBeNull();
    });

    it("executes queued routine preset create and update", () => {
      const createPending = store.createPendingChatAction({
        actionType: "create-routine-preset",
        summary: "Create morning gym preset",
        payload: {
          title: "Morning gym",
          preferredStartTime: "07:00",
          durationMinutes: 60,
          workload: "medium",
          weekdays: [1, 2, 3, 4, 5]
        }
      });

      const created = executePendingChatAction(createPending, store);
      expect(created.success).toBe(true);
      expect(created.routinePreset?.title).toBe("Morning gym");

      const updatePending = store.createPendingChatAction({
        actionType: "update-routine-preset",
        summary: "Update morning gym preset",
        payload: {
          presetId: created.routinePreset?.id,
          preferredStartTime: "08:00"
        }
      });

      const updated = executePendingChatAction(updatePending, store);
      expect(updated.success).toBe(true);
      expect(updated.routinePreset?.preferredStartTime).toBe("08:00");
    });
  });

  describe("executeFunctionCall", () => {
    it("should execute getSchedule function", () => {
      const result = executeFunctionCall("getSchedule", {}, store);

      expect(result.name).toBe("getSchedule");
      expect(Array.isArray(result.response)).toBe(true);
    });

    it("should execute getRoutinePresets function", () => {
      const result = executeFunctionCall("getRoutinePresets", {}, store);

      expect(result.name).toBe("getRoutinePresets");
      expect(Array.isArray(result.response)).toBe(true);
    });

    it("should execute getDeadlines function", () => {
      const result = executeFunctionCall("getDeadlines", { daysAhead: 7 }, store);

      expect(result.name).toBe("getDeadlines");
      expect(Array.isArray(result.response)).toBe(true);
    });

    it("should execute searchJournal function", () => {
      const result = executeFunctionCall("searchJournal", { query: "test", limit: 5 }, store);

      expect(result.name).toBe("searchJournal");
      expect(Array.isArray(result.response)).toBe(true);
    });

    it("should execute getEmails function", () => {
      const result = executeFunctionCall("getEmails", { limit: 5 }, store);

      expect(result.name).toBe("getEmails");
      expect(Array.isArray(result.response)).toBe(true);
    });

    it("should execute getSocialDigest function", () => {
      const result = executeFunctionCall("getSocialDigest", { daysBack: 3 }, store);

      expect(result.name).toBe("getSocialDigest");
      expect(result.response).toHaveProperty("youtube");
      expect(result.response).toHaveProperty("x");
    });

    it("should execute getHabitsGoalsStatus function", () => {
      const result = executeFunctionCall("getHabitsGoalsStatus", {}, store);

      expect(result.name).toBe("getHabitsGoalsStatus");
      expect(result.response).toHaveProperty("habits");
      expect(result.response).toHaveProperty("goals");
    });

    it("should execute updateHabitCheckIn function", () => {
      const habit = store.createHabit({
        name: "Study sprint",
        cadence: "daily",
        targetPerWeek: 5
      });
      const result = executeFunctionCall("updateHabitCheckIn", { habitId: habit.id, completed: true }, store);

      expect(result.name).toBe("updateHabitCheckIn");
      expect(result.response).toHaveProperty("success", true);
    });

    it("should execute updateGoalCheckIn function", () => {
      const goal = store.createGoal({
        title: "Ship DAT560 assignment",
        cadence: "weekly",
        targetCount: 3,
        dueDate: null
      });
      const result = executeFunctionCall("updateGoalCheckIn", { goalId: goal.id, completed: true }, store);

      expect(result.name).toBe("updateGoalCheckIn");
      expect(result.response).toHaveProperty("success", true);
    });

    it("should execute createHabit function", () => {
      const result = executeFunctionCall("createHabit", { name: "Read papers" }, store);

      expect(result.name).toBe("createHabit");
      expect(result.response).toHaveProperty("success", true);
    });

    it("should execute deleteHabit function", () => {
      const habit = store.createHabit({
        name: "Morning planning",
        cadence: "daily",
        targetPerWeek: 5
      });
      const result = executeFunctionCall("deleteHabit", { habitId: habit.id }, store);

      expect(result.name).toBe("deleteHabit");
      expect(result.response).toHaveProperty("success", true);
      expect(result.response).toHaveProperty("deleted", true);
    });

    it("should execute createGoal function", () => {
      const result = executeFunctionCall("createGoal", { title: "Finish report" }, store);

      expect(result.name).toBe("createGoal");
      expect(result.response).toHaveProperty("success", true);
    });

    it("should execute deleteGoal function", () => {
      const goal = store.createGoal({
        title: "Submit assignment",
        cadence: "weekly",
        targetCount: 1,
        dueDate: null
      });
      const result = executeFunctionCall("deleteGoal", { goalId: goal.id }, store);

      expect(result.name).toBe("deleteGoal");
      expect(result.response).toHaveProperty("success", true);
      expect(result.response).toHaveProperty("deleted", true);
    });

    it("should execute getNutritionSummary function", () => {
      const result = executeFunctionCall("getNutritionSummary", { date: "2026-02-17" }, store);

      expect(result.name).toBe("getNutritionSummary");
      expect(result.response).toHaveProperty("totals");
    });

    it("should execute custom food nutrition functions", () => {
      const created = executeFunctionCall(
        "createNutritionCustomFood",
        { name: "Banana", unitLabel: "piece", caloriesPerUnit: 105, carbsGramsPerUnit: 27 },
        store
      );
      expect(created.name).toBe("createNutritionCustomFood");
      expect(created.response).toHaveProperty("success", true);
      const createdFoodId = (created.response as { food?: { id?: string } }).food?.id;
      expect(createdFoodId).toBeDefined();
      if (!createdFoodId) {
        throw new Error("Expected created custom food id");
      }

      const listed = executeFunctionCall("getNutritionCustomFoods", { query: "banana" }, store);
      expect(listed.name).toBe("getNutritionCustomFoods");
      expect(listed.response).toHaveProperty("foods");

      const updated = executeFunctionCall(
        "updateNutritionCustomFood",
        { customFoodId: createdFoodId, proteinGramsPerUnit: 1.3 },
        store
      );
      expect(updated.name).toBe("updateNutritionCustomFood");
      expect(updated.response).toHaveProperty("success", true);

      const deleted = executeFunctionCall("deleteNutritionCustomFood", { customFoodId: createdFoodId }, store);
      expect(deleted.name).toBe("deleteNutritionCustomFood");
      expect(deleted.response).toHaveProperty("deleted", true);
    });

    it("should execute logMeal function", () => {
      const result = executeFunctionCall(
        "logMeal",
        { name: "Protein smoothie", calories: 320, proteinGrams: 32, carbsGrams: 24, fatGrams: 8 },
        store
      );

      expect(result.name).toBe("logMeal");
      expect(result.response).toHaveProperty("success", true);
    });

    it("should execute getGitHubCourseContent function", () => {
      const now = new Date().toISOString();
      store.setGitHubCourseData({
        repositories: [{ owner: "dat560-2026", repo: "info", courseCode: "DAT560" }],
        documents: [
          {
            id: "doc-dat560",
            courseCode: "DAT560",
            owner: "dat560-2026",
            repo: "info",
            path: "README.md",
            url: "https://github.com/dat560-2026/info/blob/HEAD/README.md",
            title: "Course Info",
            summary: "Overview",
            highlights: ["Deliverables"],
            snippet: "Course overview snippet",
            syncedAt: now
          }
        ],
        deadlinesSynced: 0,
        lastSyncedAt: now
      });

      const result = executeFunctionCall("getGitHubCourseContent", { courseCode: "DAT560" }, store);

      expect(result.name).toBe("getGitHubCourseContent");
      expect(Array.isArray(result.response)).toBe(true);
      expect((result.response as Array<{ id: string }>)[0]?.id).toBe("doc-dat560");
    });

    it("should execute queueDeadlineAction function", () => {
      const deadline = store.createDeadline({
        course: "DAT520",
        task: "Lab 4",
        dueDate: "2026-02-24T12:00:00.000Z",
        priority: "high",
        completed: false
      });

      const result = executeFunctionCall(
        "queueDeadlineAction",
        { deadlineId: deadline.id, action: "snooze", snoozeHours: 24 },
        store
      );

      expect(result.name).toBe("queueDeadlineAction");
      expect(result.response).toHaveProperty("requiresConfirmation", true);
    });

    it("should execute queueUpdateScheduleBlock function", () => {
      const scheduleBlock = store.createLectureEvent({
        title: "Focus block",
        startTime: "2026-02-24T10:00:00.000Z",
        durationMinutes: 90,
        workload: "high"
      });

      const result = executeFunctionCall(
        "queueUpdateScheduleBlock",
        { scheduleId: scheduleBlock.id, durationMinutes: 60 },
        store
      );

      expect(result.name).toBe("queueUpdateScheduleBlock");
      expect(result.response).toHaveProperty("requiresConfirmation", true);
    });

    it("should execute schedule delete queue functions", () => {
      const scheduleBlock = store.createLectureEvent({
        title: "Unblockable item",
        startTime: "2026-02-24T12:00:00.000Z",
        durationMinutes: 60,
        workload: "medium"
      });

      const deleteResult = executeFunctionCall(
        "queueDeleteScheduleBlock",
        { scheduleId: scheduleBlock.id },
        store
      );

      expect(deleteResult.name).toBe("queueDeleteScheduleBlock");
      expect(deleteResult.response).toHaveProperty("requiresConfirmation", true);

      const clearResult = executeFunctionCall(
        "queueClearScheduleWindow",
        {
          startTime: "2026-02-24T00:00:00.000Z",
          endTime: "2026-02-24T23:59:59.999Z",
          includeAcademicBlocks: true
        },
        store
      );

      expect(clearResult.name).toBe("queueClearScheduleWindow");
      expect(clearResult.response).toHaveProperty("requiresConfirmation", true);
    });

    it("should execute routine preset queue functions", () => {
      const createResult = executeFunctionCall(
        "queueCreateRoutinePreset",
        { title: "Morning gym", preferredStartTime: "07:00", durationMinutes: 60 },
        store
      );

      expect(createResult.name).toBe("queueCreateRoutinePreset");
      expect(createResult.response).toHaveProperty("requiresConfirmation", true);

      const preset = store.createRoutinePreset({
        title: "Nightly review",
        preferredStartTime: "21:00",
        durationMinutes: 45,
        workload: "low",
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        active: true
      });

      const updateResult = executeFunctionCall(
        "queueUpdateRoutinePreset",
        { presetId: preset.id, preferredStartTime: "20:30" },
        store
      );

      expect(updateResult.name).toBe("queueUpdateRoutinePreset");
      expect(updateResult.response).toHaveProperty("requiresConfirmation", true);
    });

    it("should execute createJournalEntry function", () => {
      const result = executeFunctionCall("createJournalEntry", { content: "Saved from tool call." }, store);

      expect(result.name).toBe("createJournalEntry");
      expect(result.response).toHaveProperty("success", true);
    });

    it("should throw error for unknown function", () => {
      expect(() => {
        executeFunctionCall("unknownFunction", {}, store);
      }).toThrow("Unknown function: unknownFunction");
    });
  });
});
