#!/usr/bin/env node

/**
 * Agent Orchestrator
 * 
 * Simple, elegant approach:
 * 1. Scan codebase for improvements (TODOs, gaps, ideas)
 * 2. Create well-scoped GitHub issues
 * 3. Assign each to the best agent: @copilot, @claude-code, or @codex
 * 4. Re-create itself as an issue → recursive loop
 * 
 * Agents available:
 * - copilot  → GitHub Copilot Coding Agent (GPT-5 / Claude Sonnet 4.5)
 * - codex    → OpenAI Codex Agent (gpt-5.3-codex)  
 * - claude   → Claude Code Agent (Claude Sonnet 4.5)
 * 
 * No CLI wrappers, no API chains. Just issues + native agents.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.AGENT_PAT;
const REPO = process.env.GITHUB_REPOSITORY || 'lucyscript/companion';
const [OWNER, REPO_NAME] = REPO.split('/');
const DRY_RUN = process.env.DRY_RUN === 'true';

// ── Agent assignment rules ──────────────────────────────────────────
// Based on .agents/ORCHESTRATION.md file ownership matrix
const AGENT_RULES = {
  // Server/backend work → Codex (strongest at system-level code)
  server: 'codex',
  backend: 'codex',
  api: 'codex',
  runtime: 'codex',
  orchestrator: 'codex',

  // Frontend/UI work → Claude (strongest at UI/UX)
  web: 'claude',
  frontend: 'claude',
  ui: 'claude',
  component: 'claude',
  css: 'claude',
  style: 'claude',

  // Docs, CI, config, general → Copilot (native GitHub integration)
  docs: 'copilot',
  documentation: 'copilot',
  ci: 'copilot',
  workflow: 'copilot',
  config: 'copilot',
  test: 'copilot',
  lint: 'copilot',
  setup: 'copilot',
};

// Default agent for ambiguous tasks
const DEFAULT_AGENT = 'copilot';

// ── Helpers ─────────────────────────────────────────────────────────

function gh(args) {
  try {
    return execSync(`gh ${args}`, { encoding: 'utf-8', timeout: 30000 }).trim();
  } catch (error) {
    console.error(`gh command failed: gh ${args}`);
    console.error(error.message);
    return null;
  }
}

function pickAgent(title, body = '') {
  const text = `${title} ${body}`.toLowerCase();
  for (const [keyword, agent] of Object.entries(AGENT_RULES)) {
    if (text.includes(keyword)) return agent;
  }
  return DEFAULT_AGENT;
}

function getExistingIssueTitles() {
  const result = gh(`issue list --repo ${OWNER}/${REPO_NAME} --state open --limit 100 --json title`);
  if (!result) return new Set();
  try {
    return new Set(JSON.parse(result).map(i => i.title.toLowerCase()));
  } catch {
    return new Set();
  }
}

// ── Discovery functions ─────────────────────────────────────────────

function findTodos() {
  const issues = [];
  try {
    const output = execSync(
      'git grep -n "TODO\\|FIXME\\|HACK\\|XXX" -- "*.ts" "*.tsx" "*.js" "*.md" 2>/dev/null || true',
      { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
    );

    const lines = output.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^(.+?):(\d+):.*(?:TODO|FIXME|HACK|XXX)[:\s]*(.+)/i);
      if (match) {
        const [, file, lineNum, comment] = match;
        const cleanComment = comment.trim().replace(/\*\/\s*$/, '').trim();
        if (cleanComment.length > 10) {
          issues.push({
            title: `Fix: ${cleanComment.slice(0, 80)}`,
            body: `## Scope\nAddress TODO/FIXME found in \`${file}:${lineNum}\`:\n> ${cleanComment}\n\n## Deliverable\nRemove the TODO/FIXME comment by implementing the described change.\n\n## Verification\n- The TODO/FIXME is removed\n- The described improvement is implemented\n- No regressions introduced`,
            file
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

    const untestedFiles = srcFiles.filter(f => {
      const base = path.basename(f);
      return !testFiles.has(base) && !base.includes('index') && !base.includes('types');
    });

    if (untestedFiles.length > 0) {
      // Pick the 3 most important files to test
      const priority = untestedFiles.slice(0, 3);
      issues.push({
        title: `Add tests for ${priority.map(f => path.basename(f)).join(', ')}`,
        body: `## Scope\nAdd unit tests for these untested source files:\n${priority.map(f => `- \`${f}\``).join('\n')}\n\n## Deliverable\nCreate test files with meaningful test cases covering core functionality.\n\n## Verification\n- Test files exist and are runnable\n- Tests cover happy path and edge cases\n- Tests pass`,
        file: priority[0]
      });
    }
  } catch (e) {
    console.log('Test scan skipped:', e.message);
  }
  return issues;
}

function findDocGaps() {
  const issues = [];
  try {
    // Check if key docs exist
    const wantedDocs = [
      { path: 'docs/api.md', title: 'Document API endpoints and contracts' },
      { path: 'docs/architecture.md', title: 'Document system architecture and data flow' },
      { path: 'docs/deployment.md', title: 'Document deployment and hosting guide' },
    ];

    for (const doc of wantedDocs) {
      if (!fs.existsSync(doc.path)) {
        issues.push({
          title: doc.title,
          body: `## Scope\nCreate \`${doc.path}\` with comprehensive documentation.\n\n## Deliverable\nA well-structured markdown document covering the topic.\n\n## Verification\n- File exists at \`${doc.path}\`\n- Content is accurate and helpful\n- Follows existing doc style`,
          file: doc.path
        });
      }
    }
  } catch (e) {
    console.log('Doc scan skipped:', e.message);
  }
  return issues;
}

function findCodeImprovements() {
  const issues = [];
  try {
    // Check for files over 200 lines that could be refactored
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
          body: `## Scope\nRefactor \`${file}\` which has ${lines} lines. Break into smaller, focused modules.\n\n## Deliverable\n- Split into logical sub-modules\n- Maintain all existing functionality\n- Improve readability\n\n## Verification\n- Original functionality preserved\n- File sizes < 150 lines each\n- Clear module boundaries`,
          file
        });
      }
    }
  } catch (e) {
    console.log('Code improvement scan skipped:', e.message);
  }
  return issues;
}

// ── Core: Create issue and assign agent ─────────────────────────────

async function createAndAssignIssue(issue, agent) {
  const label = 'agent-task';
  
  console.log(`\n📋 Creating: "${issue.title}"`);
  console.log(`   🤖 Assigning to: ${agent}`);

  if (DRY_RUN) {
    console.log('   [DRY RUN] Would create issue');
    return true;
  }

  // Create the issue
  const result = gh(
    `issue create --repo ${OWNER}/${REPO_NAME} ` +
    `--title "${issue.title.replace(/"/g, '\\"')}" ` +
    `--body "${issue.body.replace(/"/g, '\\"')}" ` +
    `--label "${label}" ` +
    `--assignee "${agent}"`
  );

  if (result) {
    console.log(`   ✅ Created: ${result}`);
    return true;
  } else {
    console.log(`   ❌ Failed to create issue`);
    return false;
  }
}

// ── Recursive: Create the next orchestrator issue ───────────────────

async function createRecursiveIssue() {
  const title = '🔄 Orchestrator: discover and assign new work';
  const body = `## Scope
Run the orchestrator to scan the codebase and create new issues for improvements.

This is a **recursive issue** — when completed, a new orchestrator issue is created automatically.

## Deliverable
1. Scan codebase for TODOs, missing tests, doc gaps, code improvements
2. Create well-scoped issues for each finding
3. Assign each issue to the best agent (copilot, codex, or claude)
4. Create the next orchestrator issue to continue the loop

## Verification
- New issues created with \`agent-task\` label
- Each issue assigned to an appropriate agent
- Next orchestrator issue exists`;

  console.log('\n♻️  Creating next orchestrator issue...');
  
  if (DRY_RUN) {
    console.log('   [DRY RUN] Would create recursive issue');
    return;
  }

  // Assign to copilot since it's the best at meta-tasks
  const result = gh(
    `issue create --repo ${OWNER}/${REPO_NAME} ` +
    `--title "${title}" ` +
    `--body "${body.replace(/"/g, '\\"')}" ` +
    `--label "agent-task" ` +
    `--assignee "copilot"`
  );

  if (result) {
    console.log(`   ✅ Recursive issue created: ${result}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('🔄 Agent Orchestrator');
  console.log('='.repeat(60));
  console.log(`Repository: ${OWNER}/${REPO_NAME}`);
  console.log(`Agents: copilot, codex, claude`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log('');

  // Get existing issues to avoid duplicates
  const existing = getExistingIssueTitles();
  console.log(`📋 ${existing.size} open issues found`);

  // Discover work
  console.log('\n🔍 Scanning codebase...');
  const allIssues = [
    ...findTodos(),
    ...findMissingTests(),
    ...findDocGaps(),
    ...findCodeImprovements(),
  ];

  console.log(`\n📊 Found ${allIssues.length} potential issues`);

  // Filter duplicates  
  const newIssues = allIssues.filter(i => !existing.has(i.title.toLowerCase()));
  console.log(`📊 ${newIssues.length} new issues (after dedup)`);

  // Cap at 5 issues per run to avoid spam
  const batch = newIssues.slice(0, 5);
  
  if (batch.length === 0) {
    console.log('\n✅ No new issues to create. Codebase looks good!');
  } else {
    console.log(`\n🚀 Creating ${batch.length} issues...\n`);
    
    let created = 0;
    for (const issue of batch) {
      const agent = pickAgent(issue.title, issue.body);
      const ok = await createAndAssignIssue(issue, agent);
      if (ok) created++;
      
      // Small delay between API calls
      await new Promise(r => setTimeout(r, 1000));
    }
    
    console.log(`\n✅ Created ${created}/${batch.length} issues`);
  }

  // Create next orchestrator issue (recursive loop)
  if (process.env.RECURSIVE !== 'false') {
    await createRecursiveIssue();
  }

  console.log('\n' + '='.repeat(60));
  console.log('🏁 Orchestrator complete');
  console.log('='.repeat(60));
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
