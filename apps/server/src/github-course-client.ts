import { config } from "./config.js";

export interface GitHubFileContent {
  content: string;
  encoding: string;
  name: string;
  path: string;
  sha: string;
}

interface GitHubRepositoryTree {
  tree: Array<{
    path: string;
    type: "blob" | "tree";
  }>;
}

export class GitHubCourseClient {
  private readonly token: string | undefined;
  private readonly baseUrl = "https://api.github.com";

  constructor(token?: string) {
    this.token = token ?? config.GITHUB_PAT;
  }

  isConfigured(): boolean {
    return Boolean(this.token);
  }

  private decodeContent(data: GitHubFileContent): string {
    if (data.encoding === "base64") {
      // GitHub often inserts newlines in base64 payloads.
      return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
    }

    return data.content;
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    if (!this.token) {
      throw new Error("GitHub PAT not configured (set GITHUB_PAT)");
    }

    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Companion-App"
      }
    });

    if (!response.ok) {
      let errorDetail = response.statusText;
      try {
        const body = (await response.json()) as { message?: string };
        if (body.message) {
          errorDetail = body.message;
        }
      } catch {
        // Keep default status text when body isn't JSON.
      }
      throw new Error(`GitHub API error (${response.status}): ${errorDetail}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetch the content of a file from a GitHub repository
   */
  async getFileContent(owner: string, repo: string, path: string): Promise<string> {
    const encodedPath = path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const data = await this.fetch<GitHubFileContent>(
      `/repos/${owner}/${repo}/contents/${encodedPath}`
    );

    return this.decodeContent(data);
  }

  /**
   * Fetch README from a repository (supports non-root paths via GitHub's readme endpoint).
   */
  async getReadme(owner: string, repo: string): Promise<string> {
    const data = await this.fetch<GitHubFileContent>(`/repos/${owner}/${repo}/readme`);
    return this.decodeContent(data);
  }

  /**
   * List repository file paths using a recursive tree lookup.
   */
  async listRepositoryFiles(owner: string, repo: string): Promise<string[]> {
    const data = await this.fetch<GitHubRepositoryTree>(
      `/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`
    );

    return data.tree
      .filter((entry) => entry.type === "blob")
      .map((entry) => entry.path);
  }
}
