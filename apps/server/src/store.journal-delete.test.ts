import { describe, expect, it } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - journal delete", () => {
  const userId = "test-user";

  it("deletes an existing journal entry", () => {
    const store = new RuntimeStore(":memory:");
    const tag = store.createTag(userId, "swipe");
    const entry = store.recordJournalEntry(userId, "Delete me", [tag.id]);

    expect(store.getJournalEntries(userId).some((item) => item.id === entry.id)).toBe(true);

    const deleted = store.deleteJournalEntry(userId, entry.id);

    expect(deleted).toBe(true);
    expect(store.getJournalEntries(userId).some((item) => item.id === entry.id)).toBe(false);
  });

  it("returns false when the journal entry does not exist", () => {
    const store = new RuntimeStore(":memory:");
    const deleted = store.deleteJournalEntry(userId, "missing-id");
    expect(deleted).toBe(false);
  });
});
