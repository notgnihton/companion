#!/usr/bin/env node

/**
 * Feature-Driven Agent Orchestrator
 *
 * Reads the Roadmap table from docs/project-brief.md dynamically:
 *   | ⬜ todo | `feature-id` | agent-name | Description |
 *
 * For each "⬜ todo" row without a matching open issue, creates a GitHub issue
 * and assigns it to Copilot coding agent via the REST API.
 *
 * All tasks use the Copilot coding agent with model selection:
 *   - Model: claude-sonnet-4.5 (1x premium requests on Pro plan)
 *   - Assignment: REST API POST /repos/:owner/:repo/issues/:number/assignees
 *   - No session cookies or internal GraphQL needed
 *
 * When there are few todo items remaining, creates an "idea generation" issue
 * asking the agent to propose new roadmap items — so work never runs out.
 */

const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────

const AGENT_PAT = process.env.AGENT_PAT || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || AGENT_PAT;
const REPO = process.env.GITHUB_REPOSITORY || 'notgnihton/companion';
const [OWNER, REPO_NAME] = REPO.split('/');
const DRY_RUN = process.env.DRY_RUN === 'true';
const API = 'https://api.github.com';
const CAN_ASSIGN_AGENTS = Boolean(AGENT_PAT);
const MAX_ISSUES_PER_RUN = 2;
const MAX_CONCURRENT_AGENTS = 1; // Keep at 1 to avoid Copilot rate limits
const LOW_TODO_THRESHOLD = 2; // When <= this many todos remain, generate ideas

// ── Copilot coding agent config ─────────────────────────────────────
// All tasks go through GitHub Copilot coding agent with model selection.
// Uses the REST API directly — no session cookies or internal GraphQL needed.
// Model: claude-sonnet-4.5 (1x premium requests on Pro plan)
const COPILOT_MODEL = process.env.COPILOT_MODEL || 'claude-sonnet-4.5';
const COPILOT_BOT_LOGIN = 'copilot-swe-agent[bot]';

// ── GitHub REST API helper ──────────────────────────────────────────

async function githubAPI(endpoint, method = 'GET', body = null, token = GITHUB_TOKEN) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${method} ${endpoint}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ── Parse roadmap from project brief ────────────────────────────────

function parseRoadmap() {
  const briefPath = path.resolve('docs/project-brief.md');
  if (!fs.existsSync(briefPath)) {
    console.error('docs/project-brief.md not found!');
    return [];
  }

  const content = fs.readFileSync(briefPath, 'utf-8');
  const lines = content.split('\n');
  const features = [];

  // Find roadmap table rows: | status | `id` | agent | description |
  // Match: | ⬜ todo | `some-id` | some-agent | Some description |
  // Also:  | ✅ done | `some-id` | some-agent | Some description |
  // Also:  | 🔄 in-progress | `some-id` | some-agent | Some description |
  const rowPattern = /^\|\s*(⬜\s*todo|✅\s*done|🔄\s*(?:in-progress|open\s*issue))\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|$/;

  for (const line of lines) {
    const match = line.match(rowPattern);
    if (match) {
      const [, statusRaw, id, agent, description] = match;
      const status = statusRaw.includes('todo') ? 'todo'
        : statusRaw.includes('done') ? 'done'
        : 'in-progress';

      features.push({
        id: id.trim(),
        agent: agent.trim(),
        description: description.trim(),
        status,
      });
    }
  }

  return features;
}

// ── Build issue body from feature ───────────────────────────────────

function buildIssueBody(feature) {
  return `## Context
Read \`docs/project-brief.md\` first — this is the Companion app.
Read \`.github/copilot-instructions.md\` for collaboration rules.

## Scope
**${feature.description}**

Feature ID: \`${feature.id}\`

Implement this feature following the project brief. Use existing patterns in the codebase.

## ⛔ CRITICAL: Do NOT start MCP servers
**NEVER start Playwright or GitHub MCP servers.** Zero exceptions. Every task in this repo is a pure coding task — read files, write code, run tests. Starting MCP servers wastes your entire token budget on initialization and you will crash before finishing any real work. Agents that start MCP servers have a 100% failure rate on this repo.

## Token budget — IMPORTANT
Your session has a hard per-task token limit. To avoid crashing mid-task:
- **Keep changes focused**: 1-3 files changed, < 200 lines of new code.
- **Prefer creating new files** over heavily modifying \`store.ts\`, \`index.ts\`, or \`App.tsx\`.
- **If the task feels too large**: implement the core piece, commit, and note remaining work in the PR description.
- **Commit early** if you've made good progress — a partial PR is better than a crashed session.

## Deliverable
- Working implementation of the feature described above
- Types updated if needed
- Integration with existing code

## After completing
Update \`docs/project-brief.md\` roadmap table:
- Change \`${feature.id}\` status from \`⬜ todo\` to \`✅ done\`
- If you discover new features needed, add them as new \`⬜ todo\` rows to the roadmap table

## Verification
- Code compiles (\`npx tsc --noEmit\`)
- Feature works as described
- No regressions to existing features`;
}

// ── Idea generation issue ───────────────────────────────────────────

function buildIdeaIssue() {
  return {
    title: 'Propose new roadmap features for Companion',
    agent: 'backend-engineer',
    body: `## Context
Read \`docs/project-brief.md\` — especially the Roadmap section.

The roadmap is running low on \`⬜ todo\` items. Your job is to propose new features.

## Scope
1. Read the project brief to understand what Companion does
2. Read the current codebase to see what's built
3. Identify 3-5 high-value features that would advance the product
4. Add them as new rows to the Roadmap table in \`docs/project-brief.md\`

## Guidelines
- Each feature should be implementable in a single PR
- Stay within the app's vision: personal AI companion, schedule/deadlines, journaling, push notifications
- Don't propose features explicitly marked as out of scope
- Think about: what's missing for the app to be genuinely useful on an iPhone?
- Consider: UX improvements, data persistence, offline support, onboarding, settings

## Deliverable
Add new rows to the Roadmap table in \`docs/project-brief.md\`:
\`\`\`
| ⬜ todo | \`feature-id\` | agent-name | Description |
\`\`\`

## Verification
- New rows follow the table format exactly
- Features are realistic and in-scope
- Each has the right agent assigned`,
  };
}

// ── Get existing open issues ────────────────────────────────────────

async function getExistingIssueTitles() {
  try {
    const issues = await githubAPI(
      `/repos/${OWNER}/${REPO_NAME}/issues?state=open&per_page=100`
    );
    return new Set(issues.map(i => i.title.toLowerCase()));
  } catch (e) {
    console.error('Failed to fetch existing issues:', e.message);
    return new Set();
  }
}

// ── Count active agents (draft PRs = agent currently working) ───────

async function countActiveAgents() {
  try {
    const prs = await githubAPI(
      `/repos/${OWNER}/${REPO_NAME}/pulls?state=open&per_page=100`
    );
    // Count draft PRs (agents actively working)
    const drafts = prs.filter(pr => pr.draft === true);
    // Also count non-draft agent PRs waiting to merge
    const COPILOT_LOGINS = new Set(['Copilot', 'copilot-swe-agent[bot]']);
    const agentReady = prs.filter(pr => !pr.draft && COPILOT_LOGINS.has(pr.user?.login));
    const total = drafts.length + agentReady.length;
    return total;
  } catch (e) {
    console.error('  Failed to count active agents:', e.message);
    return MAX_CONCURRENT_AGENTS; // Assume full on errors (conservative)
  }
}

// Check if agents recently hit rate limits (avoid reassigning into a rate-limit storm)
async function isRateLimited() {
  try {
    // Look for PRs closed in the last 60 minutes with rate-limit comments
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const prs = await githubAPI(
      `/repos/${OWNER}/${REPO_NAME}/pulls?state=closed&sort=updated&direction=desc&per_page=10`
    );
    const recent = prs.filter(pr => new Date(pr.closed_at) > new Date(since));
    for (const pr of recent) {
      try {
        const comments = await githubAPI(
          `/repos/${OWNER}/${REPO_NAME}/issues/${pr.number}/comments?per_page=5&sort=created&direction=desc`
        );
        const hasRateLimit = comments.some(c =>
          c.body && (c.body.includes('rate limit') || c.body.includes('rate_limit'))
        );
        if (hasRateLimit) {
          console.log(`  ⚠️ Rate limit detected on recently closed PR #${pr.number}`);
          return true;
        }
      } catch {}
    }
    return false;
  } catch {
    return false;
  }
}

// ── Reassign unassigned agent-task issues ───────────────────────────

async function reassignUnassignedIssues(availableSlots) {
  console.log('\n--- Checking for unassigned agent-task issues ---');

  if (!CAN_ASSIGN_AGENTS) {
    console.log('  Skipping (no AGENT_PAT configured)');
    return 0;
  }

  if (availableSlots <= 0) {
    console.log(`  No available slots (${MAX_CONCURRENT_AGENTS} agents already active)`);
    return 0;
  }

  try {
    const issues = await githubAPI(
      `/repos/${OWNER}/${REPO_NAME}/issues?state=open&labels=agent-task&per_page=100`
    );

    const unassigned = issues.filter(i => !i.assignees || i.assignees.length === 0);
    if (unassigned.length === 0) {
      console.log('  All agent-task issues have assignees ✓');
      return 0;
    }

    console.log(`  Found ${unassigned.length} unassigned issue(s), ${availableSlots} slot(s) available`);
    const batch = unassigned.slice(0, availableSlots);
    let assigned = 0;

    for (const issue of batch) {
      console.log(`  #${issue.number} → Copilot (${COPILOT_MODEL})...`);

      if (DRY_RUN) {
        console.log(`    [DRY RUN] Would assign Copilot`);
        assigned++;
        continue;
      }

      try {
        await assignCopilotToIssue(issue.number);
        console.log(`    ✅ Assigned Copilot (${COPILOT_MODEL})`);
        assigned++;
      } catch (e) {
        console.log(`    ❌ Failed: ${e.message}`);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    const remaining = unassigned.length - batch.length;
    if (remaining > 0) {
      console.log(`  ⏳ ${remaining} issue(s) waiting for slots (next orchestrator run)`);
    }
    console.log(`  Assigned ${assigned}/${batch.length} issues`);
    return assigned;
  } catch (e) {
    console.error('  Failed to fetch issues:', e.message);
    return 0;
  }
}

// ── Agent assignment via REST API ────────────────────────────────────
// Assigns Copilot coding agent to an issue using the official REST API.
// No session cookies, no internal GraphQL, no workflow dispatch needed.

/**
 * Assign Copilot coding agent to an issue via REST API.
 * Uses agent_assignment to specify model (claude-sonnet-4.5 by default).
 */
async function assignCopilotToIssue(issueNumber) {
  await githubAPI(
    `/repos/${OWNER}/${REPO_NAME}/issues/${issueNumber}/assignees`,
    'POST',
    {
      assignees: [COPILOT_BOT_LOGIN],
      agent_assignment: {
        target_repo: `${OWNER}/${REPO_NAME}`,
        base_branch: 'main',
        custom_instructions: '',
        custom_agent: '',
        model: COPILOT_MODEL,
      },
    },
    AGENT_PAT
  );
  return true;
}

// ── Issue creation ──────────────────────────────────────────────────

async function createAndAssignIssue(title, body, agent) {
  console.log(`\n  Creating: "${title}"`);
  console.log(`   Agent profile: ${agent}`);

  if (DRY_RUN) {
    console.log(`   [DRY RUN] Would create issue`);
    return true;
  }

  let created;
  try {
    created = await githubAPI(
      `/repos/${OWNER}/${REPO_NAME}/issues`, 'POST',
      { title, body, labels: ['agent-task'] }
    );
    console.log(`   Created: ${created.html_url}`);
  } catch (e) {
    console.error(`   Failed to create issue: ${e.message}`);
    return false;
  }

  if (!CAN_ASSIGN_AGENTS) {
    console.log('   Skipping agent assignment (no AGENT_PAT configured)');
    return true;
  }

  // Assign Copilot coding agent via REST API (model: claude-sonnet-4.5)
  console.log(`   Assigning Copilot (model: ${COPILOT_MODEL})...`);
  try {
    await assignCopilotToIssue(created.number);
    console.log(`   ✅ Copilot assigned (${COPILOT_MODEL})`);
  } catch (e) {
    console.log(`   ❌ Failed to assign Copilot: ${e.message}`);
  }

  return true;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('Feature-Driven Agent Orchestrator');
  console.log('='.repeat(60));
  console.log(`Repository: ${OWNER}/${REPO_NAME}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Agent: Copilot coding agent (model: ${COPILOT_MODEL})`);
  console.log(`Agent assignment: ${CAN_ASSIGN_AGENTS ? 'enabled' : 'DISABLED'}`);
  console.log('');

  // Parse roadmap from project brief
  const roadmap = parseRoadmap();
  console.log(`Parsed ${roadmap.length} roadmap items from project-brief.md`);

  const done = roadmap.filter(f => f.status === 'done');
  const inProgress = roadmap.filter(f => f.status === 'in-progress');
  const todo = roadmap.filter(f => f.status === 'todo');

  console.log(`  ✅ done: ${done.length}`);
  console.log(`  🔄 in-progress: ${inProgress.length}`);
  console.log(`  ⬜ todo: ${todo.length}`);
  console.log('');

  // Get existing issues to avoid duplicates
  const existing = await getExistingIssueTitles();
  console.log(`${existing.size} open issues found on GitHub\n`);

  // Build issue list from todo features
  const issuesToCreate = [];

  for (const feature of todo) {
    const title = `${feature.description}`;
    if (!existing.has(title.toLowerCase())) {
      issuesToCreate.push({
        title,
        body: buildIssueBody(feature),
        agent: feature.agent,
      });
    } else {
      console.log(`  ⏭  "${title}" — already has open issue`);
    }
  }

  // If running low on todos, add an idea generation issue
  if (todo.length <= LOW_TODO_THRESHOLD) {
    const ideaTitle = 'Propose new roadmap features for Companion';
    if (!existing.has(ideaTitle.toLowerCase())) {
      const idea = buildIdeaIssue();
      issuesToCreate.push({
        title: idea.title,
        body: idea.body,
        agent: idea.agent,
      });
      console.log(`\n  💡 Roadmap is running low (${todo.length} todos) — adding idea generation issue`);
    }
  }

  // Check how many agents are currently active (draft PRs + ready PRs)
  const activeAgents = await countActiveAgents();
  const availableSlots = Math.max(0, MAX_CONCURRENT_AGENTS - activeAgents);
  console.log(`\n🔄 Active agents: ${activeAgents}/${MAX_CONCURRENT_AGENTS} (${availableSlots} slot(s) available)`);

  // Check for recent rate limits — back off if agents are being throttled
  if (availableSlots > 0) {
    const rateLimited = await isRateLimited();
    if (rateLimited) {
      console.log('\n⏸  Backing off — Copilot hit rate limits recently. Will retry next scheduled run.');
      return;
    }
  }

  // PRIORITY: Reassign existing unassigned issues FIRST (they've been waiting longer)
  const reassigned = await reassignUnassignedIssues(availableSlots);
  const slotsAfterReassign = Math.max(0, availableSlots - reassigned);

  // Then create new issues from roadmap with remaining slots
  const maxToCreate = Math.min(MAX_ISSUES_PER_RUN, slotsAfterReassign);
  const batch = issuesToCreate.slice(0, maxToCreate);

  if (availableSlots === 0) {
    console.log('\n⏸  All agent slots full — skipping issue creation and assignment');
    console.log(`   ${issuesToCreate.length} issue(s) queued for next run`);
  } else if (slotsAfterReassign === 0) {
    console.log(`\n⏸  All slots used by reassigned issues — ${issuesToCreate.length} new issue(s) queued for next run`);
  } else if (batch.length === 0) {
    console.log('\nAll features have issues or are done. Nothing to create!');
  } else {
    console.log(`\nCreating ${batch.length} issues (${slotsAfterReassign} slot(s) remaining after reassignment)...\n`);

    let created = 0;
    for (const issue of batch) {
      const ok = await createAndAssignIssue(issue.title, issue.body, issue.agent);
      if (ok) created++;
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\nCreated ${created}/${batch.length} issues`);
  }

  console.log('\nOrchestrator will re-run on next cron schedule.');
  console.log('='.repeat(60));
}

main().catch(error => {
  console.error('Fatal error:', error);
});
