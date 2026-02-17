import { describe, it, expect, beforeEach } from "vitest";
import {
  functionDeclarations,
  handleGetSchedule,
  handleGetDeadlines,
  handleSearchJournal,
  handleGetEmails,
  handleGetSocialDigest,
  handleGetHabitsGoalsStatus,
  handleUpdateHabitCheckIn,
  handleUpdateGoalCheckIn,
  handleGetGitHubCourseContent,
  handleQueueDeadlineAction,
  handleQueueScheduleBlock,
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
    it("should define 12 function declarations", () => {
      expect(functionDeclarations).toHaveLength(12);
    });

    it("should include getSchedule function", () => {
      const getSchedule = functionDeclarations.find((f) => f.name === "getSchedule");
      expect(getSchedule).toBeDefined();
      expect(getSchedule?.description).toContain("schedule");
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
    });

    it("should include getGitHubCourseContent function", () => {
      const getGitHubCourseContent = functionDeclarations.find((f) => f.name === "getGitHubCourseContent");
      expect(getGitHubCourseContent).toBeDefined();
      expect(getGitHubCourseContent?.description).toContain("GitHub");
    });

    it("should include queue action functions", () => {
      expect(functionDeclarations.find((f) => f.name === "queueDeadlineAction")).toBeDefined();
      expect(functionDeclarations.find((f) => f.name === "queueScheduleBlock")).toBeDefined();
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

  describe("handleGetDeadlines", () => {
    it("should return upcoming deadlines within default 14 days", () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const deadline = store.createDeadline({
        course: "DAT520",
        task: "Lab 1",
        dueDate: tomorrow.toISOString(),
        priority: "high",
        completed: false
      });

      const result = handleGetDeadlines(store);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.id).toBe(deadline.id);
    });

    it("should respect daysAhead parameter", () => {
      const farFuture = new Date();
      farFuture.setDate(farFuture.getDate() + 20);

      const deadline = store.createDeadline({
        course: "DAT520",
        task: "Lab 1",
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
        task: "Lab 1",
        dueDate: yesterday.toISOString(),
        priority: "high",
        completed: false
      });

      const result = handleGetDeadlines(store);
      expect(result).toHaveLength(0);
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
    it("should return email digests with default limit", () => {
      const result = handleGetEmails(store);
      expect(Array.isArray(result)).toBe(true);
    });

    it("should respect limit parameter", () => {
      const result = handleGetEmails(store, { limit: 3 });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeLessThanOrEqual(3);
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
  });

  describe("executeFunctionCall", () => {
    it("should execute getSchedule function", () => {
      const result = executeFunctionCall("getSchedule", {}, store);

      expect(result.name).toBe("getSchedule");
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
