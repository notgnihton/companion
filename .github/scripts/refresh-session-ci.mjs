/**
 * refresh-session-ci.mjs
 *
 * Automated version of refresh-session.mjs for GitHub Actions.
 * Uses the existing GH_SESSION_COOKIE to open a Playwright session,
 * navigates GitHub to trigger potential cookie refresh, then checks
 * if the user_session cookie was reissued with a new expiry.
 *
 * If refreshed → updates the GH_SESSION_COOKIE secret.
 * If same/expired → exits with error (manual login needed).
 *
 * Environment variables:
 *   GH_SESSION_COOKIE  - Current user_session cookie value
 *   GITHUB_REPOSITORY  - owner/repo (auto-set by Actions)
 *   GITHUB_OUTPUT      - Output file path (auto-set by Actions)
 */

import { chromium } from 'playwright';

const REPO = process.env.GITHUB_REPOSITORY || 'lucyscript/companion';
const SESSION_COOKIE = process.env.GH_SESSION_COOKIE || '';

if (!SESSION_COOKIE) {
  console.error('GH_SESSION_COOKIE not set');
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // Restore session cookies
  await context.addCookies([
    {
      name: 'user_session',
      value: SESSION_COOKIE,
      domain: 'github.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: '__Host-user_session_same_site',
      value: SESSION_COOKIE,
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
    // Navigate to GitHub dashboard (triggers session validation + potential refresh)
    console.log('Loading GitHub dashboard...');
    await page.goto('https://github.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const loggedIn = await page.evaluate(() =>
      document.querySelector('meta[name="user-login"]')?.content || null
    );

    if (!loggedIn) {
      console.error('Session expired — manual login required.');
      console.error('Run locally: node .github/scripts/refresh-session.mjs');
      process.exit(1);
    }
    console.log(`Logged in as: ${loggedIn}`);

    // Navigate to a few pages to trigger cookie rotation
    const pages = [
      `https://github.com/${REPO}`,
      `https://github.com/settings/sessions`,
      `https://github.com/${REPO}/issues`,
    ];

    for (const url of pages) {
      console.log(`Visiting ${url}...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1000);
    }

    // Check cookies after navigation
    const cookies = await context.cookies('https://github.com');
    const sessionCookie = cookies.find(c => c.name === 'user_session');

    if (!sessionCookie) {
      console.error('user_session cookie disappeared!');
      process.exit(1);
    }

    const expiry = new Date(sessionCookie.expires * 1000);
    const daysLeft = Math.round((expiry - Date.now()) / 86400000);
    console.log(`Cookie value changed: ${sessionCookie.value !== SESSION_COOKIE}`);
    console.log(`Cookie expires: ${expiry.toISOString()} (~${daysLeft} days)`);

    if (daysLeft <= 0) {
      console.error('Cookie already expired!');
      process.exit(1);
    }

    // Always update the secret with whatever cookie we have
    // (even if unchanged, this is idempotent and costs nothing)
    if (sessionCookie.value !== SESSION_COOKIE) {
      console.log('Cookie was refreshed! Updating secret...');
    } else {
      console.log('Cookie unchanged but still valid.');
    }

    // Write cookie to stdout for the workflow to pick up
    // The workflow handles updating the secret via gh CLI
    const output = process.env.GITHUB_OUTPUT;
    if (output) {
      const { appendFileSync } = await import('fs');
      appendFileSync(output, `cookie_value=${sessionCookie.value}\n`);
      appendFileSync(output, `cookie_changed=${sessionCookie.value !== SESSION_COOKIE}\n`);
      appendFileSync(output, `days_left=${daysLeft}\n`);
    }

    console.log(`\n✓ Session valid. ${daysLeft} days remaining.`);
  } finally {
    await browser.close();
  }
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
