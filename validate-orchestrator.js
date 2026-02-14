#!/usr/bin/env node

/**
 * Orchestrator Validation Script
 * 
 * Validates that the orchestrator system is properly configured and ready to run.
 */

const fs = require('fs');
const { execSync } = require('child_process');

console.log('=' .repeat(60));
console.log('Orchestrator System Validation');
console.log('='.repeat(60));
console.log('');

let errors = 0;
let warnings = 0;

// Check 1: Orchestrator script exists
console.log('✓ Checking orchestrator script...');
if (fs.existsSync('.github/scripts/orchestrator.js')) {
  console.log('  ✅ .github/scripts/orchestrator.js exists');
  
  // Validate syntax
  try {
    execSync('node --check .github/scripts/orchestrator.js', { encoding: 'utf-8' });
    console.log('  ✅ Script syntax is valid');
  } catch (e) {
    console.log('  ❌ Script has syntax errors');
    errors++;
  }
} else {
  console.log('  ❌ .github/scripts/orchestrator.js not found');
  errors++;
}
console.log('');

// Check 2: Workflow exists
console.log('✓ Checking workflow configuration...');
if (fs.existsSync('.github/workflows/orchestrator.yml')) {
  console.log('  ✅ .github/workflows/orchestrator.yml exists');
  
  const workflow = fs.readFileSync('.github/workflows/orchestrator.yml', 'utf-8');
  
  if (workflow.includes('issues:')) {
    console.log('  ✅ Workflow triggers on issue events');
  } else {
    console.log('  ❌ Workflow missing issue trigger');
    errors++;
  }
  
  if (workflow.includes('Orchestrator')) {
    console.log('  ✅ Workflow filters for Orchestrator issues');
  } else {
    console.log('  ❌ Workflow missing Orchestrator filter');
    errors++;
  }
  
  if (workflow.includes('agent-task')) {
    console.log('  ✅ Workflow filters for agent-task label');
  } else {
    console.log('  ❌ Workflow missing agent-task filter');
    errors++;
  }
} else {
  console.log('  ❌ .github/workflows/orchestrator.yml not found');
  errors++;
}
console.log('');

// Check 3: Agent profiles exist
console.log('✓ Checking agent profiles...');
const agents = ['backend-engineer', 'frontend-engineer', 'docs-writer', 'test-engineer'];
let agentCount = 0;

for (const agent of agents) {
  if (fs.existsSync(`.github/agents/${agent}.agent.md`)) {
    agentCount++;
  }
}

if (agentCount === agents.length) {
  console.log(`  ✅ All ${agents.length} agent profiles exist`);
} else {
  console.log(`  ⚠️  Only ${agentCount}/${agents.length} agent profiles found`);
  warnings++;
}
console.log('');

// Check 4: Repository structure
console.log('✓ Checking repository structure...');
const requiredDirs = ['apps/server/src', 'apps/web/src', 'docs', '.github'];
let dirCount = 0;

for (const dir of requiredDirs) {
  if (fs.existsSync(dir)) {
    dirCount++;
  }
}

if (dirCount === requiredDirs.length) {
  console.log(`  ✅ All required directories exist`);
} else {
  console.log(`  ❌ Only ${dirCount}/${requiredDirs.length} required directories found`);
  errors++;
}
console.log('');

// Check 5: Scan the codebase (dry run)
console.log('✓ Running orchestrator scan (dry run)...');
try {
  const output = execSync('DRY_RUN=true RECURSIVE=false node .github/scripts/orchestrator.js', {
    encoding: 'utf-8',
    maxBuffer: 5 * 1024 * 1024
  });
  
  if (output.includes('Orchestrator complete')) {
    console.log('  ✅ Orchestrator scan completed successfully');
    
    // Extract findings
    const match = output.match(/Found (\d+) potential issues/);
    if (match) {
      console.log(`  ℹ️  Found ${match[1]} potential issues`);
    }
    
    const createdMatch = output.match(/Created (\d+)\/(\d+) issues/);
    if (createdMatch) {
      console.log(`  ℹ️  Would create ${createdMatch[1]} issues (dry run)`);
    }
  } else {
    console.log('  ⚠️  Orchestrator completed with warnings');
    warnings++;
  }
} catch (e) {
  console.log('  ❌ Orchestrator scan failed');
  console.log(`  Error: ${e.message}`);
  errors++;
}
console.log('');

// Check 6: Documentation
console.log('✓ Checking documentation...');
const docs = [
  'orchestrator-scan-results.md',
  'orchestrator-run-summary.md',
  'ORCHESTRATOR_PROCESS.md'
];

let docCount = 0;
for (const doc of docs) {
  if (fs.existsSync(doc)) {
    docCount++;
  }
}

if (docCount === docs.length) {
  console.log(`  ✅ All orchestrator documentation exists`);
} else {
  console.log(`  ⚠️  Only ${docCount}/${docs.length} docs found`);
  warnings++;
}
console.log('');

// Summary
console.log('='.repeat(60));
console.log('Validation Summary');
console.log('='.repeat(60));

if (errors === 0 && warnings === 0) {
  console.log('✅ All checks passed! System is ready.');
  console.log('');
  console.log('Next steps:');
  console.log('1. Close issue #22 to trigger the orchestrator workflow');
  console.log('2. The workflow will create 3 new issues');
  console.log('3. A new orchestrator issue will be created');
  console.log('4. The recursive loop will continue automatically');
  process.exit(0);
} else {
  if (errors > 0) {
    console.log(`❌ ${errors} error(s) found`);
  }
  if (warnings > 0) {
    console.log(`⚠️  ${warnings} warning(s) found`);
  }
  console.log('');
  console.log('Please fix the issues above before proceeding.');
  process.exit(1);
}
