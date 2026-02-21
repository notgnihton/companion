import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { RuntimeStore } from "./store.js";

const WITHINGS_AUTHORIZE_URL = "https://account.withings.com/oauth2_user/authorize2";
const STATE_TTL_MS = 10 * 60 * 1000;

interface WithingsTokenGrant {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  userId?: string;
  scope?: string;
}

interface WithingsTokenResponsePayload {
  status?: number;
  error?: string;
  body?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    userid?: string | number;
    scope?: string;
  };
}

export class WithingsOAuthService {
  private readonly store: RuntimeStore;
  private readonly userId: string;
  private readonly pendingStates = new Map<string, number>();

  constructor(store: RuntimeStore, userId: string) {
    this.store = store;
    this.userId = userId;
    this.bootstrapTokensFromEnvironment();
  }

  private hasOAuthCredentials(): boolean {
    return Boolean(config.WITHINGS_CLIENT_ID && config.WITHINGS_API_SECRET);
  }

  private buildApiUrl(path: string): string {
    const base = (config.WITHINGS_API_ENDPOINT || "https://wbsapi.withings.net").replace(/\/+$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}${normalizedPath}`;
  }

  private cleanupExpiredStates(nowMs = Date.now()): void {
    for (const [state, expiresAt] of this.pendingStates.entries()) {
      if (expiresAt <= nowMs) {
        this.pendingStates.delete(state);
      }
    }
  }

  private consumeState(state: string | null): boolean {
    this.cleanupExpiredStates();

    if (!state || state.trim().length === 0) {
      return false;
    }

    const expiresAt = this.pendingStates.get(state);
    if (!expiresAt || expiresAt < Date.now()) {
      return false;
    }

    this.pendingStates.delete(state);
    return true;
  }

  private createState(): string {
    this.cleanupExpiredStates();

    const state = randomBytes(18).toString("hex");
    this.pendingStates.set(state, Date.now() + STATE_TTL_MS);
    return state;
  }

  private bootstrapTokensFromEnvironment(): void {
    const envAccessToken = config.WITHINGS_ACCESS_TOKEN?.trim();
    const envRefreshToken = config.WITHINGS_REFRESH_TOKEN?.trim();

    if (!envAccessToken && !envRefreshToken) {
      return;
    }

    const existing = this.store.getWithingsTokens(this.userId);
    this.store.setWithingsTokens(this.userId, {
      refreshToken: envRefreshToken || existing?.refreshToken,
      accessToken: envAccessToken || existing?.accessToken,
      tokenExpiresAt: existing?.tokenExpiresAt,
      userId: existing?.userId,
      scope: existing?.scope,
      connectedAt: existing?.connectedAt ?? new Date().toISOString(),
      source: "env"
    });
  }

  private async requestToken(params: {
    grantType: "authorization_code" | "refresh_token";
    code?: string;
    refreshToken?: string;
  }): Promise<WithingsTokenGrant> {
    if (!this.hasOAuthCredentials()) {
      throw new Error("Withings OAuth credentials not configured");
    }

    const form = new URLSearchParams({
      action: "requesttoken",
      grant_type: params.grantType,
      client_id: config.WITHINGS_CLIENT_ID!,
      client_secret: config.WITHINGS_API_SECRET!,
      redirect_uri: config.WITHINGS_CALLBACK_URL
    });

    if (params.code) {
      form.set("code", params.code);
    }
    if (params.refreshToken) {
      form.set("refresh_token", params.refreshToken);
    }

    const response = await fetch(this.buildApiUrl("/v2/oauth2"), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form
    });

    const raw = await response.text();
    let payload: WithingsTokenResponsePayload | null = null;

    try {
      payload = JSON.parse(raw) as WithingsTokenResponsePayload;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const providerError = payload?.error ? ` (${payload.error})` : "";
      throw new Error(`Withings OAuth token request failed with HTTP ${response.status}${providerError}`);
    }

    if (!payload || payload.status !== 0 || !payload.body?.access_token) {
      const providerError = payload?.error ?? "unknown_error";
      throw new Error(`Withings OAuth token response error: ${providerError}`);
    }

    const expiresIn = typeof payload.body.expires_in === "number" && Number.isFinite(payload.body.expires_in)
      ? Math.max(60, payload.body.expires_in)
      : 3 * 60 * 60;

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    return {
      accessToken: payload.body.access_token,
      ...(payload.body.refresh_token ? { refreshToken: payload.body.refresh_token } : {}),
      expiresAt,
      ...(payload.body.userid !== undefined && payload.body.userid !== null
        ? { userId: String(payload.body.userid) }
        : {}),
      ...(payload.body.scope ? { scope: payload.body.scope } : {})
    };
  }

  getAuthUrl(): string {
    if (!this.hasOAuthCredentials()) {
      throw new Error("Withings OAuth credentials not configured");
    }

    const state = this.createState();
    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.WITHINGS_CLIENT_ID!,
      redirect_uri: config.WITHINGS_CALLBACK_URL,
      scope: config.WITHINGS_SCOPE,
      state
    });

    return `${WITHINGS_AUTHORIZE_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, state: string | null): Promise<{ connectedAt: string; userId?: string; scope?: string }> {
    if (!this.hasOAuthCredentials()) {
      throw new Error("Withings OAuth credentials not configured");
    }

    if (!this.consumeState(state)) {
      throw new Error("Invalid or expired Withings OAuth state");
    }

    const token = await this.requestToken({
      grantType: "authorization_code",
      code
    });

    const existing = this.store.getWithingsTokens(this.userId);
    const connectedAt = existing?.connectedAt ?? new Date().toISOString();

    this.store.setWithingsTokens(this.userId, {
      refreshToken: token.refreshToken ?? existing?.refreshToken,
      accessToken: token.accessToken,
      tokenExpiresAt: token.expiresAt,
      userId: token.userId ?? existing?.userId,
      scope: token.scope ?? existing?.scope,
      connectedAt,
      source: "oauth"
    });

    return {
      connectedAt,
      ...(token.userId ? { userId: token.userId } : {}),
      ...(token.scope ? { scope: token.scope } : {})
    };
  }

  async getValidAccessToken(): Promise<string> {
    const tokens = this.store.getWithingsTokens(this.userId);
    if (!tokens?.refreshToken && !tokens?.accessToken) {
      throw new Error("Withings not connected");
    }

    const expiresAtMs = tokens?.tokenExpiresAt ? Date.parse(tokens.tokenExpiresAt) : Number.NaN;
    const hasUsableAccessToken =
      Boolean(tokens?.accessToken) &&
      (!Number.isFinite(expiresAtMs) || expiresAtMs > Date.now() + 60_000);

    if (hasUsableAccessToken) {
      return tokens!.accessToken!;
    }

    if (!tokens?.refreshToken) {
      throw new Error("Withings access token expired and no refresh token available");
    }

    const refreshed = await this.requestToken({
      grantType: "refresh_token",
      refreshToken: tokens.refreshToken
    });

    this.store.setWithingsTokens(this.userId, {
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
      accessToken: refreshed.accessToken,
      tokenExpiresAt: refreshed.expiresAt,
      userId: refreshed.userId ?? tokens.userId,
      scope: refreshed.scope ?? tokens.scope,
      connectedAt: tokens.connectedAt,
      source: tokens.source
    });

    return refreshed.accessToken;
  }

  isConnected(): boolean {
    const tokens = this.store.getWithingsTokens(this.userId);
    return Boolean(tokens?.refreshToken || tokens?.accessToken);
  }

  getConnectionInfo(): {
    connected: boolean;
    connectedAt?: string;
    source?: "oauth" | "env" | "unknown";
    userId?: string;
    hasRefreshToken?: boolean;
    hasAccessToken?: boolean;
    tokenExpiresAt?: string;
  } {
    const tokens = this.store.getWithingsTokens(this.userId);
    if (!tokens) {
      return { connected: false };
    }

    return {
      connected: true,
      connectedAt: tokens.connectedAt,
      source: tokens.source,
      ...(tokens.userId ? { userId: tokens.userId } : {}),
      hasRefreshToken: Boolean(tokens.refreshToken),
      hasAccessToken: Boolean(tokens.accessToken),
      ...(tokens.tokenExpiresAt ? { tokenExpiresAt: tokens.tokenExpiresAt } : {})
    };
  }
}
