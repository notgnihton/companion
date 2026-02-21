import { describe, expect, it } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - Gmail tokens and sync data", () => {
  const userId = "test-user";

  it("preserves Gmail tokens when writing synced messages", () => {
    const store = new RuntimeStore(":memory:");
    const connectedAt = "2026-02-17T14:00:00.000Z";

    store.setGmailTokens(userId, {
      refreshToken: "refresh-token",
      accessToken: "access-token",
      email: "lucy@example.com",
      connectedAt,
      source: "oauth"
    });

    store.setGmailMessages(
      userId,
      [
        {
          id: "msg-1",
          from: "course@example.com",
          subject: "Assignment reminder",
          snippet: "Due soon",
          receivedAt: connectedAt,
          labels: ["INBOX", "UNREAD"],
          isRead: false
        }
      ],
      connectedAt
    );

    const tokens = store.getGmailTokens(userId);
    expect(tokens?.refreshToken).toBe("refresh-token");
    expect(tokens?.accessToken).toBe("access-token");
    expect(tokens?.email).toBe("lucy@example.com");
    expect(tokens?.source).toBe("oauth");
  });

  it("supports Gmail token records with only an access token", () => {
    const store = new RuntimeStore(":memory:");

    store.setGmailTokens(userId, {
      accessToken: "env-access-token",
      email: "env-token",
      connectedAt: "2026-02-17T14:10:00.000Z",
      source: "env"
    });

    const tokens = store.getGmailTokens(userId);
    expect(tokens).not.toBeNull();
    expect(tokens?.refreshToken).toBeUndefined();
    expect(tokens?.accessToken).toBe("env-access-token");
    expect(tokens?.source).toBe("env");
  });
});
