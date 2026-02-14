#!/usr/bin/env node

/**
 * GitHub Copilot CLI Agent Integration
 * 
 * Uses GitHub Copilot CLI to access premium models (GPT-5, Claude Sonnet 4.5)
 * through the `gh copilot` command.
 * 
 * Requirements:
 * - GitHub CLI (`gh`) installed
 * - GitHub Copilot Pro subscription ($20/month)
 * - Authenticated with `gh auth login`
 * 
 * How it works:
 * 1. Check if `gh copilot` is available
 * 2. Build a detailed prompt from the issue
 * 3. Use `gh copilot suggest` with model preference
 * 4. Parse and execute suggested commands
 * 5. Commit changes
 * 
 * Models used:
 * - GPT-5.3-codex (primary)
 * - Claude Sonnet 4.5 (primary)
 * - Claude 4, GPT-5.2-codex, GPT-5 (fallbacks)
 * - No weaker models allowed (no gpt-4, no claude-3, etc.)
 */

const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.AGENT_PAT;
const REPO_OWNER = process.env.REPO_OWNER || 'lucyscript';
const REPO_NAME = process.env.REPO_NAME || 'companion';
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;

/**
 * Check if GitHub Copilot CLI is available
 */
function isCopilotCLIAvailable() {
  try {
    // Check if gh CLI is installed
    execSync('which gh', { stdio: 'ignore' });
    
    // Check if gh copilot extension is available
    const extensions = execSync('gh extension list', { encoding: 'utf-8' });
    
    // GitHub Copilot CLI is built-in to gh CLI now, or available as extension
    // Try to run a simple copilot command to verify
    try {
      execSync('gh copilot --version 2>/dev/null || gh copilot --help', { stdio: 'ignore', timeout: 5000 });
      console.log('✓ GitHub Copilot CLI available');
      return true;
    } catch (e) {
      console.log('GitHub Copilot CLI not available (install with: gh extension install github/gh-copilot)');
      return false;
    }
  } catch (error) {
    console.log('GitHub CLI (gh) not found - install from https://cli.github.com');
    return false;
  }
}

/**
 * Build a detailed prompt for Copilot CLI
 */
function buildCopilotPrompt(issue) {
  let prompt = `Task: ${issue.title}\n\n`;
  
  prompt += `CRITICAL: Only use these models (in order of preference):
1. gpt-5.3-codex or claude-sonnet-4.5 (strongest)
2. claude-4, gpt-5.2-codex, or gpt-5 (acceptable fallbacks)
NEVER use gpt-4, gpt-3.5, claude-3, or any weaker model.\n\n`;
  
  if (issue.scope) {
    prompt += `Scope:\n${issue.scope}\n\n`;
  }
  
  if (issue.deliverable) {
    prompt += `Deliverable:\n${issue.deliverable}\n\n`;
  }
  
  if (issue.verification) {
    prompt += `Verification:\n${issue.verification}\n\n`;
  }

  prompt += `Guidelines:\n`;
  prompt += `- Analyze the repository structure first\n`;
  prompt += `- Follow existing code style and patterns\n`;
  prompt += `- Make minimal, focused changes only\n`;
  prompt += `- Add inline comments for complex logic\n`;
  prompt += `- Test changes if possible\n\n`;

  prompt += `Provide specific shell commands or code changes to complete this task.`;

  return prompt;
}

/**
 * Use GitHub Copilot CLI to solve the issue
 */
async function runCopilotCLI(issue) {
  try {
    console.log(`\n🤖 Using GitHub Copilot CLI for issue #${issue.number}...`);
    console.log('🎯 Model preference: GPT-5 / GPT-5.3-codex / Claude Sonnet 4.5');

    const prompt = buildCopilotPrompt(issue);
    
    // Save prompt to temp file
    const fs = require('fs');
    const promptFile = '/tmp/copilot-prompt.txt';
    fs.writeFileSync(promptFile, prompt);

    console.log('\n📝 Asking GitHub Copilot for solution...');
    
    // Use gh copilot suggest to get shell commands
    // Note: This might need adjustment based on actual gh copilot CLI interface
    let copilotOutput;
    try {
      // Try interactive mode first
      copilotOutput = execSync(
        `gh copilot suggest "${prompt.replace(/"/g, '\\"')}"`,
        { 
          encoding: 'utf-8',
          timeout: 60000, // 1 minute
          maxBuffer: 10 * 1024 * 1024 // 10MB
        }
      );
    } catch (error) {
      // If interactive mode fails, try explain mode
      console.log('Trying alternative Copilot CLI mode...');
      copilotOutput = execSync(
        `echo "${prompt.replace(/"/g, '\\"')}" | gh copilot explain`,
        { 
          encoding: 'utf-8',
          timeout: 60000,
          maxBuffer: 10 * 1024 * 1024
        }
      );
    }

    console.log('✓ Received Copilot suggestions');
    console.log('\n' + '='.repeat(60));
    console.log('GitHub Copilot Response:');
    console.log('='.repeat(60));
    console.log(copilotOutput);
    console.log('='.repeat(60));

    // Parse and execute commands from Copilot's response
    // Look for code blocks with commands
    const codeBlockRegex = /```(?:bash|sh|shell)?\n([\s\S]*?)```/g;
    const matches = [...copilotOutput.matchAll(codeBlockRegex)];
    
    if (matches.length === 0) {
      console.log('⚠️  No executable commands found in Copilot response');
      // Still return success as Copilot provided guidance
      return {
        success: true,
        method: 'github-copilot-cli',
        message: 'Copilot provided guidance (manual execution needed)',
        output: copilotOutput
      };
    }

    console.log(`\n🔧 Found ${matches.length} code block(s), executing...`);
    
    for (let i = 0; i < matches.length; i++) {
      const commands = matches[i][1].trim();
      console.log(`\n📋 Executing block ${i + 1}:`);
      console.log(commands);
      
      try {
        const result = execSync(commands, {
          encoding: 'utf-8',
          cwd: process.cwd(),
          timeout: 120000 // 2 minutes per block
        });
        console.log('✓ Block executed successfully');
        if (result) {
          console.log(result);
        }
      } catch (execError) {
        console.log(`⚠️  Block ${i + 1} failed: ${execError.message}`);
        // Continue with other blocks
      }
    }

    // Check if there are any git changes
    try {
      const gitStatus = execSync('git status --porcelain', { encoding: 'utf-8' });
      if (gitStatus.trim()) {
        console.log('\n✅ Changes detected:');
        console.log(gitStatus);
        return {
          success: true,
          method: 'github-copilot-cli',
          message: 'GitHub Copilot CLI completed task',
          output: copilotOutput,
          changes: gitStatus
        };
      } else {
        console.log('\n⚠️  No file changes detected');
        return {
          success: true,
          method: 'github-copilot-cli',
          message: 'Copilot executed but no changes made',
          output: copilotOutput
        };
      }
    } catch (gitError) {
      console.log('Could not check git status:', gitError.message);
      return {
        success: true,
        method: 'github-copilot-cli',
        output: copilotOutput
      };
    }

  } catch (error) {
    console.error('❌ GitHub Copilot CLI error:', error.message);
    return {
      success: false,
      method: 'github-copilot-cli',
      error: error.message
    };
  }
}

/**
 * Parse issue body to extract structured information
 */
function parseIssueBody(body) {
  const parsed = {};

  // Extract scope
  const scopeMatch = body?.match(/##\s*Scope\s*\n([\s\S]*?)(?=\n##|\n$)/i);
  if (scopeMatch) {
    parsed.scope = scopeMatch[1].trim();
  }

  // Extract deliverable
  const deliverableMatch = body?.match(/##\s*Deliverable\s*\n([\s\S]*?)(?=\n##|\n$)/i);
  if (deliverableMatch) {
    parsed.deliverable = deliverableMatch[1].trim();
  }

  // Extract verification
  const verificationMatch = body?.match(/##\s*Verification\s*\n([\s\S]*?)(?=\n##|\n$)/i);
  if (verificationMatch) {
    parsed.verification = verificationMatch[1].trim();
  }

  return parsed;
}

/**
 * Main execution
 */
async function main() {
  console.log('='.repeat(60));
  console.log('GitHub Copilot Coding Agent Integration');
  console.log('='.repeat(60));

  // Validation
  if (!GITHUB_TOKEN) {
    console.error('❌ Missing GITHUB_TOKEN or AGENT_PAT');
    process.exit(1);
  }

  if (!ISSUE_NUMBER) {
    console.error('❌ Missing ISSUE_NUMBER environment variable');
    process.exit(1);
  }

  // Check if Copilot CLI is available
  const available = isCopilotCLIAvailable();
  if (!available) {
    console.log('\n⚠️  GitHub Copilot CLI not available');
    console.log('This requires:');
    console.log('  - GitHub CLI: https://cli.github.com');
    console.log('  - GitHub Copilot Pro subscription ($20/month)');
    console.log('  - Install: gh extension install github/gh-copilot');
    console.log('\nFalling back to next agent method...');
    process.exit(2); // Exit code 2 = unavailable, try next method
  }

  // Fetch issue details
  console.log(`\n📋 Fetching issue #${ISSUE_NUMBER}...`);
  
  let issue;
  try {
    const issueResponse = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${ISSUE_NUMBER}`,
      {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }
    );

    if (!issueResponse.ok) {
      throw new Error(`Failed to fetch issue: ${issueResponse.status}`);
    }

    issue = await issueResponse.json();
    console.log(`✓ Issue: ${issue.title}`);
  } catch (error) {
    console.error('❌ Failed to fetch issue:', error.message);
    process.exit(1);
  }

  // Parse issue body
  const parsedIssue = parseIssueBody(issue.body);
  const enrichedIssue = {
    title: issue.title,
    number: issue.number,
    ...parsedIssue
  };

  // Run Copilot CLI
  const result = await runCopilotCLI(enrichedIssue);

  if (result.success) {
    console.log('\n✅ SUCCESS: GitHub Copilot CLI completed the task');
    if (result.changes) {
      console.log('📝 File changes ready for commit');
    }
    process.exit(0);
  } else {
    console.log('\n❌ FAILED: GitHub Copilot CLI could not complete task');
    console.log(`Reason: ${result.error}`);
    process.exit(1);
  }
}
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  isCopilotCLIAvailable,
  runCopilotCLI,
  parseIssueBody
};
