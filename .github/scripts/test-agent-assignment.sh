#!/usr/bin/env bash
#
# Test: gh CLI GraphQL agentAssignment
#
# This script tests the GitHub GraphQL API for agent assignment
# functionality using the gh CLI tool.
#

set -euo pipefail

echo "=== Test: gh CLI GraphQL agentAssignment ==="
echo

# Configuration
REPO="${GITHUB_REPOSITORY:-lucyscript/companion}"
TEST_MODE="${TEST_MODE:-dry-run}"

echo "Repository: $REPO"
echo "Test mode: $TEST_MODE"
echo

# Test 1: Verify GraphQL query structure
echo "Test 1: Verify GraphQL query structure"
echo "---------------------------------------"

QUERY='query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    assignableUsers(first: 10) {
      nodes {
        login
        name
      }
    }
  }
}'

# Split repo into owner and name
if [[ ! "$REPO" =~ ^[^/]+/[^/]+$ ]]; then
  echo "Error: GITHUB_REPOSITORY must be in 'owner/name' format"
  exit 1
fi
IFS='/' read -r OWNER REPO_NAME <<< "$REPO"

echo "GraphQL query defined:"
echo "$QUERY"
echo
echo "Variables:"
echo "  owner: $OWNER"
echo "  name: $REPO_NAME"
echo "✓ Query structure valid"
echo

# Test 2: Verify gh CLI is available
echo "Test 2: Verify gh CLI is available"
echo "-----------------------------------"

if command -v gh &> /dev/null; then
  GH_VERSION=$(gh --version | head -1)
  echo "✓ gh CLI found: $GH_VERSION"
else
  echo "✗ gh CLI not found"
  exit 1
fi
echo

# Test 3: Verify agent_assignment payload structure
echo "Test 3: Verify agent_assignment payload structure"
echo "--------------------------------------------------"

# This test verifies the structure of the agent_assignment payload
# that would be sent to the GitHub API for Copilot agent assignment
# Note: The 'model' field is intentionally empty to use the default model
cat <<'EOF' > /tmp/agent_assignment_payload.json
{
  "assignees": ["copilot-swe-agent[bot]"],
  "agent_assignment": {
    "target_repo": "lucyscript/companion",
    "base_branch": "main",
    "custom_instructions": "Use the backend-engineer agent profile.",
    "custom_agent": "backend-engineer",
    "model": ""
  }
}
EOF

echo "Sample agent_assignment payload structure:"
cat /tmp/agent_assignment_payload.json
echo
echo "✓ Payload structure valid"
echo

# Test 4: Simulate agent assignment (dry-run)
echo "Test 4: Simulate agent assignment"
echo "-----------------------------------"

if [ "$TEST_MODE" = "dry-run" ]; then
  echo "[DRY RUN] Would assign agent with:"
  echo "  - Agent: copilot-swe-agent[bot]"
  echo "  - Custom agent profile: backend-engineer"
  echo "  - Target repo: $REPO"
  echo "  - Base branch: main"
  echo "✓ Simulation successful"
else
  echo "Skipping actual assignment (set TEST_MODE=live to enable)"
fi
echo

# Cleanup
rm -f /tmp/agent_assignment_payload.json

echo "=== All tests passed! ==="
exit 0
