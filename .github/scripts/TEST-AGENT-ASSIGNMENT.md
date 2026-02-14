# Test: gh CLI GraphQL agentAssignment

This test validates the GitHub CLI and GraphQL integration for agent assignment functionality.

## Purpose

Tests the structure and configuration required for assigning AI agents to GitHub issues using the GitHub GraphQL API via the `gh` CLI tool.

## What It Tests

1. **GraphQL Query Structure**: Validates the GraphQL query for fetching assignable users
2. **gh CLI Availability**: Checks that the GitHub CLI tool is installed and accessible
3. **Agent Assignment Payload**: Verifies the structure of the `agent_assignment` payload used for Copilot agent assignments
4. **Agent Assignment Simulation**: Simulates the agent assignment process in dry-run mode

## Usage

```bash
# Run in dry-run mode (default)
./.github/scripts/test-agent-assignment.sh

# Run with custom repository
GITHUB_REPOSITORY=owner/repo ./.github/scripts/test-agent-assignment.sh

# Change test mode
TEST_MODE=dry-run ./.github/scripts/test-agent-assignment.sh
```

## Environment Variables

- `GITHUB_REPOSITORY`: Repository to test against (default: `lucyscript/companion`)
- `TEST_MODE`: Test execution mode (default: `dry-run`)

## Expected Output

The test should complete successfully with output showing:
- Valid GraphQL query structure
- gh CLI version information
- Agent assignment payload structure
- Simulated agent assignment details

## Exit Codes

- `0`: All tests passed
- `1`: Test failure (e.g., gh CLI not found)

## Related Files

- [orchestrator.js](./orchestrator.js) - Contains the production agent assignment logic
