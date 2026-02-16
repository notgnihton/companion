/**
 * assign-agent.mjs
 *
 * Assigns an AI coding agent to a GitHub issue via GitHub's internal
 * GraphQL endpoint using plain Node.js fetch (no browser needed).
 *
 * Flow:
 * 1. GET the issue page with session cookies to extract the CSRF nonce
 * 2. POST to /_graphql with the nonce to assign the bot
 *
 * This is necessary because:
 * 1. Only Copilot's runtime triggers from the REST agent_assignment API
 * 2. Claude and Codex runtimes only trigger from the GitHub UI assignment flow
 * 3. The internal /_graphql endpoint requires a session cookie + CSRF nonce
 *
 * Required environment variables:
 *   - AGENT_BOT_ID:       GraphQL node ID of the bot
 *   - AGENT_DISPLAY_NAME: Human-readable name for logging
 *   - ISSUE_NODE_ID:      GraphQL node ID of the issue
 *   - ISSUE_NUMBER:       Issue number
 *   - GH_SESSION_COOKIE:  The `user_session` cookie value
 *   - REPO_NWO:           Repository in owner/repo format
 *
 * Known bot IDs:
 *   Claude:  BOT_kgDODnPHJg  (anthropic-code-agent[bot])
 *   Codex:   BOT_kgDODnSAjQ  (openai-code-agent[bot])
 *   Copilot: BOT_kgDOC9w8XQ  (copilot-swe-agent[bot]) — uses REST API instead
 */

async function assignAgent() {
  const {
    AGENT_BOT_ID,
    AGENT_DISPLAY_NAME = 'agent',
    ISSUE_NODE_ID,
    GH_SESSION_COOKIE,
    REPO_NWO = 'svngwtn/companion',
    ISSUE_NUMBER,
  } = process.env;

  if (!AGENT_BOT_ID || !ISSUE_NODE_ID || !GH_SESSION_COOKIE || !ISSUE_NUMBER) {
    console.error('Missing required env vars: AGENT_BOT_ID, ISSUE_NODE_ID, GH_SESSION_COOKIE, ISSUE_NUMBER');
    process.exit(1);
  }

  const issueUrl = `https://github.com/${REPO_NWO}/issues/${ISSUE_NUMBER}`;
  console.log(`Assigning ${AGENT_DISPLAY_NAME} (${AGENT_BOT_ID}) to ${issueUrl}`);

  const cookieHeader = `user_session=${GH_SESSION_COOKIE}; __Host-user_session_same_site=${GH_SESSION_COOKIE}; logged_in=yes`;

  // Step 1: Fetch issue page to get CSRF nonce
  console.log('Fetching issue page for CSRF nonce...');
  const pageResp = await fetch(issueUrl, {
    headers: {
      'Cookie': cookieHeader,
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });

  if (!pageResp.ok) {
    throw new Error(`Failed to fetch issue page: ${pageResp.status} ${pageResp.statusText}`);
  }

  const html = await pageResp.text();

  // Check login
  const loginMatch = html.match(/<meta\s+name="user-login"\s+content="([^"]+)"/);
  if (!loginMatch) {
    throw new Error('Not logged in — session cookie may have expired. Update GH_SESSION_COOKIE secret.');
  }
  console.log(`Logged in as: ${loginMatch[1]}`);

  // Extract CSRF nonce
  const nonceMatch = html.match(/<meta\s+name="fetch-nonce"\s+content="([^"]+)"/);
  if (!nonceMatch) {
    throw new Error('No fetch-nonce found on page');
  }
  const nonce = nonceMatch[1];
  console.log('Got CSRF nonce');

  // Step 2: Call internal GraphQL to assign the bot
  console.log('Calling /_graphql to assign agent...');
  const graphqlResp = await fetch('https://github.com/_graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'GitHub-Verified-Fetch': 'true',
      'X-Requested-With': 'XMLHttpRequest',
      'Scoped-CSRF-Token': nonce,
      'Origin': 'https://github.com',
      'Referer': issueUrl,
    },
    body: JSON.stringify({
      persistedQueryName: 'replaceActorsForAssignableRelayMutation',
      query: '19abeaf03278462751d1cf808a3f00f5',
      variables: {
        input: {
          actorIds: [AGENT_BOT_ID],
          assignableId: ISSUE_NODE_ID,
        },
      },
    }),
  });

  const body = await graphqlResp.json();

  if (!graphqlResp.ok) {
    throw new Error(`GraphQL returned ${graphqlResp.status}: ${JSON.stringify(body)}`);
  }

  const assignedActors = body?.data?.replaceActorsForAssignable?.assignable?.assignedActors?.nodes || [];
  const agentAssigned = assignedActors.some(a => a.id === AGENT_BOT_ID);

  if (!agentAssigned) {
    throw new Error(`${AGENT_DISPLAY_NAME} not in assigned actors: ${JSON.stringify(assignedActors.map(a => a.displayName))}`);
  }

  console.log(`✓ ${AGENT_DISPLAY_NAME} assigned. Actors: ${assignedActors.map(a => a.displayName).join(', ')}`);
}

assignAgent().catch((err) => {
  console.error(`✗ Failed: ${err.message}`);
  process.exit(1);
});
