/**
 * assign-agent.mjs
 *
 * Uses Playwright to assign an AI coding agent to a GitHub issue via
 * GitHub's internal GraphQL endpoint. This is necessary because:
 *
 * 1. Only Copilot's runtime triggers from the REST agent_assignment API
 * 2. Claude and Codex runtimes only trigger from the GitHub UI assignment flow
 * 3. The internal /_graphql endpoint requires a browser session context (cookies + CSRF nonce)
 *
 * Usage:
 *   AGENT_BOT_ID=BOT_kgDO... ISSUE_NODE_ID=I_kwDO... \
 *     GH_SESSION_COOKIE=<value> ISSUE_NUMBER=123 node assign-agent.mjs
 *
 * Required environment variables:
 *   - AGENT_BOT_ID:       GraphQL node ID of the bot (e.g., BOT_kgDODnPHJg for Claude)
 *   - AGENT_DISPLAY_NAME: Human-readable name for logging (e.g., "Claude")
 *   - ISSUE_NODE_ID:      GraphQL node ID of the issue
 *   - ISSUE_NUMBER:       Issue number (used to navigate to the page)
 *   - GH_SESSION_COOKIE:  The `user_session` cookie value from a logged-in GitHub session
 *   - REPO_NWO:           Repository in owner/repo format (default: lucyscript/companion)
 *
 * Known bot IDs:
 *   Claude:  BOT_kgDODnPHJg  (anthropic-code-agent[bot])
 *   Codex:   BOT_kgDODnSAjQ  (openai-code-agent[bot])
 *   Copilot: BOT_kgDOC9w8XQ  (copilot-swe-agent[bot]) — doesn't need this, uses REST API
 */

import { chromium } from 'playwright';

async function assignAgent() {
  const {
    AGENT_BOT_ID,
    AGENT_DISPLAY_NAME = 'agent',
    ISSUE_NODE_ID,
    GH_SESSION_COOKIE,
    REPO_NWO = 'lucyscript/companion',
    ISSUE_NUMBER,
  } = process.env;

  if (!AGENT_BOT_ID || !ISSUE_NODE_ID || !GH_SESSION_COOKIE || !ISSUE_NUMBER) {
    console.error('Missing required env vars: AGENT_BOT_ID, ISSUE_NODE_ID, GH_SESSION_COOKIE, ISSUE_NUMBER');
    process.exit(1);
  }

  const issueUrl = `https://github.com/${REPO_NWO}/issues/${ISSUE_NUMBER}`;
  console.log(`Assigning ${AGENT_DISPLAY_NAME} (${AGENT_BOT_ID}) to ${issueUrl}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  await context.addCookies([
    {
      name: 'user_session',
      value: GH_SESSION_COOKIE,
      domain: 'github.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: '__Host-user_session_same_site',
      value: GH_SESSION_COOKIE,
      domain: 'github.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
    {
      name: 'logged_in',
      value: 'yes',
      domain: '.github.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);

  const page = await context.newPage();

  try {
    console.log('Navigating to issue page...');
    await page.goto(issueUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const loggedIn = await page.evaluate(() =>
      document.querySelector('meta[name="user-login"]')?.content || null
    );

    if (!loggedIn) {
      throw new Error('Not logged in — session cookie may have expired. Update GH_SESSION_COOKIE secret.');
    }
    console.log(`Logged in as: ${loggedIn}`);

    // Execute the assignment via page.evaluate (inside browser context).
    // This is the ONLY method that works — the CSRF nonce is validated within the page context.
    const result = await page.evaluate(
      async ({ botId, issueNodeId }) => {
        const nonce = document.querySelector('meta[name="fetch-nonce"]')?.content;
        if (!nonce) throw new Error('No fetch-nonce found on page');

        const resp = await fetch('/_graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'GitHub-Verified-Fetch': 'true',
            'X-Requested-With': 'XMLHttpRequest',
            'Scoped-CSRF-Token': nonce,
          },
          body: JSON.stringify({
            persistedQueryName: 'replaceActorsForAssignableRelayMutation',
            query: '19abeaf03278462751d1cf808a3f00f5',
            variables: {
              input: {
                actorIds: [botId],
                assignableId: issueNodeId,
              },
            },
          }),
        });

        const body = await resp.json();
        return { status: resp.status, body };
      },
      { botId: AGENT_BOT_ID, issueNodeId: ISSUE_NODE_ID }
    );

    if (result.status !== 200) {
      throw new Error(`GraphQL returned ${result.status}: ${JSON.stringify(result.body)}`);
    }

    const assignedActors = result.body?.data?.replaceActorsForAssignable?.assignable?.assignedActors?.nodes || [];
    const agentAssigned = assignedActors.some(a => a.id === AGENT_BOT_ID);

    if (!agentAssigned) {
      throw new Error(`${AGENT_DISPLAY_NAME} not in assigned actors: ${JSON.stringify(assignedActors.map(a => a.displayName))}`);
    }

    console.log(`✓ ${AGENT_DISPLAY_NAME} assigned. Actors: ${assignedActors.map(a => a.displayName).join(', ')}`);
  } finally {
    await browser.close();
  }
}

assignAgent().catch((err) => {
  console.error(`✗ Failed: ${err.message}`);
  process.exit(1);
});
