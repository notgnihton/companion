import { RuntimeStore } from "./store.js";
import { GitHubCourseClient } from "./github-course-client.js";
import { Deadline } from "./types.js";

export interface CourseRepo {
  owner: string;
  repo: string;
  courseCode: string;
}

export interface GitHubCourseSyncResult {
  success: boolean;
  deadlinesCreated: number;
  deadlinesUpdated: number;
  error?: string;
}

// Define the course repositories to sync
const COURSE_REPOS: CourseRepo[] = [
  { owner: "dat520-2026", repo: "assignments", courseCode: "DAT520" },
  { owner: "dat560-2026", repo: "info", courseCode: "DAT560" }
];

export class GitHubCourseSyncService {
  private readonly store: RuntimeStore;
  private readonly client: GitHubCourseClient;
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  constructor(store: RuntimeStore, client?: GitHubCourseClient) {
    this.store = store;
    this.client = client ?? new GitHubCourseClient();
  }

  /**
   * Start the GitHub course sync service with daily syncing
   */
  start(intervalMs: number = 24 * 60 * 60 * 1000): void {
    if (this.syncInterval) {
      return;
    }

    // Sync immediately on start
    void this.sync();

    // Then sync daily
    this.syncInterval = setInterval(() => {
      void this.sync();
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
      return date.toISOString().split("T")[0];
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

  /**
   * Perform a GitHub course sync
   */
  async sync(): Promise<GitHubCourseSyncResult> {
    let deadlinesCreated = 0;
    let deadlinesUpdated = 0;

    try {
      for (const repo of COURSE_REPOS) {
        const readme = await this.client.getReadme(repo.owner, repo.repo);
        const parsedDeadlines = this.parseDeadlines(readme, repo.courseCode);

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
      }

      return {
        success: true,
        deadlinesCreated,
        deadlinesUpdated
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      return {
        success: false,
        deadlinesCreated,
        deadlinesUpdated,
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
}
