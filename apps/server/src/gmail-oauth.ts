import { google } from "googleapis";
import { RuntimeStore } from "./store.js";
import { config } from "./config.js";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const REDIRECT_URI = "http://localhost:8787/api/auth/gmail/callback";

export class GmailOAuthService {
  private store: RuntimeStore;
  private userId: string;

  constructor(store: RuntimeStore, userId: string) {
    this.store = store;
    this.userId = userId;
    this.bootstrapTokensFromEnvironment();
  }

  private hasOAuthCredentials(): boolean {
    return Boolean(config.GMAIL_CLIENT_ID && config.GMAIL_CLIENT_SECRET);
  }

  private extractAccessToken(value: unknown): string | null {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }

    if (value && typeof value === "object") {
      const record = value as { token?: unknown };
      if (typeof record.token === "string" && record.token.trim().length > 0) {
        return record.token;
      }
    }

    return null;
  }

  private bootstrapTokensFromEnvironment(): void {
    const envAccessToken = config.GMAIL_ACCESS_TOKEN?.trim();
    const envRefreshToken = config.GMAIL_REFRESH_TOKEN?.trim();

    if (!envAccessToken && !envRefreshToken) {
      return;
    }

    const existing = this.store.getGmailTokens(this.userId);
    this.store.setGmailTokens(this.userId, {
      refreshToken: envRefreshToken || existing?.refreshToken,
      accessToken: envAccessToken || existing?.accessToken,
      email: existing?.email ?? "env-token",
      connectedAt: existing?.connectedAt ?? new Date().toISOString(),
      source: "env"
    });
  }

  getOAuth2Client() {
    return new google.auth.OAuth2(
      config.GMAIL_CLIENT_ID,
      config.GMAIL_CLIENT_SECRET,
      REDIRECT_URI
    );
  }

  getAuthUrl(): string {
    if (!this.hasOAuthCredentials()) {
      throw new Error("Gmail OAuth credentials not configured");
    }

    const oauth2Client = this.getOAuth2Client();
    
    return oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent"
    });
  }

  async handleCallback(code: string): Promise<{ email: string; connectedAt: string }> {
    if (!this.hasOAuthCredentials()) {
      throw new Error("Gmail OAuth credentials not configured");
    }

    const oauth2Client = this.getOAuth2Client();
    
    try {
      const { tokens } = await oauth2Client.getToken(code);
      
      if (!tokens.refresh_token) {
        throw new Error("No refresh token received");
      }

      // Get user's email address
      oauth2Client.setCredentials(tokens);
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: "me" });
      const email = profile.data.emailAddress || "unknown";

      // Store the refresh token
      const connectedAt = new Date().toISOString();
      this.store.setGmailTokens(this.userId, {
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token ?? undefined,
        email,
        connectedAt,
        source: "oauth"
      });

      return { email, connectedAt };
    } catch (error) {
      console.error("Gmail OAuth callback error:", error);
      throw new Error("Failed to complete Gmail authorization");
    }
  }

  async getAuthenticatedClient() {
    const tokens = this.store.getGmailTokens(this.userId);
    
    if (!tokens?.refreshToken && !tokens?.accessToken) {
      throw new Error("Gmail not connected");
    }

    const oauth2Client = this.getOAuth2Client();
    const persistTokens = (nextTokens: { refresh_token?: string | null; access_token?: string | null }): void => {
      const nextRefreshToken = nextTokens.refresh_token ?? undefined;
      const nextAccessToken = nextTokens.access_token ?? undefined;

      if (!nextRefreshToken && !nextAccessToken) {
        return;
      }

      const latest = this.store.getGmailTokens(this.userId);
      this.store.setGmailTokens(this.userId, {
        refreshToken: nextRefreshToken ?? latest?.refreshToken,
        accessToken: nextAccessToken ?? latest?.accessToken,
        email: latest?.email ?? tokens.email ?? "unknown",
        connectedAt: latest?.connectedAt ?? tokens.connectedAt ?? new Date().toISOString(),
        source: latest?.source ?? tokens.source ?? "unknown"
      });
    };

    oauth2Client.on("tokens", (nextTokens) => {
      persistTokens(nextTokens);
    });

    if (tokens.refreshToken) {
      oauth2Client.setCredentials({
        refresh_token: tokens.refreshToken
      });

      try {
        const refreshedTokenResponse = await oauth2Client.getAccessToken();
        const refreshedAccessToken = this.extractAccessToken(refreshedTokenResponse);
        if (refreshedAccessToken) {
          persistTokens({ access_token: refreshedAccessToken });
          oauth2Client.setCredentials({
            refresh_token: tokens.refreshToken,
            access_token: refreshedAccessToken
          });
          return oauth2Client;
        }
      } catch (error) {
        if (!tokens.accessToken) {
          const message = error instanceof Error ? error.message : "unknown error";
          throw new Error(`Failed to refresh Gmail access token: ${message}`);
        }
      }

      if (tokens.accessToken) {
        oauth2Client.setCredentials({
          refresh_token: tokens.refreshToken,
          access_token: tokens.accessToken
        });
        return oauth2Client;
      }

      throw new Error("Failed to refresh Gmail access token: no usable token available");
    }

    oauth2Client.setCredentials({
      access_token: tokens.accessToken
    });

    return oauth2Client;
  }

  isConnected(): boolean {
    const tokens = this.store.getGmailTokens(this.userId);
    return !!tokens?.refreshToken;
  }

  getConnectionInfo() {
    const tokens = this.store.getGmailTokens(this.userId);
    
    if (!tokens) {
      return { connected: false };
    }

    return {
      connected: true,
      email: tokens.email,
      connectedAt: tokens.connectedAt,
      source: tokens.source,
      tokenBootstrap: tokens.source === "env",
      hasRefreshToken: Boolean(tokens.refreshToken),
      hasAccessToken: Boolean(tokens.accessToken)
    };
  }
}
