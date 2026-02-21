import { describe, expect, it } from "vitest";
import { GmailOAuthService } from "./gmail-oauth.js";
import { RuntimeStore } from "./store.js";

interface TokenListenerPayload {
  refresh_token?: string;
  access_token?: string;
}

class FakeOAuth2Client {
  private tokenListener: ((tokens: TokenListenerPayload) => void) | null = null;
  public readonly setCredentialsCalls: Array<Record<string, unknown>> = [];
  public getAccessTokenCalls = 0;
  public throwOnRefresh = false;
  public refreshedAccessToken: string | null = null;

  setCredentials(credentials: Record<string, unknown>): void {
    this.setCredentialsCalls.push(credentials);
  }

  on(event: string, listener: (tokens: TokenListenerPayload) => void): this {
    if (event === "tokens") {
      this.tokenListener = listener;
    }
    return this;
  }

  async getAccessToken(): Promise<{ token: string | null }> {
    this.getAccessTokenCalls += 1;
    if (this.throwOnRefresh) {
      throw new Error("refresh failed");
    }

    if (this.refreshedAccessToken) {
      this.tokenListener?.({ access_token: this.refreshedAccessToken });
    }

    return { token: this.refreshedAccessToken };
  }
}

class TestableGmailOAuthService extends GmailOAuthService {
  constructor(
    store: RuntimeStore,
    userId: string,
    private readonly fakeOAuthClient: FakeOAuth2Client
  ) {
    super(store, userId);
  }

  override getOAuth2Client(): ReturnType<GmailOAuthService["getOAuth2Client"]> {
    return this.fakeOAuthClient as unknown as ReturnType<GmailOAuthService["getOAuth2Client"]>;
  }
}

describe("GmailOAuthService", () => {
  const userId = "test-user";

  it("refreshes access token using refresh token before returning client", async () => {
    const store = new RuntimeStore(":memory:");
    const fakeClient = new FakeOAuth2Client();
    fakeClient.refreshedAccessToken = "fresh-access-token";
    const service = new TestableGmailOAuthService(store, userId, fakeClient);

    store.setGmailTokens(userId, {
      refreshToken: "refresh-token",
      accessToken: "expired-access-token",
      email: "lucy@example.com",
      connectedAt: "2026-02-17T18:00:00.000Z",
      source: "env"
    });

    await service.getAuthenticatedClient();

    expect(fakeClient.getAccessTokenCalls).toBe(1);

    const tokens = store.getGmailTokens(userId);
    expect(tokens?.refreshToken).toBe("refresh-token");
    expect(tokens?.accessToken).toBe("fresh-access-token");
  });

  it("falls back to existing access token if refresh fails but access token exists", async () => {
    const store = new RuntimeStore(":memory:");
    const fakeClient = new FakeOAuth2Client();
    fakeClient.throwOnRefresh = true;
    const service = new TestableGmailOAuthService(store, userId, fakeClient);

    store.setGmailTokens(userId, {
      refreshToken: "refresh-token",
      accessToken: "existing-access-token",
      email: "lucy@example.com",
      connectedAt: "2026-02-17T18:00:00.000Z",
      source: "env"
    });

    await expect(service.getAuthenticatedClient()).resolves.toBeDefined();
    expect(fakeClient.getAccessTokenCalls).toBe(1);
    expect(store.getGmailTokens(userId)?.accessToken).toBe("existing-access-token");
  });

  it("throws when refresh fails and no access token is available", async () => {
    const store = new RuntimeStore(":memory:");
    const fakeClient = new FakeOAuth2Client();
    fakeClient.throwOnRefresh = true;
    const service = new TestableGmailOAuthService(store, userId, fakeClient);

    store.setGmailTokens(userId, {
      refreshToken: "refresh-token",
      email: "lucy@example.com",
      connectedAt: "2026-02-17T18:00:00.000Z",
      source: "env"
    });

    await expect(service.getAuthenticatedClient()).rejects.toThrow("Failed to refresh Gmail access token");
  });

  it("uses access-token-only mode without refresh when no refresh token exists", async () => {
    const store = new RuntimeStore(":memory:");
    const fakeClient = new FakeOAuth2Client();
    const service = new TestableGmailOAuthService(store, userId, fakeClient);

    store.setGmailTokens(userId, {
      accessToken: "access-only-token",
      email: "lucy@example.com",
      connectedAt: "2026-02-17T18:00:00.000Z",
      source: "env"
    });

    await expect(service.getAuthenticatedClient()).resolves.toBeDefined();
    expect(fakeClient.getAccessTokenCalls).toBe(0);
  });
});

