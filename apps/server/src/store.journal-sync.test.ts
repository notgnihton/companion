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
});
