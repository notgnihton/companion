import { createHmac } from "crypto";
import { config } from "./config.js";

export interface XTweet {
  id: string;
  text: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  createdAt: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  conversationId: string;
}

export interface XUser {
  id: string;
  username: string;
  name: string;
  description: string;
  profileImageUrl: string;
  followersCount: number;
  followingCount: number;
}

export class XAPIError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "XAPIError";
  }
}

export class XRateLimitError extends XAPIError {
  constructor(message = "X API rate limit exceeded") {
    super(message, 429);
    this.name = "XRateLimitError";
  }
}

/**
 * X (Twitter) API v2 client with OAuth 1.0a authentication
 */
export class XClient {
  private readonly apiKey: string | null;
  private readonly apiKeySecret: string | null;
  private readonly accessToken: string | null;
  private readonly accessTokenSecret: string | null;
  private readonly bearerToken: string | null;
  private readonly fallbackQuery: string;
  private readonly baseUrl = "https://api.x.com/2";

  constructor(
    apiKey?: string,
    apiKeySecret?: string,
    accessToken?: string,
    accessTokenSecret?: string,
    bearerToken?: string,
    fallbackQuery?: string
  ) {
    this.apiKey = this.sanitizeCredential(apiKey ?? config.X_API_KEY ?? null);
    this.apiKeySecret = this.sanitizeCredential(apiKeySecret ?? config.X_API_KEY_SECRET ?? null);
    this.accessToken = this.sanitizeCredential(accessToken ?? config.X_ACCESS_TOKEN ?? null);
    this.accessTokenSecret = this.sanitizeCredential(accessTokenSecret ?? config.X_ACCESS_TOKEN_SECRET ?? null);
    const resolvedBearer = this.sanitizeCredential(bearerToken ?? config.X_BEARER_TOKEN ?? null);
    this.bearerToken = resolvedBearer ? resolvedBearer.replace(/^Bearer\s+/i, "") : null;
    this.fallbackQuery = fallbackQuery ?? config.X_FALLBACK_QUERY ?? "(machine learning OR distributed systems OR software engineering) -is:retweet lang:en";
  }

  private sanitizeCredential(value: string | null): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
    return trimmed.length > 0 ? trimmed : null;
  }

  private isOAuthConfigured(): boolean {
    return (
      this.apiKey !== null &&
      this.apiKey !== "" &&
      this.apiKeySecret !== null &&
      this.apiKeySecret !== "" &&
      this.accessToken !== null &&
      this.accessToken !== "" &&
      this.accessTokenSecret !== null &&
      this.accessTokenSecret !== ""
    );
  }

  private isBearerConfigured(): boolean {
    return this.bearerToken !== null && this.bearerToken !== "";
  }

  isConfigured(): boolean {
    return this.isOAuthConfigured() || this.isBearerConfigured();
  }

  /**
   * Generate OAuth 1.0a signature for API requests
   */
  private generateOAuthSignature(
    method: string,
    url: string,
    params: Record<string, string>
  ): string {
    // Create signing key
    const signingKey = `${encodeURIComponent(this.apiKeySecret!)}&${encodeURIComponent(this.accessTokenSecret!)}`;

    // Create parameter string (sorted by key)
    const sortedKeys = Object.keys(params).sort();
    const paramString = sortedKeys
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key]!)}`)
      .join("&");

    // Create signature base string
    const signatureBaseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;

    // Generate signature
    const signature = createHmac("sha1", signingKey)
      .update(signatureBaseString)
      .digest("base64");

    return signature;
  }

  /**
   * Generate OAuth 1.0a authorization header
   */
  private generateOAuthHeader(method: string, url: string, queryParams: Record<string, string> = {}): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.apiKey!,
      oauth_token: this.accessToken!,
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: timestamp,
      oauth_nonce: nonce,
      oauth_version: "1.0",
      ...queryParams
    };

    const signature = this.generateOAuthSignature(method, url, oauthParams);
    oauthParams.oauth_signature = signature;

    // Build authorization header
    const authHeader = "OAuth " + Object.keys(oauthParams)
      .filter(key => key.startsWith("oauth_"))
      .sort()
      .map(key => `${encodeURIComponent(key)}="${encodeURIComponent(oauthParams[key]!)}"`
      )
      .join(", ");

    return authHeader;
  }

  /**
   * Fetch data from X API with OAuth 1.0a authentication
   */
  private async fetch<T>(endpoint: string, queryParams: Record<string, string> = {}): Promise<T> {
    if (!this.isConfigured()) {
      throw new XAPIError("X API credentials not configured");
    }

    const url = `${this.baseUrl}${endpoint}`;
    const queryString = Object.keys(queryParams).length > 0
      ? "?" + new URLSearchParams(queryParams).toString()
      : "";
    const fullUrl = url + queryString;

    const headers: Record<string, string> = {
      "User-Agent": "Companion-App"
    };

    if (this.isOAuthConfigured()) {
      headers.Authorization = this.generateOAuthHeader("GET", url, queryParams);
    } else if (this.isBearerConfigured()) {
      headers.Authorization = `Bearer ${this.bearerToken}`;
    }

    try {
      const response = await fetch(fullUrl, {
        headers
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new XRateLimitError();
        }
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = (errorData as any)?.detail ?? (errorData as any)?.title ?? response.statusText;
        throw new XAPIError(`X API error: ${errorMessage}`, response.status);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof XAPIError) {
        throw error;
      }
      throw new XAPIError(
        `Failed to fetch from X API: ${error instanceof Error ? error.message : "Unknown error"}`,
        undefined,
        error
      );
    }
  }

  /**
   * Fetch home timeline (reverse chronological tweets from followed accounts)
   * Returns up to 100 tweets from the last 7 days
   */
  async fetchHomeTimeline(maxResults: number = 50): Promise<XTweet[]> {
    if (this.isOAuthConfigured()) {
      try {
        const params: Record<string, string> = {
          "tweet.fields": "created_at,public_metrics,conversation_id,author_id",
          "user.fields": "username,name",
          expansions: "author_id",
          max_results: String(Math.min(maxResults, 100))
        };

        const data = await this.fetch<any>("/users/me/timelines/reverse_chronological", params);
        
        const tweets: XTweet[] = [];
        const users = new Map<string, { username: string; name: string }>();

        // Build user lookup map
        if (data.includes?.users) {
          for (const user of data.includes.users) {
            users.set(user.id, { username: user.username, name: user.name });
          }
        }

        // Parse tweets
        for (const tweet of data.data || []) {
          const author = users.get(tweet.author_id) ?? { username: "unknown", name: "Unknown" };
          tweets.push({
            id: tweet.id,
            text: tweet.text,
            authorId: tweet.author_id,
            authorUsername: author.username,
            authorName: author.name,
            createdAt: tweet.created_at,
            likeCount: tweet.public_metrics?.like_count ?? 0,
            retweetCount: tweet.public_metrics?.retweet_count ?? 0,
            replyCount: tweet.public_metrics?.reply_count ?? 0,
            conversationId: tweet.conversation_id
          });
        }

        return tweets;
      } catch (error) {
        if (error instanceof XAPIError) {
          throw error;
        }
        throw new XAPIError(
          `Failed to fetch home timeline: ${error instanceof Error ? error.message : "Unknown error"}`,
          undefined,
          error
        );
      }
    }

    if (this.isBearerConfigured()) {
      return this.fetchRecentSearch(maxResults);
    }

    throw new XAPIError(
      "X API credentials not configured. Provide OAuth credentials or X_BEARER_TOKEN."
    );
  }

  /**
   * Fetch recent tweets from a specific user
   */
  async fetchUserTweets(userId: string, maxResults: number = 10): Promise<XTweet[]> {
    if (!this.isConfigured()) {
      throw new XAPIError("X API credentials not configured");
    }

    try {
      const params: Record<string, string> = {
        "tweet.fields": "created_at,public_metrics,conversation_id,author_id",
        max_results: String(Math.min(maxResults, 100))
      };

      const data = await this.fetch<any>(`/users/${userId}/tweets`, params);

      const tweets: XTweet[] = [];

      for (const tweet of data.data || []) {
        tweets.push({
          id: tweet.id,
          text: tweet.text,
          authorId: tweet.author_id,
          authorUsername: "", // Not included in this endpoint
          authorName: "",
          createdAt: tweet.created_at,
          likeCount: tweet.public_metrics?.like_count ?? 0,
          retweetCount: tweet.public_metrics?.retweet_count ?? 0,
          replyCount: tweet.public_metrics?.reply_count ?? 0,
          conversationId: tweet.conversation_id
        });
      }

      return tweets;
    } catch (error) {
      if (error instanceof XAPIError) {
        throw error;
      }
      throw new XAPIError(
        `Failed to fetch user tweets: ${error instanceof Error ? error.message : "Unknown error"}`,
        undefined,
        error
      );
    }
  }

  private async fetchRecentSearch(maxResults: number): Promise<XTweet[]> {
    const params: Record<string, string> = {
      query: this.fallbackQuery,
      "tweet.fields": "created_at,public_metrics,conversation_id,author_id",
      "user.fields": "username,name",
      expansions: "author_id",
      max_results: String(Math.min(maxResults, 100))
    };

    const data = await this.fetch<any>("/tweets/search/recent", params);
    const tweets: XTweet[] = [];
    const users = new Map<string, { username: string; name: string }>();

    if (data.includes?.users) {
      for (const user of data.includes.users) {
        users.set(user.id, { username: user.username, name: user.name });
      }
    }

    for (const tweet of data.data || []) {
      const author = users.get(tweet.author_id) ?? { username: "unknown", name: "Unknown" };
      tweets.push({
        id: tweet.id,
        text: tweet.text,
        authorId: tweet.author_id ?? "unknown",
        authorUsername: author.username,
        authorName: author.name,
        createdAt: tweet.created_at,
        likeCount: tweet.public_metrics?.like_count ?? 0,
        retweetCount: tweet.public_metrics?.retweet_count ?? 0,
        replyCount: tweet.public_metrics?.reply_count ?? 0,
        conversationId: tweet.conversation_id ?? tweet.id
      });
    }

    return tweets;
  }
}

let defaultClient: XClient | null = null;

export function getXClient(): XClient {
  if (!defaultClient) {
    defaultClient = new XClient();
  }
  return defaultClient;
}
