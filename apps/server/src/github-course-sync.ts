import { RuntimeStore } from "./store.js";
import { GitHubCourseClient } from "./github-course-client.js";
import { Deadline, GitHubCourseDocument } from "./types.js";
import { SyncAutoHealingPolicy, SyncAutoHealingState } from "./sync-auto-healing.js";
import { hasAssignmentOrExamKeyword } from "./deadline-eligibility.js";
import { publishNewDeadlineReleaseNotifications } from "./deadline-release-notifications.js";

export interface CourseRepo {
  owner: string;
  repo: string;
  courseCode: string;
  deadlinePathHints?: string[];
  publicPagesBaseUrl?: string;
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
  {
    owner: "dat520-2026",
    repo: "info",
    courseCode: "DAT520",
    deadlinePathHints: ["lab-plan.md", "assignments.md", "deadlines.md"],
    publicPagesBaseUrl: "https://dat520.github.io"
  },
  {
    owner: "dat520-2026",
    repo: "assignments",
    courseCode: "DAT520",
    deadlinePathHints: ["README.md"]
  },
  {
    owner: "dat560-2026",
    repo: "info",
    courseCode: "DAT560",
    deadlinePathHints: ["assignments.md", "lab-plan.md", "deadlines.md", "project.md"]
  }
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
    let headerIndices: { deadline?: number; task?: number; lab?: number; topic?: number } = {};
    let tableLooksLikeDeliverables = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check if this is a table row
      if (!line.startsWith("|")) {
        inTable = false;
        headerIndices = {};
        tableLooksLikeDeliverables = false;
        continue;
      }

      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());

      if (cells.length === 0) continue;

      // Check if this is a separator row (e.g., |-----|------|)
      if (cells.every((cell) => /^:?-+:?$/.test(cell))) {
        continue; // Skip separator rows
      }

      // Check if this is a header row
      if (!inTable) {
        // Look for deadline-related headers
        const hasDeadlineHeader = cells.some(cell =>
          /deadline|due.*date|date/i.test(cell)
        );
        const hasTaskHeader = cells.some((cell) =>
          /assignment|exam|task|deliverable|activity|topic|lab/i.test(cell)
        );
        const hasDateHeader = cells.some((cell) => /\bdate\b/i.test(cell));
        const hasScheduleTopicHeader = cells.some((cell) => /topic|activity|event/i.test(cell));

        if ((hasDeadlineHeader && hasTaskHeader) || (!hasDeadlineHeader && hasDateHeader && hasScheduleTopicHeader)) {
          inTable = true;
          tableLooksLikeDeliverables = cells.some((cell) =>
            /assignment|exam|deliverable|activity|lab/i.test(cell)
          );

          // Map column indices
          cells.forEach((cell, idx) => {
            if (/deadline|due.*date|date/i.test(cell)) {
              headerIndices.deadline = idx;
            } else if (headerIndices.deadline === undefined && /\bdate\b/i.test(cell)) {
              headerIndices.deadline = idx;
            }
            if (/assignment|exam|task|deliverable|activity|event/i.test(cell)) {
              headerIndices.task = idx;
            }
            if (/lab/i.test(cell)) {
              headerIndices.lab = idx;
            }
            if (/topic/i.test(cell)) {
              headerIndices.topic = idx;
            }
          });
          continue;
        }
      }

      // Parse data rows
      if (inTable && headerIndices.deadline !== undefined) {
        const taskCell = this.resolveTaskCell(cells, headerIndices, tableLooksLikeDeliverables);
        const deadlineCell = cells[headerIndices.deadline];

        if (!taskCell || !deadlineCell) continue;

        // Skip empty/header-like rows and rows that are not assignment/exam-like work items.
        if (/^(assignment|exam|task|deadline|lab|topic)$/i.test(taskCell)) continue;
        if (!this.isAssignmentOrExamTask(taskCell)) continue;

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

    // European day-first formats (e.g., 28.01.2026, 22.02.2026 23.59)
    const dayMonthYear = this.parseDayMonthYear(cleaned);
    if (dayMonthYear) {
      return dayMonthYear;
    }

    // Month + day without explicit year (e.g., "January 15", "Feb 12").
    const monthDay = this.parseMonthDayWithoutYear(cleaned);
    if (monthDay) {
      return monthDay;
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

  private parseDayMonthYear(raw: string): string | null {
    const normalized = raw.replace(/\s+/g, " ").trim();
    const match = normalized.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+\d{1,2}[:.]\d{1,2})?$/);
    if (!match) {
      return null;
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);

    if (day < 1 || day > 31 || month < 1 || month > 12) {
      return null;
    }

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  private parseMonthDayWithoutYear(raw: string): string | null {
    const normalized = raw.replace(/\./g, "").replace(/\s+/g, " ").trim();
    const monthMap: Record<string, number> = {
      jan: 1,
      january: 1,
      feb: 2,
      february: 2,
      mar: 3,
      march: 3,
      apr: 4,
      april: 4,
      may: 5,
      jun: 6,
      june: 6,
      jul: 7,
      july: 7,
      aug: 8,
      august: 8,
      sep: 9,
      sept: 9,
      september: 9,
      oct: 10,
      october: 10,
      nov: 11,
      november: 11,
      dec: 12,
      december: 12
    };

    const monthDayMatch = normalized.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
    if (monthDayMatch) {
      const month = monthMap[monthDayMatch[1].toLowerCase()];
      const day = Number(monthDayMatch[2]);
      if (!month || day < 1 || day > 31) {
        return null;
      }
      const year = new Date().getUTCFullYear();
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    const dayMonthMatch = normalized.match(/^(\d{1,2})\s+([A-Za-z]+)$/);
    if (dayMonthMatch) {
      const day = Number(dayMonthMatch[1]);
      const month = monthMap[dayMonthMatch[2].toLowerCase()];
      if (!month || day < 1 || day > 31) {
        return null;
      }
      const year = new Date().getUTCFullYear();
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    return null;
  }

  private stripMarkdownInline(text: string): string {
    return text
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]+\]/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  private resolveTaskCell(
    cells: string[],
    headerIndices: { deadline?: number; task?: number; lab?: number; topic?: number },
    tableLooksLikeDeliverables: boolean
  ): string | null {
    const taskCell = headerIndices.task !== undefined ? cells[headerIndices.task] : "";
    const labCell = headerIndices.lab !== undefined ? cells[headerIndices.lab] : "";
    const topicCell = headerIndices.topic !== undefined ? cells[headerIndices.topic] : "";

    const normalizedTask = this.stripMarkdownInline(taskCell ?? "");
    const normalizedLab = this.stripMarkdownInline(labCell ?? "");
    const normalizedTopic = this.stripMarkdownInline(topicCell ?? "");

    if (normalizedTask.length > 0) {
      if (this.isAssignmentOrExamTask(normalizedTask)) {
        return normalizedTask;
      }

      if (tableLooksLikeDeliverables) {
        return `Assignment: ${normalizedTask}`;
      }
    }

    if (normalizedLab.length > 0 && normalizedTopic.length > 0) {
      return `Assignment Lab ${normalizedLab}: ${normalizedTopic}`;
    }

    if (normalizedLab.length > 0) {
      return `Assignment Lab ${normalizedLab}`;
    }

    if (normalizedTopic.length > 0 && this.isAssignmentOrExamTask(normalizedTopic)) {
      return normalizedTopic;
    }

    if (normalizedTopic.length > 0 && tableLooksLikeDeliverables) {
      return `Assignment: ${normalizedTopic}`;
    }

    return null;
  }

  private isAssignmentOrExamTask(task: string): boolean {
    const normalized = task.replace(/\*\*/g, "").trim();
    return hasAssignmentOrExamKeyword(normalized);
  }

  private async fetchPublicPageMarkdown(repo: CourseRepo, path: string): Promise<string> {
    if (!repo.publicPagesBaseUrl) {
      throw new Error("Public course page fallback is not configured.");
    }

    const normalizedPath = path.replace(/^\/+/, "");
    const base = repo.publicPagesBaseUrl.replace(/\/+$/, "");
    const url = `${base}/${normalizedPath}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Companion-App"
      }
    });

    if (!response.ok) {
      throw new Error(`Public course page fetch failed (${response.status}) for ${url}`);
    }

    return response.text();
  }

  private async getRepoReadme(repo: CourseRepo): Promise<string> {
    try {
      return await this.client.getReadme(repo.owner, repo.repo);
    } catch (primaryError) {
      if (!repo.publicPagesBaseUrl) {
        throw primaryError;
      }
      return this.fetchPublicPageMarkdown(repo, "README.md");
    }
  }

  private async getRepoFileContent(repo: CourseRepo, path: string): Promise<string> {
    try {
      return await this.client.getFileContent(repo.owner, repo.repo, path);
    } catch (primaryError) {
      if (!repo.publicPagesBaseUrl) {
        throw primaryError;
      }
      return this.fetchPublicPageMarkdown(repo, path);
    }
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

  private isDeadlineDocPath(path: string): boolean {
    if (!/\.md$/i.test(path)) {
      return false;
    }

    const normalized = path.toLowerCase();
    if (EXCLUDED_DOC_PATHS.some((pattern) => pattern.test(normalized))) {
      return false;
    }
    if (/(lecture[-_\s]?plan|lecture[-_\s]?notes)/i.test(normalized)) {
      return false;
    }

    return (
      normalized.endsWith("readme.md") ||
      /(lab[-_\s]?plan|assignment|deadline|due|exam|project|oblig|innlevering|problem[-_\s]?set|pset)/i.test(
        normalized
      )
    );
  }

  private rankDeadlineDocPath(path: string): number {
    const normalized = path.toLowerCase();
    let score = 0;
    if (normalized.includes("lab-plan")) score += 12;
    if (normalized.includes("assignment")) score += 10;
    if (normalized.includes("deadline") || normalized.includes("due")) score += 9;
    if (normalized.includes("exam")) score += 8;
    if (normalized.includes("project")) score += 6;
    if (normalized.endsWith("readme.md")) score += 2;
    if (normalized.includes("schedule")) score -= 4;
    return score;
  }

  private dedupeParsedDeadlines(deadlines: Array<Omit<Deadline, "id">>): Array<Omit<Deadline, "id">> {
    const deduped = new Map<string, Omit<Deadline, "id">>();

    deadlines.forEach((deadline) => {
      const key = this.generateDeadlineKey(deadline.course, deadline.task);
      if (!deduped.has(key)) {
        deduped.set(key, deadline);
      }
    });

    return Array.from(deduped.values());
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
              ? await this.getRepoReadme(repo)
              : await this.getRepoFileContent(repo, path);
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
    const createdDeadlines: Deadline[] = [];
    const syncErrors: string[] = [];
    const courseDocuments: GitHubCourseDocument[] = [];
    const lastSyncedAt = new Date().toISOString();

    try {
      for (const repo of COURSE_REPOS) {
        try {
          const readme = await this.getRepoReadme(repo);
          const deadlineSourcePaths = new Set<string>(["README.md"]);
          (repo.deadlinePathHints ?? []).forEach((path) => {
            const normalized = path.trim();
            if (normalized) {
              deadlineSourcePaths.add(normalized);
            }
          });
          try {
            const files = await this.client.listRepositoryFiles(repo.owner, repo.repo);
            files
              .filter((path) => this.isDeadlineDocPath(path))
              .sort((a, b) => this.rankDeadlineDocPath(b) - this.rankDeadlineDocPath(a))
              .slice(0, 12)
              .forEach((path) => deadlineSourcePaths.add(path));
          } catch {
            // Fall back to README-only parsing when tree API is unavailable.
          }

          const parsedDeadlines: Array<Omit<Deadline, "id">> = [];
          for (const path of deadlineSourcePaths) {
            try {
              const markdown =
                path.toLowerCase() === "readme.md"
                  ? readme
                  : await this.getRepoFileContent(repo, path);
              parsedDeadlines.push(...this.parseDeadlines(markdown, repo.courseCode));
            } catch {
              // Continue with remaining files when one file cannot be fetched.
            }
          }

          const dedupedDeadlines = this.dedupeParsedDeadlines(parsedDeadlines);
          deadlinesObserved += dedupedDeadlines.length;

          // Get existing deadlines from this source
          const existingDeadlines = this.store.getDeadlines();
          const existingMap = new Map<string, Deadline>();

          for (const deadline of existingDeadlines) {
            const key = this.generateDeadlineKey(deadline.course, deadline.task);
            existingMap.set(key, deadline);
          }

          // Create or update deadlines
          for (const newDeadline of dedupedDeadlines) {
            const key = this.generateDeadlineKey(newDeadline.course, newDeadline.task);
            const existing = existingMap.get(key);

            if (!existing) {
              // Create new deadline
              const created = this.store.createDeadline({
                ...newDeadline,
                sourceDueDate: newDeadline.dueDate
              });
              deadlinesCreated++;
              createdDeadlines.push(created);
            } else if (!existing.completed) {
              const existingSourceDueDate = existing.sourceDueDate ?? existing.dueDate;
              const sourceDueDateChanged = existingSourceDueDate !== newDeadline.dueDate;
              const missingSourceDueDate = !existing.sourceDueDate;
              const userOverrodeDueDate = existing.dueDate !== existingSourceDueDate;
              const shouldTrackSourceDueDate = sourceDueDateChanged || missingSourceDueDate;

              if (shouldTrackSourceDueDate) {
                const patch: Partial<Omit<Deadline, "id">> = {
                  sourceDueDate: newDeadline.dueDate
                };

                if (!userOverrodeDueDate) {
                  patch.dueDate = newDeadline.dueDate;
                }

                this.store.updateDeadline(existing.id, patch);
                deadlinesUpdated++;
              }
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
        publishNewDeadlineReleaseNotifications(this.store, "github", createdDeadlines);
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
