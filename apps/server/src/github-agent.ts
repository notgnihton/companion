/**
 * GitHub Agent — Gemini-powered repo scanner that discovers deadlines/assignments.
 *
 * Instead of hundreds of lines of regex parsing, this agent gives Gemini
 * read-only access to course repos via tools and asks it to find deadlines.
 * The PAT is never exposed to Gemini — tool handlers use it server-side.
 *
 * Triggered by SHA changes (via GitHubWatcher), not cron.
 */

import { FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { GitHubCourseClient } from "./github-course-client.js";
import { GeminiClient } from "./gemini.js";
import type { GeminiMessage } from "./gemini.js";
import { RuntimeStore } from "./store.js";
import type { Deadline, GitHubCourseData, GitHubCourseDocument, GitHubTrackedRepo } from "./types.js";
import { publishNewDeadlineReleaseNotifications } from "./deadline-release-notifications.js";

// ── Tracked repos come from the store (user-configured) ──────────

export type { GitHubTrackedRepo as TrackedRepo };

/**
 * Read user-configured tracked repos from the store.
 * Returns empty array if none configured yet.
 */
export function getTrackedRepos(store: RuntimeStore, userId: string): GitHubTrackedRepo[] {
  return store.getGitHubTrackedRepos(userId);
}

// ── Tool declarations for the agent ───────────────────────────────

const agentTools: FunctionDeclaration[] = [
  {
    name: "github_get_changed_files",
    description:
      "Get the list of files changed between two commits. Use this FIRST when a previous SHA is available to see what changed, so you only need to read the changed files instead of everything.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        owner: { type: SchemaType.STRING, description: "Repository owner (org name)" },
        repo: { type: SchemaType.STRING, description: "Repository name" },
        baseSha: { type: SchemaType.STRING, description: "Previous commit SHA (base)" },
        headSha: { type: SchemaType.STRING, description: "Current commit SHA (head)" },
      },
      required: ["owner", "repo", "baseSha", "headSha"],
    },
  },
  {
    name: "github_list_files",
    description:
      "List all files in a course repository. Returns file paths and sizes. Use this for initial scans when no previous SHA is available, or when you need to discover the full repo structure.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        owner: { type: SchemaType.STRING, description: "Repository owner (org name)" },
        repo: { type: SchemaType.STRING, description: "Repository name" },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github_read_file",
    description:
      "Read the content of a specific file from a course repository. Use this to read README.md, assignment descriptions, lab plans, and any markdown files that might contain deadlines or assignment info.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        owner: { type: SchemaType.STRING, description: "Repository owner" },
        repo: { type: SchemaType.STRING, description: "Repository name" },
        path: { type: SchemaType.STRING, description: "File path within the repository" },
      },
      required: ["owner", "repo", "path"],
    },
  },
  {
    name: "report_deadlines",
    description:
      "Report discovered deadlines/assignments. Call this once you've found all deadlines in a repository. Each deadline needs a course code, task name, and due date.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        deadlines: {
          type: SchemaType.ARRAY,
          description: "Array of discovered deadlines",
          items: {
            type: SchemaType.OBJECT,
            properties: {
              course: { type: SchemaType.STRING, description: "Course code, e.g. DAT520" },
              task: { type: SchemaType.STRING, description: "Descriptive task name, e.g. 'Lab 3: Goroutines'" },
              dueDate: { type: SchemaType.STRING, description: "Due date in YYYY-MM-DD format" },
              priority: { type: SchemaType.STRING, description: "low, medium, or high" },
            },
            required: ["course", "task", "dueDate"],
          },
        },
      },
      required: ["deadlines"],
    },
  },
  {
    name: "report_course_documents",
    description:
      "Report important course documents found (syllabus, course info, grading policies, etc.). These get stored for the chat AI to reference later.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        documents: {
          type: SchemaType.ARRAY,
          description: "Array of course documents",
          items: {
            type: SchemaType.OBJECT,
            properties: {
              owner: { type: SchemaType.STRING },
              repo: { type: SchemaType.STRING },
              courseCode: { type: SchemaType.STRING },
              path: { type: SchemaType.STRING, description: "File path in the repo" },
              title: { type: SchemaType.STRING, description: "Document title" },
              summary: { type: SchemaType.STRING, description: "2-3 sentence summary of the document" },
              highlights: {
                type: SchemaType.ARRAY,
                description: "Key facts from the document (max 5)",
                items: { type: SchemaType.STRING },
              },
            },
            required: ["owner", "repo", "courseCode", "path", "title", "summary"],
          },
        },
      },
      required: ["documents"],
    },
  },
];

// ── Agent system prompt ───────────────────────────────────────────

const SYSTEM_PROMPT = `You are a university course repository scanner. Your job is to find deadlines, assignments, and important course documents in GitHub repositories.

Strategy:
- If a repo has a PREVIOUS SHA (incremental update): use github_get_changed_files first to see what changed, then only read the changed files that look relevant (markdown, text, assignment files). This is much more efficient.
- If a repo has NO previous SHA (first scan): use github_list_files to see the full repo, then read the relevant files.

For each repository:
1. Check if previous SHA info is provided in the scan request
2. If yes → call github_get_changed_files, then read only the changed .md/.txt files
3. If no → call github_list_files, then read files that look like they contain deadlines/assignments/course info
4. Report findings via report_deadlines and report_course_documents

Rules:
- Only report deadlines that have a clear due date (skip "TBA" or "TBD")
- Use YYYY-MM-DD format for dates. If only day.month.year format is given (e.g. "28.01.2026"), convert it.
- If a date says "January 15" without a year, assume the current academic year (2026)
- Set priority to "high" for exams, "medium" for assignments/labs, "low" for optional tasks
- For documents, write a concise summary capturing the key info
- Don't read binary files, images, or very large code files — focus on .md and text files
- Be efficient: only read files likely to have deadline/course info
- On incremental updates, if no changed files are relevant (e.g. only code changes), you can skip reading and just report no new deadlines`;

// ── Tool handler ──────────────────────────────────────────────────

interface AgentToolResult {
  deadlines: Array<Omit<Deadline, "id">>;
  documents: GitHubCourseDocument[];
}

function handleToolCall(
  client: GitHubCourseClient,
  name: string,
  args: Record<string, unknown>,
  results: AgentToolResult,
  syncedAt: string,
): unknown {
  switch (name) {
    case "github_get_changed_files": {
      return { _async: true, name, args };
    }
    case "github_list_files": {
      // Handled async — returns a promise marker
      return { _async: true, name, args };
    }
    case "github_read_file": {
      return { _async: true, name, args };
    }
    case "report_deadlines": {
      const deadlines = args.deadlines as Array<{
        course: string;
        task: string;
        dueDate: string;
        priority?: string;
      }>;
      for (const d of deadlines ?? []) {
        results.deadlines.push({
          course: d.course,
          task: d.task,
          dueDate: d.dueDate,
          sourceDueDate: d.dueDate,
          priority: (d.priority as "low" | "medium" | "high") ?? "medium",
          completed: false,
        });
      }
      return { success: true, count: deadlines?.length ?? 0 };
    }
    case "report_course_documents": {
      const docs = args.documents as Array<{
        owner: string;
        repo: string;
        courseCode: string;
        path: string;
        title: string;
        summary: string;
        highlights?: string[];
      }>;
      for (const d of docs ?? []) {
        const sourceKey = `${d.owner}/${d.repo}/${d.path}`;
        const encodedKey = Buffer.from(sourceKey).toString("base64url").slice(0, 32);
        results.documents.push({
          id: `github-doc-${d.courseCode.toLowerCase()}-${encodedKey}`,
          courseCode: d.courseCode,
          owner: d.owner,
          repo: d.repo,
          path: d.path,
          url: `https://github.com/${d.owner}/${d.repo}/blob/HEAD/${d.path}`,
          title: d.title,
          summary: d.summary,
          highlights: d.highlights ?? [],
          snippet: d.summary,
          syncedAt,
        });
      }
      return { success: true, count: docs?.length ?? 0 };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function handleAsyncToolCall(
  client: GitHubCourseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const owner = args.owner as string;
  const repo = args.repo as string;

  switch (name) {
    case "github_get_changed_files": {
      const baseSha = args.baseSha as string;
      const headSha = args.headSha as string;
      try {
        const changedFiles = await client.getChangedFiles(owner, repo, baseSha, headSha);
        return {
          totalChanged: changedFiles.length,
          files: changedFiles.map((f) => ({
            path: f.path,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
          })),
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Failed to get diff" };
      }
    }
    case "github_list_files": {
      try {
        const { entries } = await client.listRepositoryTree(owner, repo);
        const fileList = entries
          .filter((e) => e.size < 500_000) // skip huge files
          .map((e) => ({ path: e.path, size: e.size }));
        return { files: fileList };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Failed to list files" };
      }
    }
    case "github_read_file": {
      const path = args.path as string;
      try {
        const content = await client.getFileContent(owner, repo, path);
        // Truncate very long files to save tokens
        const maxLen = 12_000;
        return {
          path,
          content: content.length > maxLen ? content.slice(0, maxLen) + "\n\n[truncated]" : content,
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Failed to read file" };
      }
    }
    default:
      return { error: `Unknown async tool: ${name}` };
  }
}

// ── Main agent runner ─────────────────────────────────────────────

export interface GitHubAgentResult {
  success: boolean;
  deadlinesCreated: number;
  deadlinesUpdated: number;
  documentsStored: number;
  reposScanned: number;
  error?: string;
}

/**
 * Run the GitHub agent for a set of repos that have changed.
 * Gemini reads the repos via tools, finds deadlines, and we persist them.
 */
export async function runGitHubAgent(
  store: RuntimeStore,
  gemini: GeminiClient,
  userId: string,
  changedRepos?: GitHubTrackedRepo[],
  /** Previous HEAD SHAs for diff-based scanning. Key: "owner/repo", value: previous SHA */
  previousShas?: Record<string, string>,
  /** Current HEAD SHAs (after detecting changes). Key: "owner/repo", value: current SHA */
  headShas?: Record<string, string>,
): Promise<GitHubAgentResult> {
  const client = new GitHubCourseClient();
  if (!client.isConfigured()) {
    return { success: false, deadlinesCreated: 0, deadlinesUpdated: 0, documentsStored: 0, reposScanned: 0, error: "GitHub PAT not configured" };
  }
  if (!gemini.isConfigured()) {
    return { success: false, deadlinesCreated: 0, deadlinesUpdated: 0, documentsStored: 0, reposScanned: 0, error: "Gemini not configured" };
  }

  const repos = changedRepos ?? getTrackedRepos(store, userId);
  if (repos.length === 0) {
    return { success: true, deadlinesCreated: 0, deadlinesUpdated: 0, documentsStored: 0, reposScanned: 0, error: "No tracked repos configured" };
  }

  const syncedAt = new Date().toISOString();
  const results: AgentToolResult = { deadlines: [], documents: [] };

  // Build the user message telling the agent which repos to scan
  const repoList = repos.map((r) => {
    const key = `${r.owner}/${r.repo}`;
    const parts = [`- ${key}`];
    if (r.courseCode) parts.push(`(course: ${r.courseCode})`);
    if (r.label) parts.push(`— ${r.label}`);
    const prevSha = previousShas?.[key];
    const curSha = headShas?.[key];
    if (prevSha && curSha) {
      parts.push(`[previousSha: ${prevSha}, headSha: ${curSha}]`);
    }
    return parts.join(" ");
  }).join("\n");

  const hasDiffInfo = previousShas && headShas && Object.keys(previousShas).length > 0;
  const scanInstruction = hasDiffInfo
    ? "For repos with SHA info, use github_get_changed_files first to see what changed, then only read the changed files. For repos without SHA info, list files first, then read the relevant ones."
    : "List files first, then read the relevant ones, and report what you find.";
  const userMessage = `Scan these course repositories for deadlines, assignments, and important course documents:\n\n${repoList}\n\n${scanInstruction}`;

  const messages: GeminiMessage[] = [
    { role: "user", parts: [{ text: userMessage }] },
  ];

  try {
    // Agentic loop — let Gemini call tools until it's done
    const maxTurns = 15;
    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await gemini.generateChatResponse({
        messages,
        systemInstruction: SYSTEM_PROMPT,
        tools: agentTools,
      });

      // If no function calls, Gemini is done
      if (!response.functionCalls || response.functionCalls.length === 0) {
        break;
      }

      // Process each function call
      const functionResponses: GeminiMessage[] = [];
      for (const call of response.functionCalls) {
        const callArgs = (call.args ?? {}) as Record<string, unknown>;
        const syncResult = handleToolCall(client, call.name, callArgs, results, syncedAt);

        let toolResponse: unknown;
        if (syncResult && typeof syncResult === "object" && "_async" in (syncResult as Record<string, unknown>)) {
          toolResponse = await handleAsyncToolCall(client, call.name, callArgs);
        } else {
          toolResponse = syncResult;
        }

        functionResponses.push({
          role: "function",
          parts: [{
            functionResponse: {
              name: call.name,
              response: toolResponse as Record<string, unknown>,
            },
          }],
        });
      }

      // Add function call from model + function responses to conversation
      messages.push({
        role: "model",
        parts: response.functionCalls.map((call) => ({
          functionCall: { name: call.name, args: call.args },
        })),
      });
      messages.push(...functionResponses);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Agent error";
    return { success: false, deadlinesCreated: 0, deadlinesUpdated: 0, documentsStored: 0, reposScanned: repos.length, error: msg };
  }

  // Persist results
  let deadlinesCreated = 0;
  let deadlinesUpdated = 0;
  const existingDeadlines = store.getDeadlines(userId);
  const existingMap = new Map<string, Deadline>();
  for (const d of existingDeadlines) {
    existingMap.set(generateDeadlineKey(d.course, d.task), d);
  }

  const createdDeadlines: Deadline[] = [];
  for (const newDeadline of results.deadlines) {
    const key = generateDeadlineKey(newDeadline.course, newDeadline.task);
    const existing = existingMap.get(key);

    if (!existing) {
      const created = store.createDeadline(userId, newDeadline);
      deadlinesCreated++;
      createdDeadlines.push(created);
    } else if (!existing.completed) {
      const existingSourceDueDate = existing.sourceDueDate ?? existing.dueDate;
      const sourceDueDateChanged = existingSourceDueDate !== newDeadline.dueDate;
      const userOverrodeDueDate = existing.dueDate !== existingSourceDueDate;

      if (sourceDueDateChanged) {
        const patch: Partial<Omit<Deadline, "id">> = { sourceDueDate: newDeadline.dueDate };
        if (!userOverrodeDueDate) {
          patch.dueDate = newDeadline.dueDate;
        }
        store.updateDeadline(userId, existing.id, patch);
        deadlinesUpdated++;
      }
    }
  }

  if (createdDeadlines.length > 0) {
    publishNewDeadlineReleaseNotifications(store, userId, "github", createdDeadlines);
  }

  // Store course documents and sync state
  const previousData = store.getGitHubCourseData(userId);
  const mergedDocuments = mergeDocuments(previousData?.documents ?? [], results.documents);

  store.setGitHubCourseData(userId, {
    repositories: repos.map((r) => ({ owner: r.owner, repo: r.repo, courseCode: r.courseCode ?? "" })),
    documents: mergedDocuments,
    deadlinesSynced: results.deadlines.length,
    lastSyncedAt: syncedAt,
  });

  return {
    success: true,
    deadlinesCreated,
    deadlinesUpdated,
    documentsStored: mergedDocuments.length,
    reposScanned: repos.length,
  };
}

function generateDeadlineKey(course: string, task: string): string {
  const slug = task
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `github-${course.toLowerCase()}-${slug}`;
}

/** Merge new documents with existing ones, replacing by id. */
function mergeDocuments(existing: GitHubCourseDocument[], incoming: GitHubCourseDocument[]): GitHubCourseDocument[] {
  const map = new Map<string, GitHubCourseDocument>();
  for (const doc of existing) map.set(doc.id, doc);
  for (const doc of incoming) map.set(doc.id, doc);
  return Array.from(map.values());
}
