import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";
import { RuntimeStore } from "./store.js";
import { GmailOAuthService } from "./gmail-oauth.js";

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  timestamp: string;
  isUnread: boolean;
  labels: string[];
}

export interface GmailSummary {
  unreadCount: number;
  messages: GmailMessage[];
  importantSenders: string[];
  actionableItems: Array<{
    from: string;
    subject: string;
    snippet: string;
    reason: "canvas" | "deadline" | "professor";
  }>;
  lastSyncedAt: string;
}

const IMPORTANT_DOMAINS = [
  "instructure.com", // Canvas LMS
  "stavanger.instructure.com",
  "uis.no", // UiS email
  "uia.no", // Other Norwegian universities  
];

const PROFESSOR_KEYWORDS = ["professor", "prof", "lecturer", "instructor", "faculty"];
const DEADLINE_KEYWORDS = ["deadline", "due date", "submit", "submission", "assignment due"];
const CANVAS_KEYWORDS = ["canvas", "assignment", "announcement", "grade"];

export class GmailSyncService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly syncIntervalMs = 30 * 60 * 1000; // 30 minutes

  constructor(
    private readonly store: RuntimeStore,
    private readonly gmailOAuth: GmailOAuthService
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }

    void this.syncOnce();
    this.timer = setInterval(() => {
      void this.syncOnce();
    }, this.syncIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async syncOnce(): Promise<GmailSummary | null> {
    try {
      if (!this.gmailOAuth.isConnected()) {
        return null;
      }

      const oauth2Client = await this.gmailOAuth.getAuthenticatedClient();
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      // Fetch unread messages from the last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const afterTimestamp = Math.floor(sevenDaysAgo.getTime() / 1000);

      const listResponse = await gmail.users.messages.list({
        userId: "me",
        q: `is:unread after:${afterTimestamp}`,
        maxResults: 50,
      });

      const messages = listResponse.data.messages || [];
      const unreadCount = messages.length;

      // Fetch details for each message
      const gmailMessages: GmailMessage[] = [];
      
      for (const msg of messages.slice(0, 20)) {
        try {
          const details = await gmail.users.messages.get({
            userId: "me",
            id: msg.id!,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
          });

          const headers = details.data.payload?.headers || [];
          const from = headers.find((h: gmail_v1.Schema$MessagePartHeader) => h.name === "From")?.value || "Unknown";
          const subject = headers.find((h: gmail_v1.Schema$MessagePartHeader) => h.name === "Subject")?.value || "(No subject)";
          const dateStr = headers.find((h: gmail_v1.Schema$MessagePartHeader) => h.name === "Date")?.value;
          const snippet = details.data.snippet || "";
          const labels = details.data.labelIds || [];

          const timestamp = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();

          gmailMessages.push({
            id: details.data.id!,
            threadId: details.data.threadId!,
            from,
            subject,
            snippet,
            timestamp,
            isUnread: labels.includes("UNREAD"),
            labels,
          });
        } catch (err) {
          console.error(`Error fetching Gmail message ${msg.id}:`, err);
        }
      }

      // Identify important senders
      const importantSenders = this.identifyImportantSenders(gmailMessages);

      // Identify actionable items
      const actionableItems = this.identifyActionableItems(gmailMessages);

      const summary: GmailSummary = {
        unreadCount,
        messages: gmailMessages,
        importantSenders,
        actionableItems,
        lastSyncedAt: new Date().toISOString(),
      };

      // Store the summary
      this.store.setGmailData(summary);

      return summary;
    } catch (error) {
      console.error("Gmail sync error:", error);
      return null;
    }
  }

  private identifyImportantSenders(messages: GmailMessage[]): string[] {
    const senderCounts = new Map<string, number>();

    messages.forEach((msg) => {
      const email = this.extractEmail(msg.from);
      if (this.isImportantDomain(email)) {
        senderCounts.set(email, (senderCounts.get(email) || 0) + 1);
      }
    });

    return Array.from(senderCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([email]) => email);
  }

  private identifyActionableItems(
    messages: GmailMessage[]
  ): Array<{ from: string; subject: string; snippet: string; reason: "canvas" | "deadline" | "professor" }> {
    const actionable: Array<{
      from: string;
      subject: string;
      snippet: string;
      reason: "canvas" | "deadline" | "professor";
    }> = [];

    messages.forEach((msg) => {
      const email = this.extractEmail(msg.from);
      const textToCheck = `${msg.subject} ${msg.snippet}`.toLowerCase();

      let reason: "canvas" | "deadline" | "professor" | null = null;

      if (CANVAS_KEYWORDS.some((kw) => textToCheck.includes(kw))) {
        reason = "canvas";
      } else if (DEADLINE_KEYWORDS.some((kw) => textToCheck.includes(kw))) {
        reason = "deadline";
      } else if (
        PROFESSOR_KEYWORDS.some((kw) => textToCheck.includes(kw)) ||
        this.isImportantDomain(email)
      ) {
        reason = "professor";
      }

      if (reason) {
        actionable.push({
          from: msg.from,
          subject: msg.subject,
          snippet: msg.snippet,
          reason,
        });
      }
    });

    return actionable.slice(0, 10);
  }

  private extractEmail(from: string): string {
    const match = from.match(/<([^>]+)>/);
    return match ? match[1] : from;
  }

  private isImportantDomain(email: string): boolean {
    return IMPORTANT_DOMAINS.some((domain) => email.includes(domain));
  }
}
