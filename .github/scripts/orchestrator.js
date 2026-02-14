#!/usr/bin/env node

/**
 * Agent Orchestrator
 *
 * 1. Scan codebase for improvements
 * 2. Create well-scoped GitHub issues via REST API
 * 3. Assign each to copilot-swe-agent[bot] (with optional custom_agent routing)
 * 4. Re-create itself as an issue for the recursive loop
 *
 * Uses GitHub REST API directly (no gh CLI) to avoid shell escaping issues.
 * Assignee: copilot-swe-agent[bot] — the official Copilot Coding Agent bot.
 * Third-party agents (Claude, Codex) routed via agent_assignment.custom_agent.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// AGENT_PAT = user PAT (required to trigger Copilot agent sessions)
// GITHUB_TOKEN = Actions token (can create issues but NOT trigger agents)
const AGENT_PAT = process.env.AGENT_PAT || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || AGENT_PAT;
const REPO = process.env.GITHUB_REPOSITORY || 'lucyscript/companion';
const [OWNER, REPO_NAME] = REPO.split('/');
const DRY_RUN = process.env.DRY_RUN === 'true';
const API = 'https://api.github.com';
const CAN_ASSIGN_AGENTS = Boolean(AGENT_PAT);

// ── Custom agent profiles (→ .github/agents/<name>.agent.md) ───────
// All issues go through copilot-swe-agent[bot]; custom_agent selects the profile.
// Available agents: backend-engineer, frontend-engineer, docs-writer, test-engineer
const DEFAULT_AGENT = 'backend-engineer';

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

// ── Helpers ──────────────────────────────────────────────────────────

function pickAgent(title, body = '', file = '') {
  const t = title.toLowerCase();

  // 1. Title-based intent takes priority (what KIND of task is this?)
  if (t.startsWith('document') || t.includes('readme') || t.includes('guide')) return 'docs-writer';
  if (t.includes('test') || t.includes('spec') || t.includes('coverage')) return 'test-engineer';
  if (t.includes('refactor')) {
    // Refactoring routes by file location
    if (file.includes('apps/web/')) return 'frontend-engineer';
    return 'backend-engineer';
  }

  // 2. Route by file path
  if (file) {
    if (file.startsWith('docs/') || file.endsWith('.md')) return 'docs-writer';
    if (file.includes('.test.') || file.includes('.spec.')) return 'test-engineer';
    if (file.includes('apps/web/')) return 'frontend-engineer';
    if (file.includes('apps/server/') || file.includes('.github/')) return 'backend-engineer';
  }

  // 3. Title keyword fallback
  if (t.includes('component') || t.includes('react') || t.includes('css') || t.includes('ui ')) return 'frontend-engineer';
  if (t.includes('server') || t.includes('agent') || t.includes('orchestrat')) return 'backend-engineer';

  return DEFAULT_AGENT;
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

// ── Discovery functions ─────────────────────────────────────────────

function findTodos() {
  const issues = [];
  try {
    // Exclude this script and .github/scripts/ to avoid self-matching
    const output = execSync(
      'git grep -n -E "TODO|FIXME|HACK|XXX" -- "*.ts" "*.tsx" ":!.github/scripts/*" ":!node_modules/*" 2>/dev/null || true',
      { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
    );

    for (const line of output.trim().split('\n').filter(Boolean)) {
      const match = line.match(/^(.+?):(\d+):.*(?:TODO|FIXME|HACK|XXX)[:\s]*(.+)/i);
      if (match) {
        const [, file, lineNum, comment] = match;
        const clean = comment.trim().replace(/\*\/\s*$/, '').trim();
        if (clean.length > 10) {
          issues.push({
            title: `Fix: ${clean.slice(0, 80)}`,
            body: [
              '## Scope',
              `Address TODO/FIXME found in \`${file}:${lineNum}\`:`,
              `> ${clean}`,
              '',
              '## Deliverable',
              'Remove the TODO/FIXME comment by implementing the described change.',
              '',
              '## Verification',
              '- The TODO/FIXME is removed',
              '- The described improvement is implemented',
              '- No regressions introduced',
            ].join('\n'),
            file,
          });
        }
      }
    }
  } catch (e) {
    console.log('TODO scan skipped:', e.message);
  }
  return issues;
}

function findMissingTests() {
  const issues = [];
  try {
    const srcFiles = execSync(
      'find apps/server/src apps/web/src -name "*.ts" -o -name "*.tsx" 2>/dev/null | grep -v node_modules | grep -v ".d.ts"',
      { encoding: 'utf-8' }
    ).trim().split('\n').filter(Boolean);

    const testFiles = new Set();
    try {
      execSync('find . -name "*.test.*" -o -name "*.spec.*" 2>/dev/null', { encoding: 'utf-8' })
        .trim().split('\n').filter(Boolean)
        .forEach(f => testFiles.add(path.basename(f).replace(/\.(test|spec)\./, '.')));
    } catch { /* no test files yet */ }

    const untested = srcFiles.filter(f => {
      const base = path.basename(f);
      return !testFiles.has(base) && !base.includes('index') && !base.includes('types');
    });

    if (untested.length > 0) {
      const priority = untested.slice(0, 3);
      issues.push({
        title: `Add tests for ${priority.map(f => path.basename(f)).join(', ')}`,
        body: [
          '## Scope',
          'Add unit tests for these untested source files:',
          ...priority.map(f => `- \`${f}\``),
          '',
          '## Deliverable',
          'Create test files with meaningful test cases covering core functionality.',
          '',
          '## Verification',
          '- Test files exist and are runnable',
          '- Tests cover happy path and edge cases',
          '- Tests pass',
        ].join('\n'),
        file: priority[0],
      });
    }
  } catch (e) {
    console.log('Test scan skipped:', e.message);
  }
  return issues;
}

function findDocGaps() {
  const issues = [];
  const wantedDocs = [
    { path: 'docs/api.md', title: 'Document API endpoints and contracts' },
    { path: 'docs/architecture.md', title: 'Document system architecture and data flow' },
    { path: 'docs/deployment.md', title: 'Document deployment and hosting guide' },
  ];

  for (const doc of wantedDocs) {
    if (!fs.existsSync(doc.path)) {
      issues.push({
        title: doc.title,
        body: [
          '## Scope',
          `Create \`${doc.path}\` with comprehensive documentation.`,
          '',
          '## Deliverable',
          'A well-structured markdown document covering the topic.',
          '',
          '## Verification',
          `- File exists at \`${doc.path}\``,
          '- Content is accurate and helpful',
          '- Follows existing doc style',
        ].join('\n'),
        file: doc.path,
      });
    }
  }
  return issues;
}

function findCodeImprovements() {
  const issues = [];
  try {
    const bigFiles = execSync(
      'find apps -name "*.ts" -o -name "*.tsx" 2>/dev/null | xargs wc -l 2>/dev/null | sort -rn | head -5',
      { encoding: 'utf-8' }
    ).trim().split('\n').filter(l => !l.includes('total'));

    for (const line of bigFiles) {
      const match = line.trim().match(/^(\d+)\s+(.+)/);
      if (match && parseInt(match[1]) > 200) {
        const [, lines, file] = match;
        issues.push({
          title: `Refactor ${path.basename(file)} (${lines} lines)`,
          body: [
            '## Scope',
            `Refactor \`${file}\` which has ${lines} lines. Break into smaller, focused modules.`,
            '',
            '## Deliverable',
            '- Split into logical sub-modules',
            '- Maintain all existing functionality',
            '- Improve readability',
            '',
            '## Verification',
            '- Original functionality preserved',
            '- File sizes under 150 lines each',
            '- Clear module boundaries',
          ].join('\n'),
          file,
        });
      }
    }
  } catch (e) {
    console.log('Code improvement scan skipped:', e.message);
  }
  return issues;
}

// ── Core: Create issue, then assign agent in a separate step ────────
// Step 1: Create issue with GITHUB_TOKEN (always works)
// Step 2: Assign copilot-swe-agent[bot] with AGENT_PAT (user token required)
//         GitHub docs: "authenticate with a user token" to trigger agent sessions

async function createAndAssignIssue(issue, customAgent) {
  console.log(`\n  Creating: "${issue.title}"`);
  console.log(`   Custom agent: ${customAgent}`);

  if (DRY_RUN) {
    console.log(`   [DRY RUN] Would create issue (can_assign=${CAN_ASSIGN_AGENTS})`);
    return true;
  }

  // Step 1: Create the issue (works with any token)
  let created;
  try {
    created = await githubAPI(
      `/repos/${OWNER}/${REPO_NAME}/issues`, 'POST',
      { title: issue.title, body: issue.body, labels: ['agent-task'] }
    );
    console.log(`   Created: ${created.html_url}`);
  } catch (e) {
    console.error(`   Failed to create issue: ${e.message}`);
    return false;
  }

  // Step 2: Assign to Copilot agent with custom agent profile (requires user PAT)
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
          custom_instructions: `Use the ${customAgent} agent profile. Follow its instructions strictly.`,
          custom_agent: customAgent,
          model: '',
        },
      },
      AGENT_PAT
    );
    console.log(`   Assigned to copilot-swe-agent[bot] with agent: ${customAgent}`);
  } catch (e) {
    console.log(`   Assignment failed: ${e.message}`);
    console.log('   Issue created but agent not assigned - assign manually from GitHub UI');
  }

  return true;
}

// ── Recursive: Create the next orchestrator issue ───────────────────

async function createRecursiveIssue() {
  const title = 'Orchestrator: discover and assign new work';
  const body = [
    '## Scope',
    'Run the orchestrator to scan the codebase and create new issues.',
    '',
    'This is a **recursive issue** -- when completed, a new orchestrator issue is created automatically.',
    '',
    '## Deliverable',
    '1. Scan codebase for TODOs, missing tests, doc gaps, code improvements',
    '2. Create well-scoped issues for each finding',
    '3. Assign each issue to the best agent',
    '4. Create the next orchestrator issue to continue the loop',
    '',
    '## Verification',
    '- New issues created with `agent-task` label',
    '- Each issue assigned to an appropriate agent',
    '- Next orchestrator issue exists',
  ].join('\n');

  console.log('\n  Creating next orchestrator issue...');

  if (DRY_RUN) {
    console.log('   [DRY RUN] Would create recursive issue');
    return;
  }

  try {
    const created = await githubAPI(
      `/repos/${OWNER}/${REPO_NAME}/issues`, 'POST',
      { title, body, labels: ['agent-task'] }
    );
    console.log(`   Recursive issue created: ${created.html_url}`);

    // Assign to copilot if we have a user PAT
    if (CAN_ASSIGN_AGENTS) {
      try {
        await githubAPI(
          `/repos/${OWNER}/${REPO_NAME}/issues/${created.number}/assignees`,
          'POST',
          {
            assignees: ['copilot-swe-agent[bot]'],
            agent_assignment: {
              target_repo: `${OWNER}/${REPO_NAME}`,
              base_branch: 'main',
              custom_instructions: 'Run the orchestrator workflow to discover and assign new work.',
              custom_agent: '',
              model: '',
            },
          },
          AGENT_PAT
        );
        console.log('   Assigned to copilot-swe-agent[bot]');
      } catch (e) {
        console.log(`   Recursive issue created but assignment failed: ${e.message}`);
      }
    }
  } catch (e) {
    console.error(`   Failed to create recursive issue: ${e.message}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('Agent Orchestrator');
  console.log('='.repeat(60));
  console.log(`Repository: ${OWNER}/${REPO_NAME}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Agent assignment: ${CAN_ASSIGN_AGENTS ? 'enabled (AGENT_PAT)' : 'DISABLED (no AGENT_PAT)'}`);
  if (!CAN_ASSIGN_AGENTS) {
    console.log('  -> Issues will be created but agents will NOT be assigned.');
    console.log('  -> To enable: add a Fine-Grained PAT as AGENT_PAT repo secret.');
    console.log('  -> PAT needs: metadata(r), actions(rw), contents(rw), issues(rw), pull-requests(rw)');
  }
  console.log('');

  // Get existing issues to avoid duplicates
  const existing = await getExistingIssueTitles();
  console.log(`${existing.size} open issues found`);

  // Discover work
  console.log('\nScanning codebase...');
  const allIssues = [
    ...findTodos(),
    ...findMissingTests(),
    ...findDocGaps(),
    ...findCodeImprovements(),
  ];

  console.log(`\nFound ${allIssues.length} potential issues`);

  // Filter duplicates
  const newIssues = allIssues.filter(i => !existing.has(i.title.toLowerCase()));
  console.log(`${newIssues.length} new issues (after dedup)`);

  // Cap at 5 issues per run to avoid spam
  const batch = newIssues.slice(0, 5);

  if (batch.length === 0) {
    console.log('\nNo new issues to create. Codebase looks good!');
  } else {
    console.log(`\nCreating ${batch.length} issues...\n`);

    let created = 0;
    for (const issue of batch) {
      const agent = pickAgent(issue.title, issue.body, issue.file);
      const ok = await createAndAssignIssue(issue, agent);
      if (ok) created++;

      // Small delay between API calls
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\nCreated ${created}/${batch.length} issues`);
  }

  // Create next orchestrator issue (recursive loop)
  if (process.env.RECURSIVE !== 'false') {
    await createRecursiveIssue();
  }

  console.log('\n' + '='.repeat(60));
  console.log('Orchestrator complete');
  console.log('='.repeat(60));
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
