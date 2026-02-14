#!/usr/bin/env node

/**
 * Issue Discovery Agent
 * 
 * Analyzes the codebase to find gaps, TODOs, and improvement opportunities.
 * Creates GitHub issues for discovered work.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER || 'lucyscript';
const REPO_NAME = process.env.REPO_NAME || 'companion';

console.log('🔍 Issue Discovery Agent Started');

/**
 * Analysis categories
 */
const analysisCategories = [
  'missing-tests',
  'documentation-gaps',
  'code-quality',
  'missing-features',
  'technical-debt',
  'security-improvements',
  'performance-optimizations',
  'accessibility'
];

/**
 * Scan for TODO/FIXME comments
 */
function scanForTodos() {
  console.log('📝 Scanning for TODO/FIXME comments...');
  
  try {
    const output = execSync(
      'git grep -n -E "(TODO|FIXME|XXX|HACK|NOTE):" -- "*.ts" "*.tsx" "*.js" "*.jsx" "*.md" || true',
      { encoding: 'utf-8', cwd: process.cwd() }
    );
    
    const todos = [];
    const lines = output.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      const match = line.match(/^([^:]+):(\d+):(.*)$/);
      if (match) {
        const [, file, lineNum, content] = match;
        const todoMatch = content.match(/(TODO|FIXME|XXX|HACK|NOTE):\s*(.+)/);
        if (todoMatch) {
          todos.push({
            file,
            line: parseInt(lineNum),
            type: todoMatch[1],
            message: todoMatch[2].trim()
          });
        }
      }
    }
    
    console.log(`   Found ${todos.length} TODO items`);
    return todos;
  } catch (error) {
    console.log('   No TODOs found or error scanning');
    return [];
  }
}

/**
 * Analyze test coverage
 */
function analyzeTestCoverage() {
  console.log('🧪 Analyzing test coverage...');
  
  const gaps = [];
  const srcDirs = ['apps/server/src', 'apps/web/src'];
  
  for (const srcDir of srcDirs) {
    const srcPath = path.join(process.cwd(), srcDir);
    if (!fs.existsSync(srcPath)) continue;
    
    // Find all source files
    const sourceFiles = findFiles(srcPath, /\.(ts|tsx|js|jsx)$/);
    
    for (const file of sourceFiles) {
      // Skip test files themselves
      if (file.match(/\.(test|spec)\.(ts|tsx|js|jsx)$/)) continue;
      
      // Check if corresponding test file exists
      const testPatterns = [
        file.replace(/\.(ts|tsx|js|jsx)$/, '.test.$1'),
        file.replace(/\.(ts|tsx|js|jsx)$/, '.spec.$1'),
        file.replace(/src\//, 'src/__tests__/').replace(/\.(ts|tsx|js|jsx)$/, '.test.$1')
      ];
      
      const hasTest = testPatterns.some(pattern => fs.existsSync(pattern));
      
      if (!hasTest && !file.includes('types.ts') && !file.includes('config.ts')) {
        gaps.push({
          file: file.replace(process.cwd() + '/', ''),
          reason: 'Missing test file'
        });
      }
    }
  }
  
  console.log(`   Found ${gaps.length} files without tests`);
  return gaps;
}

/**
 * Analyze documentation
 */
function analyzeDocumentation() {
  console.log('📚 Analyzing documentation...');
  
  const gaps = [];
  
  // Check for common documentation files
  const recommendedDocs = [
    { file: 'README.md', exists: fs.existsSync('README.md') },
    { file: 'CONTRIBUTING.md', exists: fs.existsSync('CONTRIBUTING.md') },
    { file: 'LICENSE', exists: fs.existsSync('LICENSE') },
    { file: 'docs/API.md', exists: fs.existsSync('docs/API.md') },
    { file: 'docs/ARCHITECTURE.md', exists: fs.existsSync('docs/ARCHITECTURE.md') },
    { file: 'docs/DEPLOYMENT.md', exists: fs.existsSync('docs/DEPLOYMENT.md') }
  ];
  
  for (const doc of recommendedDocs) {
    if (!doc.exists) {
      gaps.push({
        file: doc.file,
        reason: 'Missing recommended documentation'
      });
    }
  }
  
  // Check if source files have JSDoc comments
  const srcFiles = findFiles('apps/server/src', /\.ts$/);
  let undocumentedFunctions = 0;
  
  for (const file of srcFiles.slice(0, 10)) { // Sample first 10 files
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const functionMatches = content.match(/export (async )?function [a-zA-Z]/g) || [];
      const jsDocMatches = content.match(/\/\*\*/g) || [];
      
      if (functionMatches.length > jsDocMatches.length) {
        undocumentedFunctions += functionMatches.length - jsDocMatches.length;
      }
    } catch (error) {
      // Skip files with read errors
    }
  }
  
  if (undocumentedFunctions > 0) {
    gaps.push({
      file: 'multiple',
      reason: `~${undocumentedFunctions} functions missing JSDoc comments`
    });
  }
  
  console.log(`   Found ${gaps.length} documentation gaps`);
  return gaps;
}

/**
 * Analyze package.json for missing scripts
 */
function analyzePackageScripts() {
  console.log('📦 Analyzing package.json...');
  
  const gaps = [];
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    return gaps;
  }
  
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const scripts = pkg.scripts || {};
  
  const recommendedScripts = [
    { name: 'test', description: 'Run tests' },
    { name: 'lint', description: 'Lint code' },
    { name: 'format', description: 'Format code' },
    { name: 'build', description: 'Build project' },
    { name: 'typecheck', description: 'Type check' },
    { name: 'clean', description: 'Clean build artifacts' }
  ];
  
  for (const script of recommendedScripts) {
    if (!scripts[script.name]) {
      gaps.push({
        script: script.name,
        reason: `Missing ${script.description} script`
      });
    }
  }
  
  console.log(`   Found ${gaps.length} missing scripts`);
  return gaps;
}

/**
 * Use OpenAI to analyze codebase
 */
async function analyzeWithAI() {
  if (!OPENAI_API_KEY) {
    console.log('⚠️  OPENAI_API_KEY not set, skipping AI analysis');
    return [];
  }
  
  console.log('🤖 Analyzing codebase with AI...');
  
  try {
    // Get codebase structure
    const structure = getCodebaseStructure();
    
    // Get recent changes
    const recentChanges = getRecentChanges();
    
    // Get existing issues
    const existingIssues = await getExistingIssues();
    
    const prompt = `Analyze this codebase and suggest 3-5 high-priority improvements.

Codebase structure:
${structure}

Recent changes:
${recentChanges}

Existing issues (don't duplicate):
${existingIssues.map(i => `- ${i.title}`).join('\n')}

Suggest issues in this JSON format:
[
  {
    "title": "concise title",
    "body": "## Scope\\nWhat needs to be done\\n\\n## Deliverable\\nSpecific outcome\\n\\n## Verification\\nHow to verify",
    "priority": "high|medium|low",
    "category": "feature|bug|refactor|docs|test"
  }
]

Focus on:
1. Missing critical features for a companion app
2. Code quality improvements
3. Testing gaps
4. Documentation needs
5. Performance optimizations`;

    // Model fallback chain: strong models only
    const MODEL_CHAIN = [
      'gpt-5.3-codex',
      'claude-sonnet-4.5',
      'claude-4',
      'gpt-5.2-codex',
      'gpt-5'
    ];
    
    let response = null;
    for (const model of MODEL_CHAIN) {
      console.log(`   🔄 Trying model: ${model}...`);
      try {
        response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: 'system', content: 'You are a senior software architect analyzing a codebase.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 2000
          })
        });
        
        if (response.ok) {
          console.log(`   ✅ Model ${model} responded`);
          break;
        }
        console.log(`   ⚠️  Model ${model} failed: ${response.status}`);
      } catch (err) {
        console.log(`   ⚠️  Model ${model} error: ${err.message}`);
      }
    }
    
    if (!response || !response.ok) {
      console.log(`   All models failed`);
      return [];
    }
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Extract JSON from response
    const jsonMatch = content.match(/\[\s*{[\s\S]*}\s*\]/);
    if (!jsonMatch) {
      console.log('   Could not parse AI response');
      return [];
    }
    
    const suggestions = JSON.parse(jsonMatch[0]);
    console.log(`   AI suggested ${suggestions.length} improvements`);
    return suggestions;
    
  } catch (error) {
    console.log(`   AI analysis error: ${error.message}`);
    return [];
  }
}

/**
 * Get codebase structure
 */
function getCodebaseStructure() {
  try {
    const output = execSync('find . -type f -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" | head -50', {
      encoding: 'utf-8',
      cwd: process.cwd()
    });
    
    return output.split('\n').slice(0, 30).join('\n');
  } catch (error) {
    return 'Could not determine structure';
  }
}

/**
 * Get recent git changes
 */
function getRecentChanges() {
  try {
    const output = execSync('git log --oneline -10', {
      encoding: 'utf-8',
      cwd: process.cwd()
    });
    return output;
  } catch (error) {
    return 'No recent changes';
  }
}

/**
 * Get existing GitHub issues
 */
async function getExistingIssues() {
  if (!GITHUB_TOKEN) {
    return [];
  }
  
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues?state=open&per_page=50`,
      {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );
    
    if (!response.ok) {
      return [];
    }
    
    const issues = await response.json();
    return issues.map(issue => ({
      number: issue.number,
      title: issue.title,
      labels: issue.labels.map(l => l.name)
    }));
  } catch (error) {
    return [];
  }
}

/**
 * Create GitHub issue
 */
async function createIssue(issue) {
  if (!GITHUB_TOKEN) {
    console.log(`   ⚠️  Would create: ${issue.title}`);
    return false;
  }
  
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: issue.title,
          body: issue.body,
          labels: issue.labels || ['agent-task']
        })
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      console.log(`   ❌ Failed to create issue: ${error}`);
      return false;
    }
    
    const created = await response.json();
    console.log(`   ✅ Created issue #${created.number}: ${issue.title}`);
    return true;
  } catch (error) {
    console.log(`   ❌ Error creating issue: ${error.message}`);
    return false;
  }
}

/**
 * Helper: Find files recursively
 */
function findFiles(dir, pattern, files = []) {
  if (!fs.existsSync(dir)) return files;
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory() && !entry.name.includes('node_modules') && !entry.name.includes('dist')) {
      findFiles(fullPath, pattern, files);
    } else if (entry.isFile() && pattern.test(entry.name)) {
      files.push(fullPath);
    }
  }
  
  return files;
}

/**
 * Main execution
 */
async function main() {
  try {
    const discoveries = [];
    
    // Scan for TODOs
    const todos = scanForTodos();
    if (todos.length > 0 && todos.length <= 10) {
      // Create individual issues for TODOs
      for (const todo of todos.slice(0, 5)) { // Limit to 5
        discoveries.push({
          title: `[TODO] ${todo.message.substring(0, 60)}`,
          body: `## Scope
Address TODO comment in codebase

## Location
\`${todo.file}:${todo.line}\`

\`\`\`
${todo.message}
\`\`\`

## Deliverable
Complete the TODO item and remove the comment

## Verification
TODO comment removed and functionality implemented`,
          labels: ['agent-task', 'todo']
        });
      }
    } else if (todos.length > 10) {
      // Create aggregate issue
      discoveries.push({
        title: `Address ${todos.length} TODO items in codebase`,
        body: `## Scope
Clean up TODO/FIXME comments throughout the codebase

## Details
Found ${todos.length} TODO items:
${todos.slice(0, 10).map(t => `- \`${t.file}:${t.line}\` - ${t.message.substring(0, 60)}`).join('\n')}
${todos.length > 10 ? `\n... and ${todos.length - 10} more` : ''}

## Deliverable
Address or remove TODO comments

## Verification
Run: \`git grep -n "TODO:" | wc -l\` should show reduced count`,
        labels: ['agent-task', 'cleanup']
      });
    }
    
    // Test coverage
    const testGaps = analyzeTestCoverage();
    if (testGaps.length > 3) {
      discoveries.push({
        title: `Add tests for ${testGaps.length} untested files`,
        body: `## Scope
Add test coverage for files without tests

## Files Missing Tests
${testGaps.slice(0, 10).map(g => `- ${g.file}`).join('\n')}
${testGaps.length > 10 ? `\n... and ${testGaps.length - 10} more` : ''}

## Deliverable
Test files for critical components

## Verification  
Run test suite with coverage report`,
        labels: ['agent-task', 'testing']
      });
    }
    
    // Documentation
    const docGaps = analyzeDocumentation();
    if (docGaps.length > 0) {
      for (const gap of docGaps.slice(0, 3)) {
        discoveries.push({
          title: `Add ${gap.file}`,
          body: `## Scope
${gap.reason}

## Deliverable
Create ${gap.file} with comprehensive content

## Verification
File exists and contains relevant information`,
          labels: ['agent-task', 'documentation']
        });
      }
    }
    
    // Package scripts
    const scriptGaps = analyzePackageScripts();
    if (scriptGaps.length > 0) {
      discoveries.push({
        title: 'Add missing package.json scripts',
        body: `## Scope
Add recommended npm scripts

## Missing Scripts
${scriptGaps.map(g => `- \`${g.script}\`: ${g.reason}`).join('\n')}

## Deliverable
Updated package.json with new scripts

## Verification
Run \`npm run <script>\` for each added script`,
        labels: ['agent-task', 'tooling']
      });
    }
    
    // AI analysis
    const aiSuggestions = await analyzeWithAI();
    for (const suggestion of aiSuggestions) {
      discoveries.push({
        title: suggestion.title,
        body: suggestion.body,
        labels: ['agent-task', suggestion.category]
      });
    }
    
    // Create issues
    console.log(`\n📋 Creating ${discoveries.length} issues...`);
    let created = 0;
    
    for (const discovery of discoveries) {
      const success = await createIssue(discovery);
      if (success) created++;
      
      // Rate limit protection
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`\n✅ Issue discovery completed: ${created}/${discoveries.length} issues created`);
    
  } catch (error) {
    console.error('💥 Discovery error:', error);
    process.exit(1);
  }
}

// Run discovery
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
