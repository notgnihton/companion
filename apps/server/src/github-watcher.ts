/**
 * GitHub Watcher — lightweight SHA-based change detection.
 *
 * Instead of daily cron syncs, this polls HEAD refs every N hours.
 * When a repo's HEAD SHA changes, it triggers the GitHub Agent.
 * Uses minimal API calls: 1 request per repo per check.
 */

import { GitHubCourseClient } from "./github-course-client.js";
import { GeminiClient } from "./gemini.js";
import { RuntimeStore } from "./store.js";
import { runGitHubAgent, getTrackedRepos, type GitHubAgentResult, type TrackedRepo } from "./github-agent.js";

export interface WatcherState {
  /** SHA of HEAD for each repo (key: "owner/repo") */
  headShas: Record<string, string>;
  lastCheckedAt: string | null;
  lastAgentRunAt: string | null;
  lastAgentResult: GitHubAgentResult | null;
}

export class GitHubWatcher {
  private readonly store: RuntimeStore;
  private readonly userId: string;
  private readonly client: GitHubCourseClient;
  private readonly gemini: GeminiClient;
  private interval: ReturnType<typeof setInterval> | null = null;
  private state: WatcherState;
  private running = false;

  constructor(store: RuntimeStore, userId: string, gemini: GeminiClient, client?: GitHubCourseClient) {
    this.store = store;
    this.userId = userId;
    this.client = client ?? new GitHubCourseClient();
    this.gemini = gemini;
    this.state = this.loadState();
  }

  isConfigured(): boolean {
    return this.client.isConfigured() && this.gemini.isConfigured();
  }

  getState(): WatcherState {
    return { ...this.state };
  }

  /**
   * Start watching for changes. Default: check every 2 hours.
   * On first start (no stored SHAs), runs the agent immediately.
   */
  start(intervalMs = 2 * 60 * 60 * 1000): void {
    if (this.interval) return;

    // Run immediately on start
    void this.check();

    this.interval = setInterval(() => {
      void this.check();
    }, intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Check HEAD SHAs for all tracked repos.
   * If any changed (or first run), trigger the agent for changed repos.
   */
  async check(): Promise<{ changed: boolean; repos: string[]; agentResult?: GitHubAgentResult }> {
    if (!this.isConfigured() || this.running) {
      return { changed: false, repos: [] };
    }

    this.running = true;
    const changedRepos: TrackedRepo[] = [];

    try {
      const repos = getTrackedRepos(this.store, this.userId);
      if (repos.length === 0) {
        return { changed: false, repos: [] };
      }
      const isFirstRun = Object.keys(this.state.headShas).length === 0;

      // Collect previous SHAs BEFORE updating, for diff-based scanning
      const previousShasMap: Record<string, string> = {};
      const currentShasMap: Record<string, string> = {};

      for (const repo of repos) {
        const key = `${repo.owner}/${repo.repo}`;
        try {
          const headSha = await this.fetchHeadSha(repo.owner, repo.repo);
          const previousSha = this.state.headShas[key];

          if (previousSha !== headSha) {
            changedRepos.push(repo);
            if (previousSha) {
              previousShasMap[key] = previousSha;
            }
            currentShasMap[key] = headSha;
          }

          this.state.headShas[key] = headSha;
        } catch {
          // Skip repos that fail (private/deleted/rate-limited)
        }
      }

      this.state.lastCheckedAt = new Date().toISOString();
      this.saveState();

      // Trigger agent if repos changed (or first run = scan everything)
      if (changedRepos.length > 0 || isFirstRun) {
        const reposToScan = isFirstRun ? repos : changedRepos;
        // Pass previous/current SHAs for diff-based scanning (skip on first run — no base to diff from)
        const agentResult = isFirstRun
          ? await runGitHubAgent(this.store, this.gemini, this.userId, reposToScan)
          : await runGitHubAgent(this.store, this.gemini, this.userId, reposToScan, previousShasMap, currentShasMap);
        this.state.lastAgentRunAt = new Date().toISOString();
        this.state.lastAgentResult = agentResult;
        this.saveState();

        return {
          changed: true,
          repos: reposToScan.map((r) => `${r.owner}/${r.repo}`),
          agentResult,
        };
      }

      return { changed: false, repos: [] };
    } finally {
      this.running = false;
    }
  }

  /**
   * Force a full rescan of all repos (ignores SHA cache).
   */
  async forceRescan(): Promise<GitHubAgentResult> {
    this.running = true;
    try {
      const repos = getTrackedRepos(this.store, this.userId);
      const result = await runGitHubAgent(this.store, this.gemini, this.userId, repos);
      this.state.lastAgentRunAt = new Date().toISOString();
      this.state.lastAgentResult = result;

      // Update SHAs after rescan
      for (const repo of repos) {
        const key = `${repo.owner}/${repo.repo}`;
        try {
          const headSha = await this.fetchHeadSha(repo.owner, repo.repo);
          this.state.headShas[key] = headSha;
        } catch {
          // Skip
        }
      }
      this.state.lastCheckedAt = new Date().toISOString();
      this.saveState();

      return result;
    } finally {
      this.running = false;
    }
  }

  private async fetchHeadSha(owner: string, repo: string): Promise<string> {
    // Uses the git refs API — 1 lightweight call, no content transferred
    interface GitRef { object: { sha: string } }
    const baseUrl = "https://api.github.com";
    const token = this.client.getToken();
    const response = await fetch(`${baseUrl}/repos/${owner}/${repo}/git/ref/heads/main`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Companion-App",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch HEAD for ${owner}/${repo}: ${response.status}`);
    }

    const data = (await response.json()) as GitRef;
    return data.object.sha;
  }

  private loadState(): WatcherState {
    const githubData = this.store.getGitHubCourseData(this.userId);
    return {
      headShas: githubData?.blobIndex ?? {},
      lastCheckedAt: githubData?.lastSyncedAt ?? null,
      lastAgentRunAt: null,
      lastAgentResult: null,
    };
  }

  private saveState(): void {
    // Persist HEAD SHAs in the blobIndex field (repurposed for watcher state)
    const existing = this.store.getGitHubCourseData(this.userId);
    if (existing) {
      this.store.setGitHubCourseData(this.userId, {
        ...existing,
        blobIndex: this.state.headShas,
        lastSyncedAt: this.state.lastCheckedAt ?? existing.lastSyncedAt,
      });
    }
  }
}
