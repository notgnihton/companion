import { google } from "googleapis";
import { RuntimeStore } from "./store.js";
import { config } from "./config.js";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const REDIRECT_URI = "http://localhost:8787/api/auth/gmail/callback";

export class GmailOAuthService {
  private store: RuntimeStore;

  constructor(store: RuntimeStore) {
    this.store = store;
  }

  getOAuth2Client() {
    if (!config.GMAIL_CLIENT_ID || !config.GMAIL_CLIENT_SECRET) {
      throw new Error("Gmail OAuth credentials not configured");
    }

    return new google.auth.OAuth2(
      config.GMAIL_CLIENT_ID,
      config.GMAIL_CLIENT_SECRET,
      REDIRECT_URI
    );
  }

  getAuthUrl(): string {
    const oauth2Client = this.getOAuth2Client();
    
    return oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent"
    });
  }

  async handleCallback(code: string): Promise<{ email: string; connectedAt: string }> {
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
        email,
        connectedAt
      });

      return { email, connectedAt };
    } catch (error) {
      console.error("Gmail OAuth callback error:", error);
      throw new Error("Failed to complete Gmail authorization");
    }
  }

  async getAuthenticatedClient() {
    const tokens = this.store.getGmailTokens();
    
    if (!tokens?.refreshToken) {
      throw new Error("Gmail not connected");
    }

    const oauth2Client = this.getOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: tokens.refreshToken
    });

    return oauth2Client;
  }

  isConnected(): boolean {
    const tokens = this.store.getGmailTokens();
    return !!tokens?.refreshToken;
  }

  getConnectionInfo() {
    const tokens = this.store.getGmailTokens();
    
    if (!tokens?.refreshToken) {
      return { connected: false };
    }

    return {
      connected: true,
      email: tokens.email,
      connectedAt: tokens.connectedAt
    };
  }
}
