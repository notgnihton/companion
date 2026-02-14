#!/bin/bash

# Script to run Playwright E2E tests for Claude assignment
# Usage: ./run-tests.sh [options]
#
# Options:
#   --headed    Run with visible browser
#   --ui        Run with Playwright UI
#   --debug     Run in debug mode
#   --list      List all tests without running

set -e

# Check if .env file exists in tests/e2e directory
if [ -f "$(dirname "$0")/.env" ]; then
    echo "Loading environment variables from tests/e2e/.env"
    export $(cat "$(dirname "$0")/.env" | grep -v '^#' | xargs)
fi

# Validate required environment variables
if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: GITHUB_TOKEN is not set"
    echo "Please set it in tests/e2e/.env or export it:"
    echo "  export GITHUB_TOKEN='your_token'"
    exit 1
fi

if [ -z "$GITHUB_REPO" ]; then
    echo "Error: GITHUB_REPO is not set"
    echo "Please set it in tests/e2e/.env or export it:"
    echo "  export GITHUB_REPO='owner/repo'"
    exit 1
fi

echo "Configuration:"
echo "  Repository: $GITHUB_REPO"
echo "  Test Issue: ${TEST_ISSUE_NUMBER:-1}"
echo ""

# Parse options
MODE="test:e2e"
case "$1" in
    --headed)
        MODE="test:e2e:headed"
        ;;
    --ui)
        MODE="test:e2e:ui"
        ;;
    --debug)
        MODE="test:e2e:debug"
        ;;
    --list)
        npx playwright test --list
        exit 0
        ;;
    "")
        # Default mode
        ;;
    *)
        echo "Unknown option: $1"
        echo "Usage: $0 [--headed|--ui|--debug|--list]"
        exit 1
        ;;
esac

# Run tests
echo "Running Playwright tests..."
npm run $MODE
