# Orchestrator Automatic Process Explanation

## Overview

The orchestrator operates in a **recursive loop** that continuously discovers and assigns work without manual intervention. This document explains how the automatic issue creation process works when orchestrator issue #22 is closed.

## The Recursive Loop

```
┌─────────────────────────────────────────────────────────────┐
│  Orchestrator Issue #22 (Current)                          │
│  Title: "Orchestrator: discover and assign new work"       │
│  Status: Being worked on by copilot-swe-agent[bot]        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Agent completes scan
                       │ Agent closes issue
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  GitHub Actions Workflow Trigger                            │
│  Event: issues.closed                                       │
│  Condition: Title contains "Orchestrator"                   │
│             AND has "agent-task" label                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Workflow runs
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Orchestrator Script Execution                              │
│  File: .github/scripts/orchestrator.js                      │
│  Runtime: Node.js 20                                        │
│  Tokens: GITHUB_TOKEN (basic) + AGENT_PAT (agent access)   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Script scans codebase
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Discovery Phase                                            │
│  • findTodos() - Search for TODO/FIXME/HACK/XXX           │
│  • findMissingTests() - Identify untested source files     │
│  • findDocGaps() - Check for missing documentation        │
│  • findCodeImprovements() - Find large files (>200 lines) │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Found 3 issues
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Issue Creation Phase                                       │
│                                                             │
│  Issue #1: "Add tests for config.ts, store.ts, utils.ts"  │
│  • Created via GitHub REST API                             │
│  • Label: agent-task                                       │
│  • Assigned to: copilot-swe-agent[bot]                    │
│  • Agent profile: test-engineer                           │
│                                                             │
│  Issue #2: "Document API endpoints and contracts"         │
│  • Created via GitHub REST API                             │
│  • Label: agent-task                                       │
│  • Assigned to: copilot-swe-agent[bot]                    │
│  • Agent profile: docs-writer                             │
│                                                             │
│  Issue #3: "Document system architecture and data flow"   │
│  • Created via GitHub REST API                             │
│  • Label: agent-task                                       │
│  • Assigned to: copilot-swe-agent[bot]                    │
│  • Agent profile: docs-writer                             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ All issues created
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Recursive Issue Creation                                   │
│                                                             │
│  Issue #23 (or next available): "Orchestrator: discover    │
│                                  and assign new work"       │
│  • Created via GitHub REST API                             │
│  • Label: agent-task                                       │
│  • Assigned to: copilot-swe-agent[bot]                    │
│  • Agent profile: (none - uses default instructions)      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Loop completes
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Next Cycle Begins                                          │
│  • Issue #23 is now open and assigned                      │
│  • copilot-swe-agent[bot] will work on it next            │
│  • When closed, the cycle repeats                          │
│  • System runs autonomously ♻️                             │
└─────────────────────────────────────────────────────────────┘
```

## Step-by-Step Breakdown

### Step 1: Issue Closure Triggers Workflow

**File:** `.github/workflows/orchestrator.yml`

```yaml
on:
  issues:
    types: [closed]

jobs:
  orchestrate:
    if: |
      github.event_name == 'issues' && 
      contains(github.event.issue.title, 'Orchestrator') &&
      contains(github.event.issue.labels.*.name, 'agent-task')
```

When issue #22 is closed, GitHub checks:
- ✅ Event type is `issues.closed`
- ✅ Title contains "Orchestrator"
- ✅ Has `agent-task` label

If all conditions are met, the workflow runs.

### Step 2: Environment Setup

The workflow:
1. Checks out the repository
2. Sets up Node.js 20
3. Provides environment variables:
   - `GITHUB_TOKEN` - Basic GitHub API access (read/write issues)
   - `AGENT_PAT` - User PAT required to assign copilot-swe-agent[bot]
   - `GITHUB_REPOSITORY` - "lucyscript/companion"
   - `DRY_RUN` - "false" (create real issues)
   - `RECURSIVE` - "true" (create next orchestrator issue)

### Step 3: Orchestrator Script Execution

**File:** `.github/scripts/orchestrator.js`

The script runs with real GitHub credentials and executes these functions:

#### 3.1 Discovery Functions

```javascript
// Scan for TODOs/FIXMEs
findTodos()
  → git grep -E "TODO|FIXME|HACK|XXX"
  → Found: 0 items

// Check test coverage
findMissingTests()
  → find apps -name "*.ts" → 20 source files
  → find . -name "*.test.*" → 0 test files
  → Found: 1 issue (top 3 untested files)

// Check documentation
findDocGaps()
  → Check: docs/api.md → ❌ missing
  → Check: docs/architecture.md → ❌ missing  
  → Check: docs/deployment.md → ✅ exists
  → Found: 2 issues

// Check code quality
findCodeImprovements()
  → find apps -name "*.ts" | xargs wc -l
  → Largest: 149 lines (under 200 threshold)
  → Found: 0 issues

Total: 3 issues discovered
```

#### 3.2 Agent Routing Logic

```javascript
function pickAgent(title, body, file) {
  // Title-based routing (highest priority)
  if (title.includes('test')) return 'test-engineer';
  if (title.includes('document')) return 'docs-writer';
  
  // File-based routing
  if (file.includes('apps/web/')) return 'frontend-engineer';
  if (file.includes('apps/server/')) return 'backend-engineer';
  
  // Default
  return 'backend-engineer';
}
```

For our issues:
- "Add tests for..." → test-engineer
- "Document API..." → docs-writer
- "Document system..." → docs-writer

#### 3.3 Issue Creation (Two-Step Process)

**Step A: Create the issue**

```javascript
POST /repos/lucyscript/companion/issues
{
  title: "Add tests for config.ts, store.ts, utils.ts",
  body: "## Scope\nAdd unit tests...",
  labels: ["agent-task"]
}
```

Returns issue number, e.g., #23

**Step B: Assign to Copilot with agent profile**

```javascript
POST /repos/lucyscript/companion/issues/23/assignees
{
  assignees: ["copilot-swe-agent[bot]"],
  agent_assignment: {
    target_repo: "lucyscript/companion",
    base_branch: "main",
    custom_instructions: "Use the test-engineer agent profile...",
    custom_agent: "test-engineer"
  }
}
```

This triggers the GitHub Copilot coding agent to:
1. Read the issue
2. Load the test-engineer agent profile (`.github/agents/test-engineer.agent.md`)
3. Create a new branch (`agent/23-...`)
4. Make changes
5. Push and create a PR
6. Auto-merge via `agent-pr-automation.yml`

#### 3.4 Recursive Issue Creation

```javascript
async function createRecursiveIssue() {
  const title = 'Orchestrator: discover and assign new work';
  const body = '## Scope\nRun the orchestrator...\n\n## Deliverable\n...';
  
  // Create issue #24 (or next available)
  await githubAPI(
    `/repos/${OWNER}/${REPO_NAME}/issues`,
    'POST',
    { title, body, labels: ['agent-task'] }
  );
  
  // Assign to copilot-swe-agent[bot]
  await githubAPI(
    `/repos/${OWNER}/${REPO_NAME}/issues/${created.number}/assignees`,
    'POST',
    { assignees: ['copilot-swe-agent[bot]'], ... }
  );
}
```

### Step 4: Workflow Completes

The orchestrator workflow finishes with:
- ✅ 3 new issues created and assigned
- ✅ 1 new orchestrator issue created
- ✅ All issues have `agent-task` label
- ✅ Agents will begin working on assigned issues

### Step 5: Loop Continues

Each agent works on their assigned issue:
- test-engineer creates test files
- docs-writer creates documentation

When they complete and close their issues, they don't trigger the orchestrator (no "Orchestrator" in title).

When orchestrator issue #23 (or next) is eventually assigned and closed, the whole process repeats.

## Key Features

### Automatic Deduplication

```javascript
const existing = await getExistingIssueTitles();
const newIssues = allIssues.filter(i => 
  !existing.has(i.title.toLowerCase())
);
```

The script won't create duplicate issues. If "Add tests for config.ts" already exists, it skips it.

### Rate Limiting

```javascript
const batch = newIssues.slice(0, 5);  // Max 5 issues per run

for (const issue of batch) {
  await createAndAssignIssue(issue, agent);
  await new Promise(r => setTimeout(r, 1000));  // 1s delay
}
```

- Max 5 new issues per run
- 1 second delay between API calls
- Prevents API abuse and spam

### Token Requirements

| Token | Purpose | Used For |
|-------|---------|----------|
| `GITHUB_TOKEN` | Basic GitHub API | Create issues, read labels |
| `AGENT_PAT` | User token with agent access | Assign copilot-swe-agent[bot], trigger agent sessions |

If `AGENT_PAT` is not configured:
- Issues will be created ✅
- Labels will be added ✅
- Agents will NOT be auto-assigned ❌
- Must assign manually from GitHub UI

## Verification

To verify the system is working:

1. **Check workflow runs**
   ```bash
   gh run list --workflow=orchestrator.yml --limit 10
   ```

2. **Check created issues**
   ```bash
   gh issue list --label agent-task
   ```

3. **Check agent assignments**
   ```bash
   gh issue view 23  # Shows assignee
   ```

4. **Check next orchestrator issue**
   ```bash
   gh issue list --search "Orchestrator in:title is:open"
   ```

## Manual Trigger (Testing)

You can trigger the orchestrator manually without closing an issue:

```bash
# Dry run (no issues created)
gh workflow run orchestrator.yml -f dry_run=true -f recursive=false

# Real run (creates issues)
gh workflow run orchestrator.yml -f dry_run=false -f recursive=true
```

## Troubleshooting

### Issues not created
- Check workflow run logs: `gh run view <run-id> --log`
- Verify `GITHUB_TOKEN` has `issues: write` permission
- Check if issues already exist (dedup logic)

### Agents not assigned
- Verify `AGENT_PAT` is configured as repository secret
- Check PAT has required permissions: actions, contents, issues, pull-requests (all read/write)
- Verify PAT hasn't expired

### Recursive issue not created
- Check if `RECURSIVE` env var is set to "false"
- Verify orchestrator script completed successfully
- Check API rate limits

## Conclusion

The orchestrator is fully automated and requires no manual intervention. When issue #22 is closed:

1. ✅ Workflow triggers automatically
2. ✅ Script scans codebase
3. ✅ 3 issues will be created
4. ✅ All issues assigned to appropriate agents
5. ✅ Next orchestrator issue created
6. ✅ Loop continues forever ♻️

The system is **self-sustaining** and **self-improving**.
