import { describe, it, expect, beforeEach } from "vitest";
import {
  functionDeclarations,
  handleGetSchedule,
  handleGetDeadlines,
  handleSearchJournal,
  handleGetEmails,
  handleGetSocialDigest,
  executeFunctionCall
} from "./gemini-tools.js";
import { RuntimeStore } from "./store.js";
import { Deadline, JournalEntry, LectureEvent } from "./types.js";
import fs from "fs";

describe("gemini-tools", () => {
  let store: RuntimeStore;
  const testDbPath = ":memory:";

  beforeEach(() => {
    store = new RuntimeStore(testDbPath);
  });

  describe("functionDeclarations", () => {
    it("should define 5 function declarations", () => {
      expect(functionDeclarations).toHaveLength(5);
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

    it("should throw error for unknown function", () => {
      expect(() => {
        executeFunctionCall("unknownFunction", {}, store);
      }).toThrow("Unknown function: unknownFunction");
    });
  });
});
