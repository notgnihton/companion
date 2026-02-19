import { beforeEach, describe, expect, it } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - Pending Chat Actions", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
  });

  it("creates and retrieves pending chat actions", () => {
    const action = store.createPendingChatAction({
      actionType: "create-habit",
      summary: "Create habit from chat",
      payload: { name: "Morning walk", cadence: "daily", targetPerWeek: 5 }
    });

    const byId = store.getPendingChatActionById(action.id);
    expect(byId?.id).toBe(action.id);
    expect(byId?.actionType).toBe("create-habit");
    expect(store.getPendingChatActions()).toHaveLength(1);
  });

  it("prunes expired pending actions", () => {
    store.createPendingChatAction({
      actionType: "complete-deadline",
      summary: "Expired action",
      payload: { deadlineId: "deadline-1" },
      expiresAt: "2026-01-01T00:00:00.000Z"
    });

    const now = new Date("2026-02-17T10:00:00.000Z");
    expect(store.getPendingChatActions(now)).toHaveLength(0);
  });
});
