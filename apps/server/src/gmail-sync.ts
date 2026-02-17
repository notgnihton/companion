import { google } from "googleapis";
import { RuntimeStore } from "./store.js";
import { GmailMessage, GmailSyncResult } from "./types.js";
import { GmailOAuthService } from "./gmail-oauth.js";
import { SyncAutoHealingPolicy, SyncAutoHealingState } from "./sync-auto-healing.js";

export interface GmailSyncOptions {
  maxResults?: number;
  onlyUnread?: boolean;
}

export class GmailSyncService {
  private readonly store: RuntimeStore;
  private readonly gmailOAuth: GmailOAuthService;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private autoSyncInProgress = false;
  private autoSyncIntervalMs = 30 * 60 * 1000;
  private readonly autoHealing = new SyncAutoHealingPolicy({
    integration: "gmail",
    baseBackoffMs: 30_000,
    maxBackoffMs: 60 * 60 * 1000,
    circuitFailureThreshold: 4,
    circuitOpenMs: 20 * 60 * 1000
  });

  constructor(store: RuntimeStore, gmailOAuth?: GmailOAuthService) {
    this.store = store;
    this.gmailOAuth = gmailOAuth ?? new GmailOAuthService(store);
  }

  /**
   * Start the Gmail sync service with periodic syncing every 30 minutes
   */
  start(intervalMs: number = 30 * 60 * 1000): void {
    if (this.syncInterval) {
      return;
    }

    this.autoSyncIntervalMs = intervalMs;

    // Sync immediately on start (if connected)
    void this.runAutoSync();

    // Then sync periodically
    this.syncInterval = setInterval(() => {
      void this.runAutoSync();
    }, intervalMs);
  }

  /**
   * Stop the Gmail sync service
   */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  /**
   * Perform a Gmail sync - fetch recent unread emails
   */
  async sync(options?: GmailSyncOptions): Promise<GmailSyncResult> {
    // Check if Gmail is connected
    if (!this.gmailOAuth.isConnected()) {
      return {
        success: false,
        messagesCount: 0,
        error: "Gmail not connected"
      };
    }

    try {
      const auth = await this.gmailOAuth.getAuthenticatedClient();
      const gmail = google.gmail({ version: "v1", auth });

      const maxResults = options?.maxResults ?? 20;
      const onlyUnread = options?.onlyUnread ?? true;

      // Build query - only unread messages if specified
      const q = onlyUnread ? "is:unread" : undefined;

      // List messages
      const messagesResponse = await gmail.users.messages.list({
        userId: "me",
        maxResults,
        q
      });

      const messageIds = messagesResponse.data.messages || [];
      const messages: GmailMessage[] = [];

      // Fetch details for each message
      for (const msg of messageIds) {
        if (!msg.id) continue;

        const details = await gmail.users.messages.get({
          userId: "me",
          id: msg.id,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"]
        });

        // Extract headers
        const headers = details.data.payload?.headers || [];
        const from = headers.find((h) => h.name === "From")?.value || "";
        const subject = headers.find((h) => h.name === "Subject")?.value || "";
        const dateHeader = headers.find((h) => h.name === "Date")?.value || "";

        // Parse date
        let receivedAt = new Date().toISOString();
        if (dateHeader) {
          try {
            receivedAt = new Date(dateHeader).toISOString();
          } catch {
            receivedAt = new Date().toISOString();
          }
        }

        // Get labels
        const labels = details.data.labelIds || [];

        // Check if read
        const isRead = !labels.includes("UNREAD");

        // Get snippet
        const snippet = details.data.snippet || "";

        messages.push({
          id: msg.id,
          from,
          subject,
          snippet,
          receivedAt,
          labels,
          isRead
        });
      }

      // Store messages in database
      const lastSyncedAt = new Date().toISOString();
      this.store.setGmailMessages(messages, lastSyncedAt);

      return {
        success: true,
        messagesCount: messages.length
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      return {
        success: false,
        messagesCount: 0,
        error: errorMessage
      };
    }
  }

  /**
   * Manually trigger a sync
   */
  async triggerSync(options?: GmailSyncOptions): Promise<GmailSyncResult> {
    return this.sync(options);
  }

  /**
   * Get synced messages
   */
  getMessages(): GmailMessage[] {
    return this.store.getGmailMessages();
  }

  /**
   * Get Gmail data with sync info
   */
  getData(): { messages: GmailMessage[]; lastSyncedAt: string | null } {
    return this.store.getGmailData();
  }

  getAutoHealingStatus(): SyncAutoHealingState {
    return this.autoHealing.getState();
  }

  private scheduleAutoRetry(): void {
    if (!this.syncInterval || this.retryTimeout) {
      return;
    }

    const nextAttemptAt = this.autoHealing.getState().nextAttemptAt;
    if (!nextAttemptAt) {
      return;
    }

    const delay = Date.parse(nextAttemptAt) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0 || delay >= this.autoSyncIntervalMs) {
      return;
    }

    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      void this.runAutoSync();
    }, delay);
  }

  private async runAutoSync(): Promise<void> {
    if (!this.gmailOAuth.isConnected() || this.autoSyncInProgress) {
      return;
    }

    const decision = this.autoHealing.canAttempt();
    if (!decision.allowed) {
      this.autoHealing.recordSkip(decision.reason ?? "backoff");
      return;
    }

    this.autoSyncInProgress = true;
    try {
      const result = await this.sync();
      if (result.success) {
        this.autoHealing.recordSuccess();
      } else {
        this.autoHealing.recordFailure(result.error);
        this.scheduleAutoRetry();
      }
    } finally {
      this.autoSyncInProgress = false;
    }
  }
}
