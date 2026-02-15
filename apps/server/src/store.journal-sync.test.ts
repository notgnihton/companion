import { describe, expect, it } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - journal sync", () => {
  it("creates new entries with version metadata", () => {
    const store = new RuntimeStore(":memory:");

    const result = store.syncJournalEntries([
      {
        clientEntryId: "offline-1",
        content: "Initial offline note",
        timestamp: "2026-02-20T18:00:00.000Z"
      }
    ]);

    expect(result.conflicts).toHaveLength(0);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].version).toBe(1);
    expect(result.applied[0].clientEntryId).toBe("offline-1");
  });

  it("returns conflicts when base version is stale", () => {
    const store = new RuntimeStore(":memory:");

    const first = store.syncJournalEntries([
      {
        clientEntryId: "offline-2",
        content: "first",
        timestamp: "2026-02-20T18:00:00.000Z"
      }
    ]);

    const second = store.syncJournalEntries([
      {
        id: first.applied[0].id,
        clientEntryId: "offline-2",
        content: "updated",
        timestamp: "2026-02-20T19:00:00.000Z",
        baseVersion: 1
      }
    ]);

    expect(second.conflicts).toHaveLength(0);
    expect(second.applied[0].version).toBe(2);

    const stale = store.syncJournalEntries([
      {
        id: first.applied[0].id,
        clientEntryId: "offline-2",
        content: "stale update",
        timestamp: "2026-02-20T20:00:00.000Z",
        baseVersion: 1
      }
    ]);

    expect(stale.applied).toHaveLength(0);
    expect(stale.conflicts).toHaveLength(1);
    expect(stale.conflicts[0].version).toBe(2);
  });

  it("syncs journal tags and preserves existing tags when omitted", () => {
    const store = new RuntimeStore(":memory:");
    const schoolTag = store.createTag("school");
    const focusTag = store.createTag("focus");

    const initial = store.syncJournalEntries([
      {
        clientEntryId: "offline-3",
        content: "Initial content",
        timestamp: "2026-02-21T18:00:00.000Z",
        tags: [schoolTag.id]
      }
    ]);

    expect(initial.applied[0].tags).toEqual([schoolTag.name]);

    const withoutTags = store.syncJournalEntries([
      {
        id: initial.applied[0].id,
        clientEntryId: "offline-3",
        content: "Updated content",
        timestamp: "2026-02-21T19:00:00.000Z",
        baseVersion: 1
      }
    ]);

    expect(withoutTags.applied[0].tags).toEqual([schoolTag.name]);

    const retagged = store.syncJournalEntries([
      {
        id: initial.applied[0].id,
        clientEntryId: "offline-3",
        content: "Updated with tags",
        timestamp: "2026-02-21T20:00:00.000Z",
        baseVersion: 2,
        tags: [schoolTag.id, focusTag.id]
      }
    ]);

    expect(retagged.applied[0].tags).toEqual([schoolTag.name, focusTag.name]);
  });
});
