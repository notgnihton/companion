import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeStore } from "./store.js";
import { GmailSyncService } from "./gmail-sync.js";
import { GmailOAuthService } from "./gmail-oauth.js";

describe("GmailSyncService", () => {
  let store: RuntimeStore;
  let service: GmailSyncService;
  let gmailOAuth: GmailOAuthService;

  const userId = "test-user";

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
    gmailOAuth = new GmailOAuthService(store, userId);
    service = new GmailSyncService(store, userId, gmailOAuth);
  });

  describe("sync", () => {
    it("should fail when Gmail not connected", async () => {
      const disconnectedService = new GmailSyncService(
        store,
        userId,
        {
          isConnected: () => false
        } as GmailOAuthService
      );
      const result = await disconnectedService.sync();
      
      expect(result.success).toBe(false);
      expect(result.messagesCount).toBe(0);
      expect(result.error).toBe("Gmail not connected");
    });

    it("should store empty messages when starting", () => {
      const messages = service.getMessages();
      
      expect(messages).toEqual([]);
    });

    it("should retrieve stored messages", () => {
      const testMessages = [
        {
          id: "msg1",
          from: "test@example.com",
          subject: "Test Subject",
          snippet: "Test snippet",
          receivedAt: new Date().toISOString(),
          labels: ["INBOX", "UNREAD"],
          isRead: false
        }
      ];

      store.setGmailMessages(userId, testMessages, new Date().toISOString());
      const messages = service.getMessages();

      expect(messages).toEqual(testMessages);
    });

    it("should get Gmail data with sync info", () => {
      const testMessages = [
        {
          id: "msg1",
          from: "test@example.com",
          subject: "Test Subject",
          snippet: "Test snippet",
          receivedAt: new Date().toISOString(),
          labels: ["INBOX"],
          isRead: true
        }
      ];

      const syncTime = new Date().toISOString();
      store.setGmailMessages(userId, testMessages, syncTime);
      const data = service.getData();

      expect(data.messages).toEqual(testMessages);
      expect(data.lastSyncedAt).toBe(syncTime);
    });
  });

  describe("service lifecycle", () => {
    it("should start and stop without errors", () => {
      expect(() => service.start()).not.toThrow();
      expect(() => service.stop()).not.toThrow();
    });

    it("should not start multiple times", () => {
      service.start();
      service.start(); // Should not throw
      service.stop();
    });
  });
});
