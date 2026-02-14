#!/usr/bin/env node

/**
 * Feature-Driven Agent Orchestrator
 *
 * Reads the Roadmap table from docs/project-brief.md dynamically:
 *   | ⬜ todo | `feature-id` | agent-name | Description |
 *
 * For each "⬜ todo" row without a matching open issue, creates a GitHub issue
 * and assigns it to Copilot with the specified agent profile.
 *
 * When there are few todo items remaining, creates an "idea generation" issue
 * asking an agent to propose new roadmap items — so work never runs out.
 *
 * Agents update the roadmap as they complete work:
 *   ⬜ todo → ✅ done
 * And can add new rows for features they identify.
 */

const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────

const AGENT_PAT = process.env.AGENT_PAT || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || AGENT_PAT;
const REPO = process.env.GITHUB_REPOSITORY || 'lucyscript/companion';
const [OWNER, REPO_NAME] = REPO.split('/');
const DRY_RUN = process.env.DRY_RUN === 'true';
const API = 'https://api.github.com';
const CAN_ASSIGN_AGENTS = Boolean(AGENT_PAT);
const MAX_ISSUES_PER_RUN = 3;
const LOW_TODO_THRESHOLD = 2; // When <= this many todos remain, generate ideas

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

## Scope
**${feature.description}**

Feature ID: \`${feature.id}\`

Implement this feature following the project brief. Use existing patterns in the codebase.

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

// ── Issue creation ──────────────────────────────────────────────────

async function createAndAssignIssue(title, body, agent) {
  console.log(`\n  Creating: "${title}"`);
  console.log(`   Agent: ${agent}`);

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

  try {
    await githubAPI(
      `/repos/${OWNER}/${REPO_NAME}/issues/${created.number}/assignees`,
      'POST',
      {
        assignees: ['copilot-swe-agent[bot]'],
        agent_assignment: {
          target_repo: `${OWNER}/${REPO_NAME}`,
          base_branch: 'main',
          custom_instructions: `Use the ${agent} agent profile. Follow its instructions strictly. After completing the work, update docs/project-brief.md to reflect your changes.`,
          custom_agent: agent,
          model: '',
        },
      },
      AGENT_PAT
    );
    console.log(`   Assigned to copilot-swe-agent[bot] with agent: ${agent}`);
  } catch (e) {
    console.log(`   Assignment failed: ${e.message}`);
    console.log('   Issue created but agent not assigned — assign manually');
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

  console.log('\nOrchestrator will re-run on next cron schedule.');
  console.log('='.repeat(60));
}

main().catch(error => {
  console.error('Fatal error:', error);
});
