# Quick Reference: Playwright Claude Assignment Tests

## What This Does

Automates GitHub UI interactions to assign the Claude coding agent to issues, since Claude cannot be triggered programmatically via API (unlike Copilot and Codex).

## Quick Start

```bash
# 1. Set environment variables
export GITHUB_TOKEN="ghp_your_token_here"
export GITHUB_REPO="lucyscript/companion"
export TEST_ISSUE_NUMBER="123"

# 2. Run tests
npm run test:e2e

# Or use the helper script
cd tests/e2e
./run-tests.sh --headed
```

## Files Created

| File | Purpose |
|------|---------|
| `playwright.config.ts` | Playwright test configuration |
| `tests/e2e/claude-assignment.spec.ts` | Main test suite (3 test cases) |
| `tests/e2e/README.md` | Full documentation |
| `tests/e2e/.env.example` | Environment variable template |
| `tests/e2e/run-tests.sh` | Helper script for running tests |
| `.github/workflows/playwright-e2e.yml` | CI/CD workflow |

## Test Commands

| Command | Description |
|---------|-------------|
| `npm run test:e2e` | Run all E2E tests (headless) |
| `npm run test:e2e:headed` | Run with visible browser |
| `npm run test:e2e:ui` | Run with Playwright UI (interactive) |
| `npm run test:e2e:debug` | Run in debug mode |
| `npx playwright test --list` | List all available tests |

## The Problem

From `.github/scripts/orchestrator.js`:
```javascript
// Claude can only be triggered via the GitHub UI (internal dispatch).
// There is no public API to trigger it programmatically.
```

**Solution:** Playwright automates the browser to click through GitHub's UI and assign Claude to issues.

## Test Coverage

✅ **UI Assignment**: Navigate to issue → Click assignees → Select Claude → Verify
✅ **Workflow Trigger**: Confirm Claude bot starts working after assignment
✅ **API Limitation**: Document that GitHub API cannot trigger Claude agent workflow

## CI/CD

Trigger manually via GitHub Actions:
```bash
gh workflow run playwright-e2e.yml -f test_issue_number=123
```

Or it runs automatically on PRs that touch E2E test files.

## Next Steps

1. Run locally with `npm run test:e2e:ui` to see tests in action
2. Set up secrets in GitHub repo for CI runs
3. Create dedicated test issues to avoid polluting production data
4. Extend tests to cover edge cases (error handling, permissions, etc.)

## Documentation

See `tests/e2e/README.md` for:
- Detailed prerequisites
- Troubleshooting guide
- Best practices
- CI/CD integration details
