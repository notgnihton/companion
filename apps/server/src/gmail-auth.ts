import { google } from "googleapis";
import { config } from "./config.js";
import { RuntimeStore } from "./store.js";

const REDIRECT_URI = "http://localhost:8787/api/auth/gmail/callback";
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

/**
 * Creates OAuth2 client for Gmail authentication
 */
export function createOAuth2Client() {
  if (!config.GMAIL_CLIENT_ID || !config.GMAIL_CLIENT_SECRET) {
    throw new Error("Gmail OAuth credentials not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET environment variables.");
  }

  return new google.auth.OAuth2(
    config.GMAIL_CLIENT_ID,
    config.GMAIL_CLIENT_SECRET,
    REDIRECT_URI
  );
}

/**
 * Generates the authorization URL to redirect the user to Google consent screen
 */
export function getAuthorizationUrl(): string {
  const oauth2Client = createOAuth2Client();
  
  return oauth2Client.generateAuthUrl({
    access_type: "offline", // Request refresh token
    scope: SCOPES,
    prompt: "consent" // Force consent screen to ensure refresh token is returned
  });
}

/**
 * Exchanges authorization code for tokens and stores refresh token
 */
export async function handleOAuthCallback(
  store: RuntimeStore,
  code: string
): Promise<{ email: string; connectedAt: string }> {
  const oauth2Client = createOAuth2Client();

  // Exchange code for tokens
  const { tokens } = await oauth2Client.getToken(code);
  
  if (!tokens.refresh_token) {
    throw new Error("No refresh token received. User may have already authorized the app.");
  }

  // Get user email from OAuth2 token info
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();
  const email = userInfo.data.email;

  if (!email) {
    throw new Error("Failed to retrieve user email from Google");
  }

  // Store refresh token in database
  const connectedAt = new Date().toISOString();
  store.setGmailAuth({
    refreshToken: tokens.refresh_token,
    email,
    connectedAt
  });

  return { email, connectedAt };
}

/**
 * Gets an authenticated Gmail client using stored refresh token
 */
export async function getAuthenticatedGmailClient(store: RuntimeStore) {
  const auth = store.getGmailAuth();
  
  if (!auth || !auth.refreshToken) {
    throw new Error("Gmail not connected. User needs to authorize via /api/auth/gmail");
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: auth.refreshToken
  });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

/**
 * Checks if Gmail is currently connected
 */
export function isGmailConnected(store: RuntimeStore): boolean {
  const auth = store.getGmailAuth();
  return !!auth && !!auth.refreshToken;
}
