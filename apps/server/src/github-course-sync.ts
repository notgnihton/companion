import { RuntimeStore } from "./store.js";
import { GitHubCourseClient } from "./github-course-client.js";
import { Deadline, GitHubCourseDocument } from "./types.js";
import { SyncAutoHealingPolicy, SyncAutoHealingState } from "./sync-auto-healing.js";

export interface CourseRepo {
  owner: string;
  repo: string;
  courseCode: string;
}

export interface GitHubCourseSyncResult {
  success: boolean;
  reposProcessed: number;
  deadlinesCreated: number;
  deadlinesUpdated: number;
  courseDocsSynced: number;
  lastSyncedAt?: string;
  error?: string;
}

// Define the course repositories to sync
const COURSE_REPOS: CourseRepo[] = [
  { owner: "dat520-2026", repo: "assignments", courseCode: "DAT520" },
  { owner: "dat560-2026", repo: "info", courseCode: "DAT560" }
];

const COURSE_DOC_KEYWORDS = [
  /readme\.md$/i,
  /syllabus/i,
  /course[-_\s]?info/i,
  /overview/i,
  /schedule/i,
  /exam/i,
  /plan/i,
  /requirements?/i,
  /grading/i,
  /info\/.+\.md$/i
];

const EXCLUDED_DOC_PATHS = [
  /\/(node_modules|dist|build|vendor)\//i,
  /^\.github\//i
];

export class GitHubCourseSyncService {
  private readonly store: RuntimeStore;
  private readonly client: GitHubCourseClient;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private autoSyncInProgress = false;
  private autoSyncIntervalMs = 24 * 60 * 60 * 1000;
  private readonly autoHealing = new SyncAutoHealingPolicy({
    integration: "github",
    baseBackoffMs: 60_000,
    maxBackoffMs: 6 * 60 * 60 * 1000,
    circuitFailureThreshold: 4,
    circuitOpenMs: 60 * 60 * 1000
  });

  constructor(store: RuntimeStore, client?: GitHubCourseClient) {
    this.store = store;
    this.client = client ?? new GitHubCourseClient();
  }

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  /**
   * Start the GitHub course sync service with daily syncing
   */
  start(intervalMs: number = 24 * 60 * 60 * 1000): void {
    if (this.syncInterval) {
      return;
    }

    this.autoSyncIntervalMs = intervalMs;

    // Sync immediately on start
    void this.runAutoSync();

    // Then sync daily
    this.syncInterval = setInterval(() => {
      void this.runAutoSync();
    }, intervalMs);
  }

  /**
   * Stop the GitHub course sync service
   */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  /**
   * Parse deadline tables from markdown content
   * Looks for tables with columns: Lab, Deadline, etc.
   */
  parseDeadlines(markdown: string, courseCode: string): Array<Omit<Deadline, "id">> {
    const deadlines: Array<Omit<Deadline, "id">> = [];

    const lines = markdown.split("\n");
    let inTable = false;
    let headerIndices: { deadline?: number; task?: number } = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check if this is a table row
      if (!line.startsWith("|")) {
        inTable = false;
        headerIndices = {};
        continue;
      }

      const cells = line.split("|").map(cell => cell.trim()).filter(cell => cell.length > 0);

      if (cells.length === 0) continue;

      // Check if this is a separator row (e.g., |-----|------|)
      if (cells.every(cell => /^-+$/.test(cell))) {
        continue; // Skip separator rows
      }

      // Check if this is a header row
      if (!inTable) {
        // Look for deadline-related headers
        const hasDeadlineHeader = cells.some(cell =>
          /deadline|due.*date|date/i.test(cell)
        );
        const hasTaskHeader = cells.some(cell =>
          /lab|assignment|task|exercise/i.test(cell)
        );

        if (hasDeadlineHeader && hasTaskHeader) {
          inTable = true;

          // Map column indices
          cells.forEach((cell, idx) => {
            if (/deadline|due.*date|date/i.test(cell)) {
              headerIndices.deadline = idx;
            }
            if (/lab|assignment|task|exercise/i.test(cell)) {
              headerIndices.task = idx;
            }
          });
          continue;
        }
      }

      // Parse data rows
      if (inTable && headerIndices.deadline !== undefined && headerIndices.task !== undefined) {
        const taskCell = cells[headerIndices.task];
        const deadlineCell = cells[headerIndices.deadline];

        if (!taskCell || !deadlineCell) continue;

        // Skip empty or header-like rows (but allow longer lab names)
        if (/^(lab|assignment|task|deadline)$/i.test(taskCell)) continue;

        // Parse the deadline date
        const parsedDate = this.parseDate(deadlineCell);

        if (parsedDate) {
          deadlines.push({
            course: courseCode,
            task: taskCell,
            dueDate: parsedDate,
            priority: "medium",
            completed: false
          });
        }
      }
    }

    return deadlines;
  }

  /**
   * Parse various date formats into ISO string
   */
  private parseDate(dateStr: string): string | null {
    // Remove common markdown formatting
    const cleaned = dateStr.replace(/\*\*/g, "").trim();

    if (!cleaned || cleaned === "-" || cleaned === "TBA" || cleaned === "TBD") {
      return null;
    }

    // Try parsing as ISO date (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
      return cleaned;
    }

    // Try parsing other common formats
    const date = new Date(cleaned);

    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = `${date.getMonth() + 1}`.padStart(2, "0");
      const day = `${date.getDate()}`.padStart(2, "0");
      return `${year}-${month}-${day}`;
    }

    return null;
  }

  /**
   * Generate a unique key for a deadline based on course and task
   * Uses robust slugification to avoid collisions
   */
  private generateDeadlineKey(course: string, task: string): string {
    // Remove special characters and normalize spacing
    const slug = task
      .toLowerCase()
      .replace(/[^\w\s-]/g, "") // Remove punctuation except spaces and hyphens
      .replace(/\s+/g, "-")      // Replace spaces with hyphens
      .replace(/-+/g, "-")       // Collapse multiple hyphens
      .replace(/^-|-$/g, "");    // Remove leading/trailing hyphens

    return `github-${course.toLowerCase()}-${slug}`;
  }

  private textSnippet(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }

  private stripMarkdown(markdown: string): string {
    return markdown
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`]+`/g, " ")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private sanitizeLine(line: string): string {
    return line
      .replace(/^#{1,6}\s*/, "")
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/^\s*\d+\.\s+/, "")
      .replace(/`/g, "")
      .trim();
  }

  private extractDocTitle(markdown: string, path: string, courseCode: string): string {
    const headingMatch = markdown.match(/^#\s+(.+)$/m);
    if (headingMatch?.[1]) {
      return this.textSnippet(headingMatch[1].trim(), 120);
    }

    const fileName = path.split("/").at(-1) ?? `${courseCode} course info`;
    return this.textSnippet(fileName.replace(/\.md$/i, ""), 120);
  }

  private summarizeDocument(markdown: string): string {
    const plainText = this.stripMarkdown(markdown);
    if (!plainText) {
      return "No summary extracted.";
    }

    const sentences = plainText
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    if (sentences.length === 0) {
      return this.textSnippet(plainText, 320);
    }

    const summary = sentences.slice(0, 3).join(" ");
    return this.textSnippet(summary, 320);
  }

  private extractHighlights(markdown: string): string[] {
    const highlightKeywords =
      /\b(deadline|due|exam|project|assignment|grading|attendance|schedule|lecture|lab|module|office hour|policy|deliverable)\b/i;

    const candidateLines = markdown
      .split("\n")
      .map((line) => this.sanitizeLine(line))
      .filter((line) => line.length >= 12);

    const keywordMatches = candidateLines
      .filter((line) => highlightKeywords.test(line))
      .slice(0, 4)
      .map((line) => this.textSnippet(line, 140));

    if (keywordMatches.length > 0) {
      return keywordMatches;
    }

    return candidateLines.slice(0, 3).map((line) => this.textSnippet(line, 140));
  }

  private isCourseDocPath(path: string): boolean {
    if (!/\.md$/i.test(path)) {
      return false;
    }

    const normalized = path.toLowerCase();
    if (EXCLUDED_DOC_PATHS.some((pattern) => pattern.test(normalized))) {
      return false;
    }

    if (normalized.startsWith("assignments/") && !normalized.endsWith("readme.md")) {
      return false;
    }

    return COURSE_DOC_KEYWORDS.some((pattern) => pattern.test(normalized));
  }

  private rankCourseDocPath(path: string): number {
    const normalized = path.toLowerCase();
    let score = 0;

    if (normalized.endsWith("readme.md")) score += 6;
    if (normalized.includes("syllabus")) score += 8;
    if (normalized.includes("course-info") || normalized.includes("course_info")) score += 7;
    if (normalized.includes("overview")) score += 5;
    if (normalized.includes("schedule")) score += 4;
    if (normalized.includes("exam")) score += 4;
    if (normalized.includes("grading")) score += 4;
    if (normalized.includes("/info/")) score += 3;
    if (!normalized.includes("/")) score += 2;
    if (normalized.includes("/assignments/")) score -= 3;

    return score;
  }

  private buildCourseDocument(repo: CourseRepo, path: string, markdown: string, syncedAt: string): GitHubCourseDocument | null {
    const plainText = this.stripMarkdown(markdown);
    if (!plainText) {
      return null;
    }

    const sourceKey = `${repo.owner}/${repo.repo}/${path}`;
    const encodedSourceKey = Buffer.from(sourceKey).toString("base64url").slice(0, 32);

    return {
      id: `github-doc-${repo.courseCode.toLowerCase()}-${encodedSourceKey}`,
      courseCode: repo.courseCode,
      owner: repo.owner,
      repo: repo.repo,
      path,
      url: `https://github.com/${repo.owner}/${repo.repo}/blob/HEAD/${path}`,
      title: this.extractDocTitle(markdown, path, repo.courseCode),
      summary: this.summarizeDocument(markdown),
      highlights: this.extractHighlights(markdown),
      snippet: this.textSnippet(plainText, 900),
      syncedAt
    };
  }

  private async extractCourseDocuments(repo: CourseRepo, syncedAt: string, readmeMarkdown?: string): Promise<GitHubCourseDocument[]> {
    let candidates: string[] = ["README.md"];

    try {
      const files = await this.client.listRepositoryFiles(repo.owner, repo.repo);
      const discovered = files
        .filter((path) => this.isCourseDocPath(path))
        .sort((a, b) => this.rankCourseDocPath(b) - this.rankCourseDocPath(a));
      candidates = [...new Set(["README.md", ...discovered])];
    } catch {
      // Fallback to README-only extraction when tree API is unavailable.
    }

    const docs: GitHubCourseDocument[] = [];
    for (const path of candidates.slice(0, 6)) {
      try {
        const markdown =
          path === "README.md" && readmeMarkdown !== undefined
            ? readmeMarkdown
            : path === "README.md"
              ? await this.client.getReadme(repo.owner, repo.repo)
            : await this.client.getFileContent(repo.owner, repo.repo, path);
        const doc = this.buildCourseDocument(repo, path, markdown, syncedAt);
        if (doc) {
          docs.push(doc);
        }
      } catch {
        // Continue with remaining files when one file cannot be fetched.
      }
    }

    return docs;
  }

  /**
   * Perform a GitHub course sync
   */
  async sync(): Promise<GitHubCourseSyncResult> {
    let deadlinesCreated = 0;
    let deadlinesUpdated = 0;
    let deadlinesObserved = 0;
    let reposProcessed = 0;
    const syncErrors: string[] = [];
    const courseDocuments: GitHubCourseDocument[] = [];
    const lastSyncedAt = new Date().toISOString();

    try {
      for (const repo of COURSE_REPOS) {
        try {
          const readme = await this.client.getReadme(repo.owner, repo.repo);
          const parsedDeadlines = this.parseDeadlines(readme, repo.courseCode);
          deadlinesObserved += parsedDeadlines.length;

          // Get existing deadlines from this source
          const existingDeadlines = this.store.getDeadlines();
          const existingMap = new Map<string, Deadline>();

          for (const deadline of existingDeadlines) {
            const key = this.generateDeadlineKey(deadline.course, deadline.task);
            existingMap.set(key, deadline);
          }

          // Create or update deadlines
          for (const newDeadline of parsedDeadlines) {
            const key = this.generateDeadlineKey(newDeadline.course, newDeadline.task);
            const existing = existingMap.get(key);

            if (!existing) {
              // Create new deadline
              this.store.createDeadline(newDeadline);
              deadlinesCreated++;
            } else if (existing.dueDate !== newDeadline.dueDate && !existing.completed) {
              // Update deadline if date changed and it's not completed
              this.store.updateDeadline(existing.id, {
                dueDate: newDeadline.dueDate
              });
              deadlinesUpdated++;
            }
          }

          const repoDocs = await this.extractCourseDocuments(repo, lastSyncedAt, readme);
          courseDocuments.push(...repoDocs);
          reposProcessed++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          syncErrors.push(`${repo.owner}/${repo.repo}: ${errorMessage}`);
        }
      }

      if (reposProcessed > 0) {
        this.store.setGitHubCourseData({
          repositories: COURSE_REPOS,
          documents: courseDocuments,
          deadlinesSynced: deadlinesObserved,
          lastSyncedAt
        });
      }

      return {
        success: reposProcessed > 0,
        reposProcessed,
        deadlinesCreated,
        deadlinesUpdated,
        courseDocsSynced: courseDocuments.length,
        lastSyncedAt,
        error: syncErrors.length > 0 ? syncErrors.join(" | ") : undefined
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      return {
        success: false,
        reposProcessed,
        deadlinesCreated,
        deadlinesUpdated,
        courseDocsSynced: courseDocuments.length,
        lastSyncedAt,
        error: errorMessage
      };
    }
  }

  /**
   * Manually trigger a sync
   */
  async triggerSync(): Promise<GitHubCourseSyncResult> {
    return this.sync();
  }

  getAutoHealingStatus(): SyncAutoHealingState {
    return this.autoHealing.getState();
  }

  private scheduleAutoRetry(): void {
    if (!this.syncInterval || this.retryTimeout) {
      return;
    }

    const nextAttemptAt = this.autoHealing.getState().nextAttemptAt;
    if (!nextAttemptAt) {
      return;
    }

    const delay = Date.parse(nextAttemptAt) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0 || delay >= this.autoSyncIntervalMs) {
      return;
    }

    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      void this.runAutoSync();
    }, delay);
  }

  private async runAutoSync(): Promise<void> {
    if (!this.client.isConfigured() || this.autoSyncInProgress) {
      return;
    }

    const decision = this.autoHealing.canAttempt();
    if (!decision.allowed) {
      this.autoHealing.recordSkip(decision.reason ?? "backoff");
      return;
    }

    this.autoSyncInProgress = true;
    try {
      const result = await this.sync();
      if (result.success) {
        this.autoHealing.recordSuccess();
      } else {
        this.autoHealing.recordFailure(result.error);
        this.scheduleAutoRetry();
      }
    } finally {
      this.autoSyncInProgress = false;
    }
  }
}
