import { config } from "./config.js";
import { Deadline, Priority } from "./types.js";

export interface GitHubRepoConfig {
  owner: string;
  repo: string;
  path: string;
}

export interface GitHubSyncResult {
  deadlinesFound: number;
  deadlinesCreated: number;
  deadlinesUpdated: number;
  errors: string[];
}

export interface GitHubSyncMetadata {
  lastSyncAt: string | null;
  lastSyncStatus: "success" | "error" | "never";
  lastError?: string;
}

export class GitHubSyncError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "GitHubSyncError";
  }
}

/**
 * GitHub Course Sync Service
 * Fetches lab READMEs from course repos and extracts deadline information
 */
export class GitHubSyncService {
  private readonly token: string | undefined;
  private readonly repos: GitHubRepoConfig[] = [
    { owner: "dat520-2026", repo: "assignments", path: "" },
    { owner: "dat560-2026", repo: "info", path: "" }
  ];

  constructor(token?: string) {
    this.token = token ?? config.COURSE_GITHUB_PAT;
  }

  /**
   * Fetch file contents from GitHub API
   */
  private async fetchFile(owner: string, repo: string, path: string): Promise<string> {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    
    const headers: Record<string, string> = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "Companion-App"
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubSyncError(`File not found: ${owner}/${repo}/${path}`, 404);
      }
      if (response.status === 401 || response.status === 403) {
        throw new GitHubSyncError(
          "GitHub authentication failed. Check COURSE_GITHUB_PAT token.",
          response.status
        );
      }
      throw new GitHubSyncError(
        `GitHub API error: ${response.status} ${response.statusText}`,
        response.status
      );
    }

    const data = await response.json() as { content?: string; encoding?: string; type?: string };

    if (data.type !== "file" || !data.content || data.encoding !== "base64") {
      throw new GitHubSyncError(`Expected base64-encoded file content from GitHub API`);
    }

    return Buffer.from(data.content, "base64").toString("utf-8");
  }

  /**
   * List contents of a directory from GitHub API
   */
  private async listDirectory(owner: string, repo: string, path: string = ""): Promise<Array<{ name: string; path: string; type: string }>> {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    
    const headers: Record<string, string> = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "Companion-App"
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubSyncError(`Directory not found: ${owner}/${repo}/${path}`, 404);
      }
      if (response.status === 401 || response.status === 403) {
        throw new GitHubSyncError(
          "GitHub authentication failed. Check COURSE_GITHUB_PAT token.",
          response.status
        );
      }
      throw new GitHubSyncError(
        `GitHub API error: ${response.status} ${response.statusText}`,
        response.status
      );
    }

    const data = await response.json();
    
    if (!Array.isArray(data)) {
      throw new GitHubSyncError(`Expected array response from GitHub directory listing`);
    }

    return data.map((item: { name: string; path: string; type: string }) => ({
      name: item.name,
      path: item.path,
      type: item.type
    }));
  }

  /**
   * Parse deadline information from markdown content
   * Looks for patterns like:
   * - | Deadline: | **Jan 15, 2026 23:59** |
   * - Deadline: Jan 15, 2026 23:59
   * - Due: January 15, 2026
   */
  parseDeadlinesFromMarkdown(markdown: string, source: string): Array<Omit<Deadline, "id" | "completed">> {
    const deadlines: Array<Omit<Deadline, "id" | "completed">> = [];
    const lines = markdown.split("\n");

    // Extract course from source (e.g., "dat520-2026/assignments" -> "DAT520")
    const courseMatch = source.match(/^(dat\d+)/i);
    const courseCode = courseMatch ? courseMatch[1].toUpperCase() : "COURSE";

    // Determine source identifier
    const sourceId = `github-${courseCode.toLowerCase()}`;

    // Try to extract lab/assignment number from headings or filename
    let currentTask: string | null = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();

      // Look for headings that might indicate the lab/assignment
      if (line.startsWith("#")) {
        const headingMatch = line.match(/#+\s*(Lab\s*\d+|Assignment\s*\d+|Exercise\s*\d+)/i);
        if (headingMatch) {
          currentTask = headingMatch[1]!.trim();
        }
      }

      // Pattern 1: Table format | Deadline: | **date** | or | **Deadline** | **date** |
      const tableMatch = line.match(/\|\s*\*{0,2}\s*Deadline\s*\*{0,2}\s*:?\s*\|\s*\*{0,2}([^*|]+)\*{0,2}\s*\|/i);
      if (tableMatch && tableMatch[1]) {
        const dateStr = tableMatch[1].trim();
        const parsedDate = this.parseDate(dateStr);
        
        if (parsedDate && currentTask) {
          // Generate external ID for deduplication
          const externalId = `${sourceId}-${currentTask.toLowerCase().replace(/\s+/g, "-")}-${parsedDate.split("T")[0]}`;
          
          deadlines.push({
            course: courseCode,
            task: currentTask,
            dueDate: parsedDate,
            priority: this.inferPriority(dateStr, markdown),
            source: sourceId,
            externalId
          });
          continue;
        }
      }

      // Pattern 2: Plain text "Deadline: date" or "Due: date"
      const plainMatch = line.match(/(?:Deadline|Due)\s*:?\s*(.+?)(?:\||$)/i);
      if (plainMatch && plainMatch[1]) {
        const dateStr = plainMatch[1].replace(/\*\*/g, "").trim();
        const parsedDate = this.parseDate(dateStr);
        
        if (parsedDate && currentTask) {
          // Generate external ID for deduplication
          const externalId = `${sourceId}-${currentTask.toLowerCase().replace(/\s+/g, "-")}-${parsedDate.split("T")[0]}`;
          
          deadlines.push({
            course: courseCode,
            task: currentTask,
            dueDate: parsedDate,
            priority: this.inferPriority(dateStr, markdown),
            source: sourceId,
            externalId
          });
        }
      }
    }

    return deadlines;
  }

  /**
   * Parse various date formats into ISO 8601 string
   */
  private parseDate(dateStr: string): string | null {
    // Remove common markdown formatting
    const cleaned = dateStr.replace(/\*\*/g, "").replace(/\*/g, "").trim();

    // Try parsing as ISO date first
    const isoMatch = cleaned.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T23:59:00Z`).toISOString();
    }

    // Pattern: "Jan 15, 2026 23:59" or "January 15, 2026"
    const usDateMatch = cleaned.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (usDateMatch) {
      const [, month, day, year, hour, minute] = usDateMatch;
      const monthNum = this.parseMonth(month!);
      if (monthNum !== null) {
        const timeStr = hour && minute ? `T${hour.padStart(2, "0")}:${minute}:00Z` : "T23:59:00Z";
        return new Date(`${year}-${monthNum.toString().padStart(2, "0")}-${day!.padStart(2, "0")}${timeStr}`).toISOString();
      }
    }

    // Pattern: "15 Jan 2026" or "15 January 2026"
    const euDateMatch = cleaned.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (euDateMatch) {
      const [, day, month, year, hour, minute] = euDateMatch;
      const monthNum = this.parseMonth(month!);
      if (monthNum !== null) {
        const timeStr = hour && minute ? `T${hour.padStart(2, "0")}:${minute}:00Z` : "T23:59:00Z";
        return new Date(`${year}-${monthNum.toString().padStart(2, "0")}-${day!.padStart(2, "0")}${timeStr}`).toISOString();
      }
    }

    return null;
  }

  /**
   * Parse month name to number (1-12)
   */
  private parseMonth(monthStr: string): number | null {
    const months: Record<string, number> = {
      jan: 1, january: 1,
      feb: 2, february: 2,
      mar: 3, march: 3,
      apr: 4, april: 4,
      may: 5,
      jun: 6, june: 6,
      jul: 7, july: 7,
      aug: 8, august: 8,
      sep: 9, sept: 9, september: 9,
      oct: 10, october: 10,
      nov: 11, november: 11,
      dec: 12, december: 12
    };

    return months[monthStr.toLowerCase()] ?? null;
  }

  /**
   * Infer priority from deadline context
   */
  private inferPriority(dateStr: string, context: string): Priority {
    const text = `${dateStr} ${context}`.toLowerCase();

    if (text.includes("final") || text.includes("exam") || text.includes("critical")) {
      return "critical";
    }

    if (text.includes("important") || text.includes("project")) {
      return "high";
    }

    // Check time until deadline
    const parsedDate = this.parseDate(dateStr);
    if (parsedDate) {
      const daysUntil = (new Date(parsedDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      
      if (daysUntil <= 7) {
        return "high";
      }
      
      if (daysUntil <= 14) {
        return "medium";
      }
    }

    return "medium";
  }

  /**
   * Find all README files in a repo
   */
  private async findReadmeFiles(owner: string, repo: string, basePath: string = ""): Promise<string[]> {
    const readmes: string[] = [];
    
    try {
      const items = await this.listDirectory(owner, repo, basePath);
      
      for (const item of items) {
        if (item.type === "file" && /^readme\.md$/i.test(item.name)) {
          readmes.push(item.path);
        } else if (item.type === "dir") {
          // Recursively search subdirectories (limit depth to avoid excessive API calls)
          const depth = item.path.split("/").length;
          if (depth <= 3) {
            const subReadmes = await this.findReadmeFiles(owner, repo, item.path);
            readmes.push(...subReadmes);
          }
        }
      }
    } catch (error) {
      // Ignore errors from subdirectories
      if (error instanceof GitHubSyncError && error.statusCode === 404) {
        // Directory doesn't exist, that's okay
      } else {
        throw error;
      }
    }

    return readmes;
  }

  /**
   * Sync deadlines from GitHub course repos
   */
  async syncDeadlines(): Promise<Array<Omit<Deadline, "id" | "completed">>> {
    if (!this.token) {
      throw new GitHubSyncError(
        "GitHub token not configured. Set COURSE_GITHUB_PAT environment variable."
      );
    }

    const allDeadlines: Array<Omit<Deadline, "id" | "completed">> = [];

    for (const repoConfig of this.repos) {
      try {
        // Find all README files in the repo
        const readmeFiles = await this.findReadmeFiles(repoConfig.owner, repoConfig.repo, repoConfig.path);

        // If no READMEs found, try the root README
        if (readmeFiles.length === 0) {
          readmeFiles.push("README.md");
        }

        for (const readmePath of readmeFiles) {
          try {
            const content = await this.fetchFile(repoConfig.owner, repoConfig.repo, readmePath);
            const source = `${repoConfig.owner}/${repoConfig.repo}/${readmePath}`;
            const deadlines = this.parseDeadlinesFromMarkdown(content, source);
            allDeadlines.push(...deadlines);
          } catch (error) {
            // Log error but continue with other files
            console.error(`Error fetching ${repoConfig.owner}/${repoConfig.repo}/${readmePath}:`, error);
          }
        }
      } catch (error) {
        console.error(`Error syncing ${repoConfig.owner}/${repoConfig.repo}:`, error);
      }
    }

    return allDeadlines;
  }

  /**
   * Get sync metadata (status, last sync time)
   */
  getSyncMetadata(): GitHubSyncMetadata {
    // This will be implemented by the store
    return {
      lastSyncAt: null,
      lastSyncStatus: "never"
    };
  }
}
