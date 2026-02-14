#!/usr/bin/env node

/**
 * Agent Executor Script
 * 
 * This script analyzes an issue and autonomously makes code changes.
 * It uses pattern matching, heuristics, and can be extended with AI APIs.
 */

const fs = require('fs');
const path = require('path');

// Environment variables from the workflow
const ISSUE_NUMBER = process.env.ISSUE_NUMBER || '';
const ISSUE_TITLE = process.env.ISSUE_TITLE || '';
const ISSUE_BODY = process.env.ISSUE_BODY || '';
const ISSUE_SCOPE = process.env.ISSUE_SCOPE || '';
const ISSUE_DELIVERABLE = process.env.ISSUE_DELIVERABLE || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// AI-enhanced mode flag
const AI_ENABLED = !!OPENAI_API_KEY;

console.log('🤖 Agent Executor Started');
console.log(`📋 Issue #${ISSUE_NUMBER}: ${ISSUE_TITLE}`);
console.log(`📦 Scope: ${ISSUE_SCOPE}`);
console.log(`🎯 Deliverable: ${ISSUE_DELIVERABLE}`);
console.log(`🧠 Agent Priority: Codex CLI → GitHub Copilot CLI → OpenAI API (strong models only) → Pattern-based`);

/**
 * Task analyzers - pattern match issue content to determine task type
 */
const taskAnalyzers = [
  {
    name: 'documentation',
    pattern: /\b(doc|documentation|readme|guide|tutorial)\b/i,
    handler: handleDocumentationTask
  },
  {
    name: 'new-agent',
    pattern: /\b(add|create|new)\s+(agent|provider)\b/i,
    handler: handleNewAgentTask
  },
  {
    name: 'fix-bug',
    pattern: /\b(fix|bug|error|issue)\b/i,
    handler: handleBugFixTask
  },
  {
    name: 'feature',
    pattern: /\b(feature|implement|add)\b/i,
    handler: handleFeatureTask
  },
  {
    name: 'refactor',
    pattern: /\b(refactor|improve|optimize|clean)\b/i,
    handler: handleRefactorTask
  },
  {
    name: 'test',
    pattern: /\b(test|testing|spec|coverage)\b/i,
    handler: handleTestTask
  },
  {
    name: 'config',
    pattern: /\b(config|configuration|setup|workflow)\b/i,
    handler: handleConfigTask
  }
];

/**
 * Check if Codex CLI is available
 */
function isCodexAvailable() {
  try {
    const { execSync } = require('child_process');
    execSync('which codex', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Check if GitHub Copilot CLI is available
 */
function isGitHubCopilotAvailable() {
  try {
    const { execSync } = require('child_process');
    execSync('which gh', { stdio: 'ignore' });
    execSync('gh copilot --version 2>/dev/null || gh copilot --help', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Try Codex CLI agent
 */
async function tryCodexAgent(issue) {
  if (!isCodexAvailable()) {
    console.log('⏭️  Codex CLI not available');
    return { success: false, reason: 'Codex CLI not installed' };
  }
  
  console.log('🚀 Attempting Codex CLI agent...');
  
  try {
    const { execSync } = require('child_process');
    const result = execSync('node .github/scripts/codex-agent.js', {
      encoding: 'utf-8',
      env: {
        ...process.env,
        ISSUE_NUMBER: issue.number,
        ISSUE_TITLE: issue.title,
        ISSUE_BODY: issue.body,
        ISSUE_SCOPE: issue.scope,
        ISSUE_DELIVERABLE: issue.deliverable
      },
      timeout: 300000 // 5 minutes
    });
    
    console.log('✅ Codex CLI succeeded');
    return { success: true, output: result };
    
  } catch (error) {
    console.log(`❌ Codex CLI failed: ${error.message}`);
    return { success: false, reason: error.message };
  }
}

/**
 * Try GitHub Copilot CLI agent
 */
async function tryGitHubCopilotAgent(issue) {
  if (!isGitHubCopilotAvailable()) {
    console.log('⏭️  GitHub Copilot CLI not available');
    return { success: false, reason: 'GitHub Copilot CLI not installed' };
  }
  
  console.log('🚀 Attempting GitHub Copilot CLI agent...');
  
  try {
    const { execSync } = require('child_process');
    const result = execSync('node .github/scripts/github-copilot-agent.js', {
      encoding: 'utf-8',
      env: {
        ...process.env,
        ISSUE_NUMBER: issue.number,
        ISSUE_TITLE: issue.title,
        ISSUE_BODY: issue.body,
        ISSUE_SCOPE: issue.scope,
        ISSUE_DELIVERABLE: issue.deliverable
      },
      timeout: 300000 // 5 minutes
    });
    
    console.log('✅ GitHub Copilot CLI succeeded');
    return { success: true, output: result };
    
  } catch (error) {
    // Exit code 2 means unavailable, not an error
    if (error.status === 2) {
      console.log('⏭️  GitHub Copilot CLI unavailable');
      return { success: false, reason: 'GitHub Copilot CLI not available' };
    }
    console.log(`❌ GitHub Copilot CLI failed: ${error.message}`);
    return { success: false, reason: error.message };
  }
}

/**
 * AI-powered code generation
 */
async function handleWithAI(issue) {
  if (!AI_ENABLED) {
    return { success: false, reason: 'AI not enabled' };
  }
  
  console.log('🧠 Using AI to generate code changes...');
  
  try {
    // Get codebase context
    const files = getRelevantFiles(issue);
    const contextFiles = files.slice(0, 5).map(f => {
      const content = fs.readFileSync(f, 'utf-8');
      return `File: ${f}\n\`\`\`\n${content.substring(0, 1000)}\n\`\`\``;
    }).join('\n\n');
    
    const prompt = `You are an AI coding agent working on a GitHub repository.

Issue #${issue.number}: ${issue.title}

## Issue Details
${issue.body}

## Scope
${issue.scope}

## Deliverable
${issue.deliverable}

## Codebase Context
${contextFiles}

Generate code changes to address this issue. Respond in JSON format:
{
  "analysis": "brief analysis of what needs to be done",
  "changes": [
    {
      "file": "path/to/file.ts",
      "action": "create|modify",
      "content": "full file content or modification"
    }
  ],
  "explanation": "what was changed and why"
}

Focus on:
1. Creating functional, working code
2. Following existing patterns in the codebase
3. Being conservative - only change what's necessary
4. Adding appropriate comments and types`;

    // Model priority chain: strongest first, fallback to still-strong models
    // NEVER use weaker models (gpt-4, gpt-3.5, claude-3, etc.)
    const MODEL_CHAIN = [
      'gpt-5.3-codex',       // #1 - strongest code model
      'claude-sonnet-4.5',   // #2 - strongest Claude
      'claude-4',            // #3 - fallback strong Claude
      'gpt-5.2-codex',       // #4 - fallback strong Codex
      'gpt-5',               // #5 - fallback strong GPT
    ];
    
    let data = null;
    let lastError = null;
    
    for (const model of MODEL_CHAIN) {
      console.log(`   🔄 Trying model: ${model}...`);
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: 'system', content: 'You are an expert software engineer. Always respond with valid JSON.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.3,
            max_tokens: 4000
          })
        });
        
        if (!response.ok) {
          const error = await response.text();
          console.log(`   ⚠️  Model ${model} failed: ${response.status} - ${error}`);
          lastError = `${model}: ${response.status}`;
          continue; // Try next model
        }
        
        data = await response.json();
        console.log(`   ✅ Model ${model} responded successfully`);
        break; // Success, stop trying
      } catch (fetchError) {
        console.log(`   ⚠️  Model ${model} error: ${fetchError.message}`);
        lastError = `${model}: ${fetchError.message}`;
        continue;
      }
    }
    
    if (!data) {
      console.log(`   ❌ All models failed. Last error: ${lastError}`);
      return { success: false, reason: `All models failed: ${lastError}` };
    }
    const content = data.choices[0].message.content;
    
    // Extract JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('   ❌ Could not parse AI response');
      return { success: false, reason: 'Invalid response format' };
    }
    
    const aiResult = JSON.parse(jsonMatch[0]);
    console.log(`   📋 AI Analysis: ${aiResult.analysis}`);
    
    // Apply changes
    const modifiedFiles = [];
    for (const change of aiResult.changes) {
      const filePath = path.join(process.cwd(), change.file);
      
      if (change.action === 'create') {
        // Create directory if needed
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, change.content);
        console.log(`   ✅ Created: ${change.file}`);
      } else if (change.action === 'modify') {
        fs.writeFileSync(filePath, change.content);
        console.log(`   ✅ Modified: ${change.file}`);
      }
      
      modifiedFiles.push(change.file);
    }
    
    return {
      success: true,
      files: modifiedFiles,
      aiExplanation: aiResult.explanation
    };
    
  } catch (error) {
    console.log(`   ❌ AI handler error: ${error.message}`);
    return { success: false, reason: error.message };
  }
}

/**
 * Get relevant files for context
 */
function getRelevantFiles(issue) {
  const keywords = [
    ...issue.title.toLowerCase().split(/\s+/),
    ...issue.body.toLowerCase().split(/\s+/)
  ];
  
  // Find TypeScript/JavaScript files that might be relevant
  const allFiles = [];
  const searchDirs = ['apps/server/src', 'apps/web/src', 'docs'];
  
  for (const dir of searchDirs) {
    const dirPath = path.join(process.cwd(), dir);
    if (fs.existsSync(dirPath)) {
      findFilesRecursive(dirPath, allFiles);
    }
  }
  
  // Score files by relevance
  const scoredFiles = allFiles.map(file => {
    let score = 0;
    const fileName = file.toLowerCase();
    
    for (const keyword of keywords) {
      if (keyword.length < 3) continue;
      if (fileName.includes(keyword)) {
        score += 5;
      }
      
      try {
        const content = fs.readFileSync(file, 'utf-8').toLowerCase();
        if (content.includes(keyword)) {
          score += 1;
        }
      } catch (e) {
        // Skip files we can't read
      }
    }
    
    return { file, score };
  });
  
  return scoredFiles
    .filter(f => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(f => f.file);
}

/**
 * Helper to find files recursively
 */
function findFilesRecursive(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory() && !entry.name.includes('node_modules') && !entry.name.includes('dist')) {
      findFilesRecursive(fullPath, files);
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx|md)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  
  return files;
}

/**
 * Analyze issue and execute appropriate handler
 */
async function main() {
  try {
    const issue = {
      number: ISSUE_NUMBER,
      title: ISSUE_TITLE,
      body: ISSUE_BODY,
      scope: ISSUE_SCOPE,
      deliverable: ISSUE_DELIVERABLE
    };
    
    // PRIORITY 1: Try Codex CLI first (best integration)
    console.log('🔄 Agent Priority Order:');
    console.log('   1. Codex CLI (primary)');
    console.log('   2. GitHub Copilot CLI (GPT-5 / Claude Sonnet 4.5)');
    console.log('   3. OpenAI API (gpt-5.3-codex / claude-sonnet-4.5 only)');
    console.log('   4. Pattern-based handlers');
    console.log('');
    
    const codexResult = await tryCodexAgent(issue);
    if (codexResult.success) {
      console.log('✅ Codex CLI completed task successfully');
      return;
    }
    
    // PRIORITY 2: Try GitHub Copilot CLI (native GitHub integration)
    console.log('🧠 Codex CLI unavailable, trying GitHub Copilot CLI...');
    const copilotResult = await tryGitHubCopilotAgent(issue);
    if (copilotResult.success) {
      console.log('✅ GitHub Copilot CLI completed task successfully');
      return;
    }
    
    // PRIORITY 3: Try AI-powered handling with strong models only
    if (AI_ENABLED) {
      console.log('🧠 GitHub Copilot unavailable, trying OpenAI API (strong models only)...');
      const aiResult = await handleWithAI(issue);
      
      if (aiResult.success) {
        console.log('✅ OpenAI API (strong model) successfully generated code');
        if (aiResult.files) {
          console.log(`📝 Modified files: ${aiResult.files.join(', ')}`);
        }
        if (aiResult.aiExplanation) {
          console.log(`💡 Explanation: ${aiResult.aiExplanation}`);
        }
        return;
      }
      
      console.log('⚠️  OpenAI API failed, falling back to pattern-based handlers...');
    }
    
    // PRIORITY 4: Fall back to pattern-based handlers
    console.log('🔧 Using pattern-based handlers...');
    const issueContent = `${ISSUE_TITLE} ${ISSUE_BODY}`.toLowerCase();
    
    // Find matching task type
    let taskType = null;
    for (const analyzer of taskAnalyzers) {
      if (analyzer.pattern.test(issueContent)) {
        taskType = analyzer;
        break;
      }
    }
    
    if (!taskType) {
      console.log('⚠️  Could not determine task type, using generic handler');
      taskType = { name: 'generic', handler: handleGenericTask };
    }
    
    console.log(`🔍 Detected task type: ${taskType.name}`);
    
    // Execute handler
    const result = await taskType.handler(issue);
    
    if (result.success) {
      console.log('✅ Task completed successfully');
      if (result.files) {
        console.log(`📝 Modified files: ${result.files.join(', ')}`);
      }
    } else {
      console.log('❌ Task could not be completed');
      console.log(`   Reason: ${result.reason}`);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('💥 Agent executor error:', error);
    process.exit(1);
  }
}

/**
 * Task Handlers
 */

function handleDocumentationTask(issue) {
  console.log('📚 Handling documentation task...');
  
  // Check if it's about adding/updating specific docs
  const docPatterns = {
    readme: /readme/i,
    contributing: /contribut/i,
    setup: /setup|install/i,
    api: /api.*doc/i,
    guide: /guide|tutorial/i
  };
  
  let docType = 'general';
  for (const [type, pattern] of Object.entries(docPatterns)) {
    if (pattern.test(issue.title + ' ' + issue.body)) {
      docType = type;
      break;
    }
  }
  
  console.log(`   Document type: ${docType}`);
  
  // Generate appropriate documentation
  switch (docType) {
    case 'readme':
      return updateReadme(issue);
    case 'contributing':
      return updateContributing(issue);
    case 'setup':
      return createSetupGuide(issue);
    case 'api':
      return createApiDocs(issue);
    default:
      return createGeneralDoc(issue);
  }
}

function handleNewAgentTask(issue) {
  console.log('🤖 Handling new agent creation task...');
  
  // Extract agent name from issue
  const nameMatch = issue.title.match(/(?:add|create|new)\s+(\w+)\s+agent/i);
  const agentName = nameMatch ? nameMatch[1].toLowerCase() : 'custom';
  
  console.log(`   Agent name: ${agentName}`);
  
  // Create agent file
  const agentTemplate = `import { BaseAgent } from "../agent-base.js";
import { AgentContext } from "../types.js";

export class ${capitalize(agentName)}Agent extends BaseAgent {
  name = "${agentName}-agent";
  intervalMs = 3600000; // 1 hour

  async run(ctx: AgentContext): Promise<void> {
    ctx.emit({
      type: "notification",
      payload: {
        source: this.name,
        title: "${capitalize(agentName)} check",
        message: "Agent is running",
        priority: "low"
      }
    });

    // TODO: Implement ${agentName} agent logic
    // Add your agent implementation here
  }
}
`;

  const agentPath = path.join(process.cwd(), 'apps/server/src/agents', `${agentName}-agent.ts`);
  fs.writeFileSync(agentPath, agentTemplate);
  
  // Update orchestrator to include new agent
  const orchestratorPath = path.join(process.cwd(), 'apps/server/src/orchestrator.ts');
  let orchestratorContent = fs.readFileSync(orchestratorPath, 'utf-8');
  
  // Add import
  const importLine = `import { ${capitalize(agentName)}Agent } from "./agents/${agentName}-agent.js";`;
  orchestratorContent = orchestratorContent.replace(
    /(import.*from.*agents.*;\n)/g,
    `$1${importLine}\n`
  );
  
  // Add to agents array
  orchestratorContent = orchestratorContent.replace(
    /(new VideoEditorAgent\(\))/,
    `$1,\n    new ${capitalize(agentName)}Agent()`
  );
  
  fs.writeFileSync(orchestratorPath, orchestratorContent);
  
  return {
    success: true,
    files: [agentPath, orchestratorPath]
  };
}

function handleBugFixTask(issue) {
  console.log('🐛 Handling bug fix task...');
  
  // For bug fixes, we need more context - create a placeholder fix
  // In production, this would call an AI API to analyze and fix the bug
  
  const fixDoc = path.join(process.cwd(), 'docs', `bugfix-${issue.number}.md`);
  const content = `# Bug Fix: ${issue.title}

## Issue
${issue.body}

## Analysis
This bug requires manual analysis and fixing.

## Status
Pending investigation

## Related Files
To be determined

Created by agent executor for issue #${issue.number}
`;
  
  fs.writeFileSync(fixDoc, content);
  
  return {
    success: true,
    files: [fixDoc],
    reason: 'Created bug fix documentation (manual fix required)'
  };
}

function handleFeatureTask(issue) {
  console.log('✨ Handling feature task...');
  
  // Create feature specification document
  const featureDoc = path.join(process.cwd(), 'docs', `feature-${issue.number}.md`);
  const content = `# Feature: ${issue.title}

## Overview
${issue.scope || 'Feature scope to be defined'}

## Deliverable
${issue.deliverable || 'Feature deliverable to be defined'}

## Implementation Plan
1. Analyze requirements
2. Design solution
3. Implement changes
4. Test functionality
5. Document usage

## Status
📋 Planning phase

Created by agent executor for issue #${issue.number}
`;
  
  fs.writeFileSync(featureDoc, content);
  
  return {
    success: true,
    files: [featureDoc]
  };
}

function handleRefactorTask(issue) {
  console.log('🔨 Handling refactor task...');
  
  // Create refactor plan document
  const refactorDoc = path.join(process.cwd(), 'docs', `refactor-${issue.number}.md`);
  const content = `# Refactor: ${issue.title}

## Current State
${issue.scope || 'Current implementation details'}

## Proposed Changes
${issue.deliverable || 'Refactor goals and approach'}

## Refactor Plan
1. Identify affected code
2. Write tests for current behavior
3. Refactor incrementally
4. Verify tests still pass
5. Update documentation

## Status
📋 Planning phase

Created by agent executor for issue #${issue.number}
`;
  
  fs.writeFileSync(refactorDoc, content);
  
  return {
    success: true,
    files: [refactorDoc]
  };
}

function handleTestTask(issue) {
  console.log('🧪 Handling test task...');
  
  // Create test plan document
  const testDoc = path.join(process.cwd(), 'docs', `test-plan-${issue.number}.md`);
  const content = `# Test Plan: ${issue.title}

## Test Scope
${issue.scope || 'Test coverage requirements'}

## Test Cases
${issue.deliverable || 'Test cases to be defined'}

## Test Strategy
1. Unit tests
2. Integration tests
3. End-to-end tests
4. Performance tests (if applicable)

## Status
📋 Planning phase

Created by agent executor for issue #${issue.number}
`;
  
  fs.writeFileSync(testDoc, content);
  
  return {
    success: true,
    files: [testDoc]
  };
}

function handleConfigTask(issue) {
  console.log('⚙️  Handling configuration task...');
  
  // Create config documentation
  const configDoc = path.join(process.cwd(), 'docs', `config-${issue.number}.md`);
  const content = `# Configuration: ${issue.title}

## Configuration Scope
${issue.scope || 'Configuration details'}

## Changes Required
${issue.deliverable || 'Configuration changes to be implemented'}

## Implementation Steps
1. Identify configuration files
2. Update configuration
3. Document changes
4. Test configuration
5. Update setup guide

## Status
📋 Planning phase

Created by agent executor for issue #${issue.number}
`;
  
  fs.writeFileSync(configDoc, content);
  
  return {
    success: true,
    files: [configDoc]
  };
}

function handleGenericTask(issue) {
  console.log('📝 Handling generic task...');
  
  // Create task tracking document
  const taskDoc = path.join(process.cwd(), 'docs', `task-${issue.number}.md`);
  const content = `# Task: ${issue.title}

## Description
${issue.body}

## Scope
${issue.scope || 'Task scope to be defined'}

## Deliverable
${issue.deliverable || 'Task deliverable to be defined'}

## Status
📋 Queued for manual implementation

Created by agent executor for issue #${issue.number}
`;
  
  fs.writeFileSync(taskDoc, content);
  
  return {
    success: true,
    files: [taskDoc]
  };
}

/**
 * Helper functions for specific documentation updates
 */

function updateReadme(issue) {
  const readmePath = path.join(process.cwd(), 'README.md');
  let content = fs.readFileSync(readmePath, 'utf-8');
  
  // Add a new section about the agent loop if not present
  if (!content.includes('## Agent Loop')) {
    content += `\n\n## Agent Loop

This project uses an autonomous agent loop for continuous development:

- Agents check for open issues every 15 minutes
- Tasks with \`agent-task\` label are automatically picked up
- Agents analyze issues and make appropriate code changes
- Changes are automatically merged if checks pass

See [\`.github/workflows/agent-orchestrator.yml\`](.github/workflows/agent-orchestrator.yml) for details.
`;
    
    fs.writeFileSync(readmePath, content);
    return { success: true, files: [readmePath] };
  }
  
  return { success: false, reason: 'README already contains agent loop information' };
}

function updateContributing(issue) {
  const contributingPath = path.join(process.cwd(), 'CONTRIBUTING.md');
  
  if (!fs.existsSync(contributingPath)) {
    return { success: false, reason: 'CONTRIBUTING.md does not exist' };
  }
  
  let content = fs.readFileSync(contributingPath, 'utf-8');
  
  // Add agent workflow section if not present
  if (!content.includes('## Agent Workflow')) {
    content += `\n\n## Agent Workflow

### Autonomous Development Loop

This repository uses automated agents for continuous development:

1. Create issues with the \`agent-task\` label
2. Agents automatically pick up and work on issues
3. PRs are created and merged automatically
4. The loop continues indefinitely

### Manual Contributions

You can still contribute manually:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a PR
5. Wait for review and merge
`;
    
    fs.writeFileSync(contributingPath, content);
    return { success: true, files: [contributingPath] };
  }
  
  return { success: false, reason: 'CONTRIBUTING.md already documents agent workflow' };
}

function createSetupGuide(issue) {
  const setupPath = path.join(process.cwd(), 'docs', 'SETUP.md');
  
  // Check if it already exists (it does from earlier work)
  if (fs.existsSync(setupPath)) {
    return { success: false, reason: 'Setup guide already exists' };
  }
  
  return { success: false, reason: 'Setup guide creation not implemented' };
}

function createApiDocs(issue) {
  const apiDocsPath = path.join(process.cwd(), 'docs', 'API.md');
  
  const content = `# API Documentation

## Overview
Documentation for the Companion API.

## Endpoints

### \`/api/status\`
Returns the current status of all agents.

### \`/api/notifications\`
Returns recent notifications from agents.

### \`/api/summary\`
Returns a summary of agent activities.

## WebSocket Events

### \`status-update\`
Emitted when agent status changes.

### \`notification\`
Emitted when a new notification is created.

---

*This is a generated API documentation. Please update with actual endpoint implementations.*
`;
  
  fs.writeFileSync(apiDocsPath, content);
  return { success: true, files: [apiDocsPath] };
}

function createGeneralDoc(issue) {
  const docPath = path.join(process.cwd(), 'docs', `${slugify(issue.title)}.md`);
  
  const content = `# ${issue.title}

${issue.body}

## Overview
${issue.scope || 'Documentation content to be defined'}

## Details
${issue.deliverable || 'Details to be added'}

---

Created by agent executor for issue #${issue.number}
`;
  
  fs.writeFileSync(docPath, content);
  return { success: true, files: [docPath] };
}

/**
 * Utility functions
 */

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Run the agent
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
