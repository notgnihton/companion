import { google } from "googleapis";
import { RuntimeStore } from "./store.js";
import { config } from "./config.js";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const REDIRECT_URI = "http://localhost:8787/api/auth/gmail/callback";

export class GmailOAuthService {
  private store: RuntimeStore;

  constructor(store: RuntimeStore) {
    this.store = store;
    this.bootstrapTokensFromEnvironment();
  }

  private hasOAuthCredentials(): boolean {
    return Boolean(config.GMAIL_CLIENT_ID && config.GMAIL_CLIENT_SECRET);
  }

  private bootstrapTokensFromEnvironment(): void {
    const envAccessToken = config.GMAIL_ACCESS_TOKEN?.trim();
    const envRefreshToken = config.GMAIL_REFRESH_TOKEN?.trim();

    if (!envAccessToken && !envRefreshToken) {
      return;
    }

    const existing = this.store.getGmailTokens();
    this.store.setGmailTokens({
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
      this.store.setGmailTokens({
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
    const tokens = this.store.getGmailTokens();
    
    if (!tokens?.refreshToken && !tokens?.accessToken) {
      throw new Error("Gmail not connected");
    }

    const oauth2Client = this.getOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: tokens.refreshToken,
      access_token: tokens.accessToken
    });

    oauth2Client.on("tokens", (nextTokens) => {
      if (!nextTokens.refresh_token && !nextTokens.access_token) {
        return;
      }

      const latest = this.store.getGmailTokens();
      this.store.setGmailTokens({
        refreshToken: nextTokens.refresh_token ?? latest?.refreshToken,
        accessToken: nextTokens.access_token ?? latest?.accessToken,
        email: latest?.email ?? "unknown",
        connectedAt: latest?.connectedAt ?? new Date().toISOString(),
        source: latest?.source ?? "unknown"
      });
    });

    return oauth2Client;
  }

  isConnected(): boolean {
    const tokens = this.store.getGmailTokens();
    return !!tokens?.refreshToken;
  }

  getConnectionInfo() {
    const tokens = this.store.getGmailTokens();
    
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
