#!/usr/bin/env node

/**
 * Refresh GH_SESSION_COOKIE secret.
 *
 * Opens a Playwright browser with saved GitHub session state.
 * If the session is still valid → extracts cookie → updates the secret.
 * If expired → opens visible browser for you to log in → saves state → updates secret.
 *
 * Usage:
 *   node .github/scripts/refresh-session.mjs
 *
 * Prerequisites:
 *   - npm i -D playwright  (already in workflow)
 *   - $TOKEN or $GH_TOKEN env var with repo scope
 *   - npx playwright install chromium  (one-time)
 *
 * The saved browser state is stored at .github/.playwright-state.json (gitignored).
 */

import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const COLLAB = process.argv.includes('--collab');
const SECRET_NAME = COLLAB ? 'GH_SESSION_COOKIE_COLLAB' : 'GH_SESSION_COOKIE';
const STATE_FILE = resolve(COLLAB ? '.github/.playwright-state-collab.json' : '.github/.playwright-state.json');
const REPO = process.env.GITHUB_REPOSITORY || 'svngwtn/companion';
const TOKEN = process.env.TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

if (COLLAB) {
  console.log(`🔄 Collab mode — will save to ${SECRET_NAME} (separate browser state)`);
}

if (!TOKEN) {
  console.error('Set TOKEN, GH_TOKEN, or GITHUB_TOKEN env var with repo scope.');
  process.exit(1);
}

async function main() {
  const hasState = existsSync(STATE_FILE);

  // First try headless with saved state
  if (hasState) {
    console.log('Trying saved session (headless)...');
    const cookie = await tryExtractCookie(true);
    if (cookie) {
      await updateSecret(cookie);
      return;
    }
    console.log('Saved session expired.');
  }

  // Fall back to visible browser for manual login
  console.log('\nOpening browser — log into GitHub, then press Enter here.');
  const cookie = await tryExtractCookie(false, true);
  if (cookie) {
    await updateSecret(cookie);
  } else {
    console.error('Failed to extract session cookie.');
    process.exit(1);
  }
}

async function tryExtractCookie(headless, waitForLogin = false) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext(
    existsSync(STATE_FILE) ? { storageState: STATE_FILE } : {}
  );
  const page = await context.newPage();

  try {
    await page.goto('https://github.com', { waitUntil: 'domcontentloaded', timeout: 15000 });

    let loggedIn = await page.evaluate(() =>
      document.querySelector('meta[name="user-login"]')?.content || null
    );

    if (!loggedIn && waitForLogin) {
      await page.goto('https://github.com/login', { waitUntil: 'domcontentloaded' });
      console.log('Waiting for login... (complete in browser, then press Enter)');

      // Wait for user to press Enter in terminal
      await new Promise(r => {
        process.stdin.once('data', r);
      });

      // Re-check after login
      await page.goto('https://github.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
      loggedIn = await page.evaluate(() =>
        document.querySelector('meta[name="user-login"]')?.content || null
      );
    }

    if (!loggedIn) {
      await browser.close();
      return null;
    }

    console.log(`Logged in as: ${loggedIn}`);

    // Extract user_session cookie (Playwright CAN read httpOnly cookies)
    const cookies = await context.cookies('https://github.com');
    const sessionCookie = cookies.find(c => c.name === 'user_session');

    if (!sessionCookie) {
      console.error('user_session cookie not found!');
      await browser.close();
      return null;
    }

    // Save state for next time
    await context.storageState({ path: STATE_FILE });
    console.log(`Session state saved to ${STATE_FILE}`);

    const expiry = new Date(sessionCookie.expires * 1000);
    console.log(`Cookie expires: ${expiry.toISOString()} (~${Math.round((expiry - Date.now()) / 86400000)} days)`);

    await browser.close();
    return sessionCookie.value;
  } catch (e) {
    await browser.close();
    throw e;
  }
}

async function updateSecret(cookieValue) {
  try {
    execSync(`echo "${cookieValue}" | GH_TOKEN=${TOKEN} gh secret set ${SECRET_NAME} -R ${REPO}`, {
      stdio: 'pipe',
    });
    console.log(`\n✓ ${SECRET_NAME} secret updated successfully.`);
  } catch (e) {
    console.error('Failed to update secret via gh CLI:', e.message);
    console.log('\nManual fallback — run this:');
    console.log(`  echo "${cookieValue}" | GH_TOKEN=$TOKEN gh secret set ${SECRET_NAME}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
