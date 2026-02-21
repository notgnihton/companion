# GitHub Content Agent — Design Document

## Status: Proposal (Phase 3)

## Problem

The current `GitHubCourseSyncService` works but has limitations:

1. **Blind file discovery** — keyword regex (`/readme|syllabus|schedule|exam/i`) catches irrelevant files and misses unconventional ones (e.g., `oblig2-spec.md`, `prosjekt-beskrivelse.md`)
2. **Static summaries** — first-3-sentences extraction misses the actual important content (grading weight, submission format, prerequisites)
3. **No change awareness** — re-fetches all files every sync even if nothing changed; misses important updates (deadline moved, new lab released)
4. **No student work tracking** — cannot tell Gemini "you've completed 4/8 labs" or "your last push to lab5 was 3 days ago"
5. **Flat context window** — all 4 course docs get crammed into the system prompt. Gemini can't drill into a specific doc when the user asks "what does lab 6 require?"

## Proposed Architecture

### Overview

Replace the monolithic sync with a **two-layer agent**:

```
┌─────────────────────────────────────────────┐
│  Layer 1: Crawler (runs on cron, daily)     │
│  - Discovers files via tree API             │
│  - Tracks commit SHAs for change detection  │
│  - Fetches only changed/new files           │
│  - Stores raw markdown in document store    │
└─────────────────────┬───────────────────────┘
                      │
┌─────────────────────▼───────────────────────┐
│  Layer 2: Indexer (runs after crawl)        │
│  - Classifies docs (assignment, syllabus,   │
│    lecture notes, project spec, etc.)        │
│  - Extracts structured metadata per type    │
│  - Generates concise summaries              │
│  - Builds searchable index for Gemini tools │
└─────────────────────────────────────────────┘
```

### Layer 1: Crawler

**Goal**: Efficiently discover and fetch course content from GitHub repos.

**Change detection** via commit SHA:
```typescript
interface RepoCrawlState {
  owner: string;
  repo: string;
  lastCommitSha: string | null;  // HEAD SHA from last successful crawl
  lastCrawledAt: string;
  fileIndex: CrawledFile[];      // all known files + their blob SHAs
}

interface CrawledFile {
  path: string;
  blobSha: string;    // content hash — skip fetch if unchanged
  sizeBytes: number;
  lastFetched: string;
}
```

**Algorithm**:
1. `GET /repos/:owner/:repo/git/trees/HEAD?recursive=1` → get current tree
2. Compare each file's `sha` against stored `blobSha`
3. Only fetch files where SHA differs or file is new
4. Store new content, update `blobSha` and `lastCommitSha`
5. Delete entries for files that no longer exist in tree

**Scope control** — only crawl `.md` files under 100KB, skip `node_modules/`, `.github/`, `vendor/`, build output directories.

### Layer 2: Indexer

**Goal**: Turn raw markdown into structured, queryable knowledge.

**Document classification** — assign each file a `docType`:
```typescript
type DocType =
  | "assignment"     // lab/assignment specs with requirements + deadlines
  | "syllabus"       // course overview, grading policy, schedule
  | "lecture-notes"  // slides summary, reading material
  | "project-spec"   // semester project description
  | "exam-info"      // exam format, allowed aids, past exams
  | "general-info"   // README, getting started, tooling setup
  | "other";
```

Classification uses a **rule cascade** (fast, no LLM needed):
1. Path-based: `assignments/lab3/README.md` → `assignment`
2. Heading-based: first H1/H2 contains "exam" → `exam-info`
3. Content-based: contains a deadline table → `assignment`
4. Fallback: `other`

**Structured extraction per docType**:

| DocType | Extracted Fields |
|---------|-----------------|
| `assignment` | title, deadline, submission format, requirements list, grading weight, group/individual |
| `syllabus` | course name, credits, lecturer, grading breakdown, reading list |
| `exam-info` | date, duration, format (written/oral/digital), allowed aids |
| `lecture-notes` | topic, week number, key concepts, reading references |
| `project-spec` | milestones, team size, deliverables, technologies |

**Summary generation** — use Gemini (if configured) to produce 2-3 sentence summaries of important docs. Fall back to extractive summary (current approach) if Gemini is unavailable. Mark LLM-generated summaries as such.

### Student Work Tracking

Monitor the user's lab/assignment repos to track progress:

```typescript
interface StudentRepoProgress {
  courseCode: string;
  repoFullName: string;           // e.g., "dat520-2026/lucyscript-labs"
  totalAssignments: number;        // from assignment repo parsing
  lastPushAt: string | null;       // latest commit date
  recentFiles: string[];           // files changed in last 2 commits
  estimatedProgress: string;       // e.g., "lab5 in progress (last push 2d ago)"
}
```

**How it works**:
1. Daily: fetch commit list from student work repos (`GET /repos/:owner/:repo/commits?per_page=5`)
2. Parse directory structure to see which labs have content
3. Cross-reference with assignment specs to estimate completion
4. Feed this into Gemini context: "Student has completed labs 1-4, currently working on lab 5 (last commit 2 days ago)"

### Gemini Integration

**Replace flat context with tool-based access**:

Instead of dumping all doc summaries into the system prompt, register a Gemini function tool:

```typescript
// Tool definition for Gemini
{
  name: "lookup_course_document",
  description: "Look up a specific course document by course code and topic. Use when the user asks about a specific assignment, exam, or course policy.",
  parameters: {
    courseCode: { type: "string", description: "e.g., DAT520, DAT560" },
    query: { type: "string", description: "What to look up, e.g., 'lab 6 requirements', 'exam format', 'grading policy'" }
  }
}
```

**System prompt** gets a lightweight overview instead of full summaries:
```
GitHub Course Materials Available:
- DAT520: 3 assignments synced (labs 1-8), syllabus, exam info
- DAT560: 2 assignments, project spec, syllabus
- DAT600: syllabus only
Student progress: DAT520 labs 1-4 completed, lab 5 in progress
Use the lookup_course_document tool when the user asks about specific course content.
```

When Gemini calls the tool, the server returns the full doc content (up to ~4000 chars), letting Gemini give precise answers.

### Proactive Notifications

The agent should emit events when:
1. **New assignment released** — a new file matching `assignment` docType appears
2. **Deadline changed** — a previously parsed deadline date differs from stored value
3. **Upcoming deadline + no recent push** — deadline in 3 days but no commit to student repo in 5+ days
4. **New course content** — significant files added (syllabus updated, exam info posted)

These events flow through the existing `orchestrator.ts` → `nudge-engine.ts` pipeline.

### Configuration

Extend `COURSE_REPOS` with student work repos:

```typescript
interface CourseRepoConfig {
  // Existing
  owner: string;
  repo: string;
  courseCode: string;
  deadlinePathHints?: string[];
  publicPagesBaseUrl?: string;
  
  // New
  repoType: "course-info" | "assignments" | "student-work" | "group-work";
  studentWorkRepos?: Array<{
    owner: string;
    repo: string;
    label: string;  // e.g., "individual labs", "group project"
  }>;
}
```

### API Rate Limiting

GitHub API: 5000 requests/hour with PAT.

**Estimated usage per sync cycle**:
- 3 course repos × 1 tree request = 3
- ~15 changed files × 1 content request = 15
- 3 student repos × 1 commits request = 3
- Total: ~21 requests per daily sync (well within limits)

### Migration Path

1. **Phase 1** (non-breaking): Add `blobSha` tracking to existing crawler, skip unchanged files → reduces API calls by ~80%
2. **Phase 2**: Add document classification and structured extraction → richer context
3. **Phase 3**: Add student work tracking → progress awareness
4. **Phase 4**: Add Gemini tool-based lookup → on-demand deep access
5. **Phase 5**: Proactive notifications for new assignments and deadline changes

Each phase is a separate PR, ~200 lines each.

### File Structure

```
apps/server/src/
├── github-course-client.ts      # (existing) REST client — add commits endpoint
├── github-course-sync.ts        # (existing) refactor into crawler layer
├── github-content-indexer.ts     # NEW — document classification + extraction
├── github-student-tracker.ts    # NEW — student work repo monitoring
├── github-lookup-tool.ts        # NEW — Gemini tool handler for doc lookup
```

### Success Metrics

- **Fewer API calls**: Should drop from ~50/sync to ~20/sync with SHA tracking
- **Richer Gemini answers**: User asks "what does lab 6 need?" → Gemini uses tool to fetch full spec, not a truncated summary
- **Progress awareness**: "You've done 4/8 labs, lab 5 was last worked on Tuesday"
- **Proactive nudges**: "DAT520 just released lab 7 — deadline is March 15"
