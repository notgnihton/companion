import { describe, expect, it } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - journal search", () => {
  it("searches journal entries by text query", () => {
    const store = new RuntimeStore(":memory:");

    store.recordJournalEntry("Finished chapter 4 and outlined notes.");
    store.recordJournalEntry("Attended algorithms lecture today.");
    store.recordJournalEntry("Working on problem set 5.");

    const results = store.searchJournalEntries({ query: "algorithms" });

    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("algorithms");
  });

  it("searches journal entries by date range", () => {
    const store = new RuntimeStore(":memory:");

    store.syncJournalEntries([
      {
        clientEntryId: "entry-1",
        content: "Entry from January",
        timestamp: "2026-01-15T10:00:00.000Z"
      },
      {
        clientEntryId: "entry-2",
        content: "Entry from February",
        timestamp: "2026-02-15T10:00:00.000Z"
      },
      {
        clientEntryId: "entry-3",
        content: "Entry from March",
        timestamp: "2026-03-15T10:00:00.000Z"
      }
    ]);

    const results = store.searchJournalEntries({
      startDate: "2026-02-01T00:00:00.000Z",
      endDate: "2026-02-28T23:59:59.999Z"
    });

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("Entry from February");
  });

  it("searches journal entries by text and date range combined", () => {
    const store = new RuntimeStore(":memory:");

    store.syncJournalEntries([
      {
        clientEntryId: "entry-1",
        content: "Algorithms lecture in January",
        timestamp: "2026-01-15T10:00:00.000Z"
      },
      {
        clientEntryId: "entry-2",
        content: "Algorithms lecture in February",
        timestamp: "2026-02-15T10:00:00.000Z"
      },
      {
        clientEntryId: "entry-3",
        content: "Math lecture in February",
        timestamp: "2026-02-20T10:00:00.000Z"
      }
    ]);

    const results = store.searchJournalEntries({
      query: "Algorithms",
      startDate: "2026-02-01T00:00:00.000Z",
      endDate: "2026-02-28T23:59:59.999Z"
    });

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("Algorithms lecture in February");
  });

  it("supports limit parameter in search", () => {
    const store = new RuntimeStore(":memory:");

    store.recordJournalEntry("Entry 1");
    store.recordJournalEntry("Entry 2");
    store.recordJournalEntry("Entry 3");

    const results = store.searchJournalEntries({ limit: 2 });

    expect(results).toHaveLength(2);
  });

  it("filters journal entries by tags", () => {
    const store = new RuntimeStore(":memory:");

    const schoolTag = store.createTag("school");
    const focusTag = store.createTag("focus");

    store.recordJournalEntry("Algorithms lecture notes", [schoolTag.id, focusTag.id]);
    store.recordJournalEntry("Grocery list");
    store.recordJournalEntry("Systems reading plan", [schoolTag.id]);

    const taggedResults = store.searchJournalEntries({ tagIds: [schoolTag.id] });

    expect(taggedResults).toHaveLength(2);
    expect(taggedResults.every((entry) => entry.tags.some((tag) => tag.id === schoolTag.id))).toBe(true);

    const intersected = store.searchJournalEntries({ tagIds: [schoolTag.id, focusTag.id] });
    expect(intersected).toHaveLength(1);
    expect(intersected[0].content).toContain("Algorithms");
  });

  it("returns all entries when no filters provided", () => {
    const store = new RuntimeStore(":memory:");

    store.recordJournalEntry("Entry 1");
    store.recordJournalEntry("Entry 2");
    store.recordJournalEntry("Entry 3");

    const results = store.searchJournalEntries({});

    expect(results).toHaveLength(3);
  });

  it("returns empty array when no matches found", () => {
    const store = new RuntimeStore(":memory:");

    store.recordJournalEntry("Algorithms lecture today.");
    store.recordJournalEntry("Working on problem set.");

    const results = store.searchJournalEntries({ query: "chemistry" });

    expect(results).toHaveLength(0);
  });

  it("performs case-insensitive search", () => {
    const store = new RuntimeStore(":memory:");

    store.recordJournalEntry("Finished ALGORITHMS homework.");

    const results = store.searchJournalEntries({ query: "algorithms" });

    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("ALGORITHMS");
  });

  it("searches with startDate only", () => {
    const store = new RuntimeStore(":memory:");

    store.syncJournalEntries([
      {
        clientEntryId: "entry-1",
        content: "Entry from January",
        timestamp: "2026-01-15T10:00:00.000Z"
      },
      {
        clientEntryId: "entry-2",
        content: "Entry from February",
        timestamp: "2026-02-15T10:00:00.000Z"
      }
    ]);

    const results = store.searchJournalEntries({
      startDate: "2026-02-01T00:00:00.000Z"
    });

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("Entry from February");
  });

  it("searches with endDate only", () => {
    const store = new RuntimeStore(":memory:");

    store.syncJournalEntries([
      {
        clientEntryId: "entry-1",
        content: "Entry from January",
        timestamp: "2026-01-15T10:00:00.000Z"
      },
      {
        clientEntryId: "entry-2",
        content: "Entry from February",
        timestamp: "2026-02-15T10:00:00.000Z"
      }
    ]);

    const results = store.searchJournalEntries({
      endDate: "2026-01-31T23:59:59.999Z"
    });

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("Entry from January");
  });
});
