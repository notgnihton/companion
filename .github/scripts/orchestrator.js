#!/usr/bin/env node

/**
 * Feature-Driven Agent Orchestrator
 *
 * Reads the Roadmap table from docs/project-brief.md dynamically:
 *   | ⬜ todo | `feature-id` | agent-name | Description |
 *
 * For each "⬜ todo" row without a matching open issue, creates a GitHub issue
 * and triggers an AI coding agent with fallback:
 *   Claude → Copilot → Codex (round-robin)
 *
 * Each agent has a different trigger mechanism:
 *   - Claude:  Playwright workflow_dispatch → internal GraphQL assignment
 *   - Copilot: REST API `agent_assignment` payload on POST /assignees
 *   - Codex:   @codex comment  (triggers chatgpt-codex-connector app)
 *
 * Note: Claude can only be triggered via GitHub's internal GraphQL (browser context).
 * We use a Playwright wrapper (.github/workflows/assign-claude.yml) to automate this.
 *
 * Issues are distributed round-robin across providers to spread load.
 *
 * When there are few todo items remaining, creates an "idea generation" issue
 * asking an agent to propose new roadmap items — so work never runs out.
 */

const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────

const AGENT_PAT = process.env.AGENT_PAT || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || AGENT_PAT;
const REPO = process.env.GITHUB_REPOSITORY || 'svngwtn/companion';
const [OWNER, REPO_NAME] = REPO.split('/');
const DRY_RUN = process.env.DRY_RUN === 'true';
const API = 'https://api.github.com';
const CAN_ASSIGN_AGENTS = Boolean(AGENT_PAT);
const MAX_ISSUES_PER_RUN = 3;
const LOW_TODO_THRESHOLD = 2; // When <= this many todos remain, generate ideas

// ── AI Agent providers (round-robin order) ──────────────────────────
// Each provider has a different trigger mechanism:
//   All agents use the assign-agent.yml workflow dispatch which calls
//   GitHub's internal GraphQL to assign the bot to the issue.

const AGENT_PROVIDERS = [
  { name: 'Claude',  trigger: 'workflow', botId: 'BOT_kgDODnPHJg', display: 'Claude (Anthropic)' },
  { name: 'Copilot', trigger: 'workflow', botId: 'BOT_kgDOC9w8XQ', display: 'Copilot (GitHub)' },
  { name: 'Codex',   trigger: 'workflow', botId: 'BOT_kgDODnSAjQ', display: 'Codex (OpenAI)' },
];

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

// ── Reassign unassigned agent-task issues ───────────────────────────

async function reassignUnassignedIssues() {
  console.log('\n--- Checking for unassigned agent-task issues ---');

  if (!CAN_ASSIGN_AGENTS) {
    console.log('  Skipping (no AGENT_PAT configured)');
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

    console.log(`  Found ${unassigned.length} unassigned issue(s)`);
    let assigned = 0;

    for (const issue of unassigned) {
      const provider = AGENT_PROVIDERS[providerIndex % AGENT_PROVIDERS.length];
      providerIndex++;

      console.log(`  #${issue.number} → ${provider.name}...`);

      if (DRY_RUN) {
        console.log(`    [DRY RUN] Would assign ${provider.name}`);
        assigned++;
        continue;
      }

      try {
        await triggerAgentWorkflow(
          issue.number, issue.node_id, provider.botId, provider.name
        );
        console.log(`    ✅ Triggered ${provider.name}`);
        assigned++;
      } catch (e) {
        console.log(`    ❌ Failed: ${e.message}`);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`  Assigned ${assigned}/${unassigned.length} issues`);
    return assigned;
  } catch (e) {
    console.error('  Failed to fetch issues:', e.message);
    return 0;
  }
}

// ── Agent triggering ────────────────────────────────────────────────
// Each provider uses a different mechanism to start working on an issue.

/**
 * Trigger Copilot via REST API agent_assignment payload.
 * This is the official API for triggering GitHub's coding agent.
 */
/**
 * Trigger an agent (Claude, Copilot, or Codex) via the assign-agent workflow.
 * Dispatches .github/workflows/assign-agent.yml which uses fetch to call
 * GitHub's internal GraphQL and assign the bot to the issue.
 */
async function triggerAgentWorkflow(issueNumber, issueNodeId, botId, displayName) {
  await githubAPI(
    `/repos/${OWNER}/${REPO_NAME}/actions/workflows/assign-agent.yml/dispatches`,
    'POST',
    {
      ref: 'main',
      inputs: {
        issue_number: String(issueNumber),
        issue_node_id: issueNodeId,
        agent_bot_id: botId,
        agent_display_name: displayName,
      },
    },
    AGENT_PAT
  );
  return true;
}

/**
 * Try to trigger the given provider on an issue.
 * Returns true if the trigger was sent successfully.
 */
async function tryTriggerAgent(issueNumber, provider, agentProfile, issueNodeId) {
  return triggerAgentWorkflow(issueNumber, issueNodeId, provider.botId, provider.name);
}

// ── Issue creation ──────────────────────────────────────────────────

let providerIndex = 0; // round-robin counter

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

  // Round-robin across providers, with fallback on failure
  const startIdx = providerIndex % AGENT_PROVIDERS.length;
  providerIndex++;
  let assigned = false;

  for (let i = 0; i < AGENT_PROVIDERS.length; i++) {
    const provider = AGENT_PROVIDERS[(startIdx + i) % AGENT_PROVIDERS.length];
    console.log(`   Trying ${provider.display} (${provider.trigger === 'assign' ? 'agent_assignment' : 'workflow dispatch'})...`);

    try {
      const ok = await tryTriggerAgent(created.number, provider, agent, created.node_id);
      if (ok) {
        console.log(`   ✅ Triggered ${provider.display}`);
        assigned = true;
        break;
      } else {
        console.log(`   ⚠  ${provider.name} trigger failed — trying next`);
      }
    } catch (e) {
      console.log(`   ⚠  ${provider.name} error: ${e.message}`);
    }
  }

  if (!assigned) {
    console.log('   ❌ All providers failed — issue created but no agent triggered');
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

  // Cap at MAX_ISSUES_PER_RUN
  const batch = issuesToCreate.slice(0, MAX_ISSUES_PER_RUN);

  if (batch.length === 0) {
    console.log('\nAll features have issues or are done. Nothing to create!');
  } else {
    console.log(`\nCreating ${batch.length} issues...\n`);

    let created = 0;
    for (const issue of batch) {
      const ok = await createAndAssignIssue(issue.title, issue.body, issue.agent);
      if (ok) created++;
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\nCreated ${created}/${batch.length} issues`);
  }

  // Reassign any existing unassigned agent-task issues
  await reassignUnassignedIssues();

  console.log('\nOrchestrator will re-run on next cron schedule.');
  console.log('='.repeat(60));
}

main().catch(error => {
  console.error('Fatal error:', error);
});
