#!/usr/bin/env node

/**
 * Feature-Driven Agent Orchestrator
 *
 * Reads docs/project-brief.md for the feature roadmap, checks which features
 * are already implemented or have open issues, and creates well-scoped issues
 * for the next batch of work. Assigns each to Copilot's coding agent with the
 * appropriate custom agent profile.
 *
 * This replaces the old scan-based approach (TODOs, missing tests, big files)
 * which produced low-value busywork. Now every issue maps to a product feature.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Config ──────────────────────────────────────────────────────────

const AGENT_PAT = process.env.AGENT_PAT || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || AGENT_PAT;
const REPO = process.env.GITHUB_REPOSITORY || 'lucyscript/companion';
const [OWNER, REPO_NAME] = REPO.split('/');
const DRY_RUN = process.env.DRY_RUN === 'true';
const API = 'https://api.github.com';
const CAN_ASSIGN_AGENTS = Boolean(AGENT_PAT);
const MAX_ISSUES_PER_RUN = 3;

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

// ── Feature Roadmap ─────────────────────────────────────────────────
// Ordered by priority. Each feature defines:
//   - id: unique slug (used to track status in the brief)
//   - title: issue title
//   - agent: which custom agent profile to assign
//   - body: full issue body with scope, deliverable, verification
//   - check: function that returns true if the feature is already implemented

const FEATURES = [
  {
    id: 'journal-api',
    title: 'Implement journal API endpoints',
    agent: 'backend-engineer',
    body: `## Context
Read \`docs/project-brief.md\` first — this is the Companion app.

## Scope
Build the journal API in \`apps/server/src/\`:
- \`POST /api/journal\` — create a journal entry (text, optional mood tag)
- \`GET /api/journal\` — list entries (paginated, newest first)
- \`GET /api/journal/:id\` — get a single entry
- Store entries in RuntimeStore (add a \`journalEntries\` collection)

## Out of Scope
- Frontend UI (separate issue)
- Push notifications
- Voice input

## Deliverable
- New route handlers in \`index.ts\` or a new \`routes/journal.ts\`
- Types added to \`types.ts\`: \`JournalEntry { id, text, mood?, createdAt }\`
- RuntimeStore extended with journal storage
- Update \`docs/project-brief.md\` roadmap to mark this feature as done

## Verification
- \`curl POST /api/journal\` creates an entry
- \`curl GET /api/journal\` returns entries
- Types compile (\`npm run typecheck\`)`,
    check: () => fileContains('apps/server/src/index.ts', 'journal') ||
                 fileExists('apps/server/src/routes/journal.ts'),
  },
  {
    id: 'journal-ui',
    title: 'Build journal UI component',
    agent: 'frontend-engineer',
    body: `## Context
Read \`docs/project-brief.md\` first — this is the Companion app.

## Scope
Build the journal interface in \`apps/web/src/\`:
- A \`JournalView\` component: text input, submit button, entry list
- Entries stored in localStorage (the API may not be deployed yet)
- Quick-entry feel: tap, type, done
- Evening reflection prompt: "Ready to journal? Here's what you did today..."
- Mobile-first layout that works on iPhone

## Out of Scope
- Voice input (future)
- Push notification triggers
- Backend API integration (use localStorage for now)

## Deliverable
- \`components/JournalView.tsx\` — the main journal interface
- \`lib/storage.ts\` extended with journal entry persistence
- \`types.ts\` updated with \`JournalEntry\` type
- Journal accessible from the main App layout
- Update \`docs/project-brief.md\` roadmap to mark this feature as done

## Verification
- Can type and submit an entry
- Entries persist across page reloads (localStorage)
- Layout works on mobile viewport`,
    check: () => fileExists('apps/web/src/components/JournalView.tsx'),
  },
  {
    id: 'schedule-api',
    title: 'Implement schedule & deadline API endpoints',
    agent: 'backend-engineer',
    body: `## Context
Read \`docs/project-brief.md\` first — this is the Companion app.

## Scope
Build schedule/deadline APIs in \`apps/server/src/\`:
- \`POST /api/schedule\` — add a recurring event (lecture, meeting)
- \`GET /api/schedule\` — list events for a date range
- \`POST /api/deadlines\` — add an assignment deadline
- \`GET /api/deadlines\` — list upcoming deadlines (sorted by due date)
- \`PATCH /api/deadlines/:id\` — mark as complete
- Store in RuntimeStore

## Out of Scope
- Notification scheduling (separate issue)
- Frontend UI
- Calendar import/export

## Deliverable
- Route handlers (new file or added to index.ts)
- Types: \`ScheduleEvent { id, title, dayOfWeek, startTime, endTime, room? }\`
- Types: \`Deadline { id, title, dueDate, course?, completed, createdAt }\`
- RuntimeStore extended
- Update \`docs/project-brief.md\` roadmap to mark this feature as done

## Verification
- CRUD operations work via curl
- Deadlines sort by due date
- Types compile`,
    check: () => fileContains('apps/server/src/index.ts', '/api/schedule') ||
                 fileContains('apps/server/src/index.ts', '/api/deadlines') ||
                 fileExists('apps/server/src/routes/schedule.ts'),
  },
  {
    id: 'schedule-ui',
    title: 'Build schedule & deadline tracking UI',
    agent: 'frontend-engineer',
    body: `## Context
Read \`docs/project-brief.md\` first — this is the Companion app.

## Scope
Build schedule/deadline UI in \`apps/web/src/\`:
- \`ScheduleView\` component: show today's lectures/events as a timeline
- \`DeadlineList\` component: upcoming deadlines with urgency indicators
- Add/edit forms for events and deadlines
- Store in localStorage (API may not be deployed)
- Color-code by urgency: green (>3 days), yellow (1-3 days), red (<1 day)

## Out of Scope
- Calendar import
- Push notifications
- Backend API calls (use localStorage)

## Deliverable
- \`components/ScheduleView.tsx\`
- \`components/DeadlineList.tsx\`
- localStorage persistence via \`lib/storage.ts\`
- Types in \`types.ts\`
- Integrated into main App layout
- Update \`docs/project-brief.md\` roadmap to mark this feature as done

## Verification
- Can add a lecture and see it on the timeline
- Can add a deadline and see urgency color
- Data persists across reloads`,
    check: () => fileExists('apps/web/src/components/ScheduleView.tsx') ||
                 fileExists('apps/web/src/components/DeadlineList.tsx'),
  },
  {
    id: 'push-notifications',
    title: 'Implement web push notification infrastructure',
    agent: 'backend-engineer',
    body: `## Context
Read \`docs/project-brief.md\` first — this is the Companion app.
This is the most important feature: push notifications to iPhone.

## Scope
Build push notification infrastructure:
- Generate VAPID keys (server-side)
- \`POST /api/push/subscribe\` — store a push subscription
- \`POST /api/push/send\` — send a notification (internal, used by agents)
- Service worker registration in the frontend for push events
- Use the \`web-push\` npm package

## Out of Scope
- Notification scheduling logic (handled by agents)
- Specific notification content/triggers

## Deliverable
- VAPID key generation script or config
- Push subscription API endpoints
- Service worker (\`apps/web/public/sw.js\`) handling push events
- Frontend: \`lib/push.ts\` for subscription management
- \`package.json\` updated with \`web-push\` dependency
- Update \`docs/project-brief.md\` roadmap to mark this feature as done

## Verification
- Can subscribe for notifications in the browser
- Can send a test notification via API
- Service worker receives and displays it`,
    check: () => fileExists('apps/web/public/sw.js') ||
                 fileContains('apps/server/src/index.ts', 'push') ||
                 fileExists('apps/server/src/routes/push.ts'),
  },
  {
    id: 'nudge-engine',
    title: 'Build context-aware nudge engine',
    agent: 'backend-engineer',
    body: `## Context
Read \`docs/project-brief.md\` first — this is the Companion app.

## Scope
Build the nudge engine that generates smart notifications:
- Morning summary: today's schedule + suggested focus areas
- Deadline escalation: increasing urgency as deadlines approach
- Gap detection: find free time between lectures for study suggestions
- Context-awareness: adapt tone based on stress/energy/mode
- Journal prompts: evening reflection nudges

## Out of Scope
- Push notification delivery (uses existing push infrastructure)
- UI components

## Deliverable
- \`apps/server/src/nudge-engine.ts\` — core logic
- Integration with schedule + deadline data
- Integration with context (stress/energy/mode)
- Generates NotificationPayload objects for the push system
- Update \`docs/project-brief.md\` roadmap to mark this feature as done

## Verification
- Given a schedule and deadlines, generates appropriate nudges
- Tone changes with context settings
- Unit tests for nudge logic`,
    check: () => fileExists('apps/server/src/nudge-engine.ts'),
  },
  {
    id: 'api-docs',
    title: 'Document all API endpoints',
    agent: 'docs-writer',
    body: `## Context
Read \`docs/project-brief.md\` first — this is the Companion app.

## Scope
Create \`docs/api.md\` documenting all REST API endpoints:
- For each endpoint: method, path, request body, response, example curl
- Group by domain: journal, schedule, deadlines, push, context
- Only document endpoints that actually exist in the code

## Out of Scope
- Don't document planned/future endpoints that aren't implemented yet

## Deliverable
- \`docs/api.md\` with complete endpoint documentation
- Update \`docs/project-brief.md\` roadmap to mark this feature as done

## Verification
- Every endpoint in \`apps/server/src/index.ts\` is documented
- Example requests are accurate
- No hallucinated endpoints`,
    check: () => fileExists('docs/api.md'),
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

function fileExists(filePath) {
  return fs.existsSync(path.resolve(filePath));
}

function fileContains(filePath, needle) {
  try {
    const content = fs.readFileSync(path.resolve(filePath), 'utf-8');
    return content.toLowerCase().includes(needle.toLowerCase());
  } catch {
    return false;
  }
}

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

async function createAndAssignIssue(feature) {
  console.log(`\n  Creating: "${feature.title}"`);
  console.log(`   Agent: ${feature.agent}`);

  if (DRY_RUN) {
    console.log(`   [DRY RUN] Would create issue`);
    return true;
  }

  let created;
  try {
    created = await githubAPI(
      `/repos/${OWNER}/${REPO_NAME}/issues`, 'POST',
      { title: feature.title, body: feature.body, labels: ['agent-task'] }
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
          custom_instructions: `Use the ${feature.agent} agent profile. Follow its instructions strictly. After completing the work, update docs/project-brief.md to mark the "${feature.id}" roadmap item as done.`,
          custom_agent: feature.agent,
          model: '',
        },
      },
      AGENT_PAT
    );
    console.log(`   Assigned to copilot-swe-agent[bot] with agent: ${feature.agent}`);
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

  // Check what's already done or in-progress
  const existing = await getExistingIssueTitles();
  console.log(`${existing.size} open issues found\n`);

  console.log('Feature status:');
  const todo = [];

  for (const feature of FEATURES) {
    const implemented = feature.check();
    const hasIssue = existing.has(feature.title.toLowerCase());

    const status = implemented ? '✅ done' : hasIssue ? '🔄 open issue' : '⬜ todo';
    console.log(`  ${status}  ${feature.id} — ${feature.title}`);

    if (!implemented && !hasIssue) {
      todo.push(feature);
    }
  }

  console.log(`\n${todo.length} features need work`);

  // Create issues for the next batch (priority order, capped)
  const batch = todo.slice(0, MAX_ISSUES_PER_RUN);

  if (batch.length === 0) {
    console.log('\nAll features implemented or have open issues. Nothing to do!');
  } else {
    console.log(`\nCreating ${batch.length} issues...\n`);

    let created = 0;
    for (const feature of batch) {
      const ok = await createAndAssignIssue(feature);
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
  process.exit(1);
});
