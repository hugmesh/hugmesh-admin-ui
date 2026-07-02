// Session / login / navigation step definitions backing the admin-ui features.
//
// Two flavours of "logged in":
//   - `Given "X" is logged in`         — full Casdoor round-trip via login()
//     (LIVE; only reached by @cluster scenarios, which ship dark behind the
//     default 'not @cluster' filter).
//   - `Given "X" has a seeded session` — writes snap.session directly via an
//     addInitScript (OFFLINE-capable; exercises the pure client-side guard
//     behaviour the host enforces with adminGuard/superadminGuard/gamesGuard).
//
// The navigation steps assert the guard outcome: a guarded route either renders
// its console view (ALLOW) or the guard redirects to /login (DENY). All such
// steps live in @cluster features today because they need the host shell to be
// serving the remote; bddgen still compiles them so `--list` proves they parse.

import { expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry, ctxRegistry, responseState } from './_registry';
import {
  SeedUser,
  login,
  seedSession,
  clearSession,
  newE2eContext,
} from '../../tests/helpers/roles';

// ── Session priming ───────────────────────────────────────────────────────

Given('a clean session', async ({ page }) => {
  await clearSession(page);
});

Given('{string} is logged in', async ({ page, user }, username: string) => {
  const u: SeedUser = user(username);
  await login(page, u);
  pageRegistry.set(u.username, page);
});

Given('{string} has a seeded session', async ({ page, user }, username: string) => {
  const u: SeedUser = user(username);
  // addInitScript must run BEFORE the first navigation, so register the page and
  // seed; the navigation step that follows picks the session up on load.
  await seedSession(page, u);
  pageRegistry.set(u.username, page);
});

Given('{string} has a seeded session in their own context', async ({ browser, user }, username: string) => {
  // Cross-user matrix: give each user an isolated context so two identities can
  // coexist in one scenario without sharing localStorage.
  const u: SeedUser = user(username);
  const ctx = await newE2eContext(browser);
  const page = await ctx.newPage();
  await seedSession(page, u);
  ctxRegistry.set(u.username, ctx);
  pageRegistry.set(u.username, page);
});

Given('{string} is logged in in their own context', async ({ browser, user }, username: string) => {
  // Cross-user matrix with REAL credentials: each persona gets an isolated
  // context AND a full Casdoor login, so several identities can fire authorised
  // BFF calls (their own HttpOnly bff_ cookie) inside one scenario — the
  // victim-creates-first mutation scenarios need this.
  const u: SeedUser = user(username);
  const ctx = await newE2eContext(browser);
  const page = await ctx.newPage();
  await login(page, u);
  ctxRegistry.set(u.username, ctx);
  pageRegistry.set(u.username, page);
});

// ── Navigation ─────────────────────────────────────────────────────────────

When('{string} navigates to {string}', async ({ user }, username: string, path: string) => {
  const u: SeedUser = user(username);
  const page = pageRegistry.get(u.username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
});

When('a signed-out visitor opens {string}', async ({ page }, path: string) => {
  // SIGNED-OUT persona: the scenario's default page carries NO snap.session (and
  // no bff_ cookie), so every admin guard must fail-closed on the navigation.
  await page.goto(path, { waitUntil: 'domcontentloaded' });
});

Then('the signed-out visitor is redirected to the login page', async ({ page }) => {
  await page.waitForURL(/\/login(\?|$)/, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/login(\?|$)/);
});

// ── Guard-outcome assertions ────────────────────────────────────────────────

Then('{string} sees the {string} console', async ({ user }, username: string, testid: string) => {
  // ALLOW: the guard passed and the console's root view rendered. Every console
  // root carries a stable data-testid (e.g. games-services-view,
  // superadmin-domains-view, admin-view).
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toBeVisible({ timeout: 15_000 });
});

Then('{string} is redirected to the login page', async ({ user }, username: string) => {
  // DENY: adminGuard/superadminGuard/gamesServicesGuard returns
  // router.parseUrl('/login'), so the URL settles on /login and the console view
  // never renders.
  const page = pageRegistry.get(user(username).username)!;
  await page.waitForURL(/\/login(\?|$)/, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/login(\?|$)/);
});

Then('{string} does not see the {string} console', async ({ user }, username: string, testid: string) => {
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toHaveCount(0);
});

// ── Disabled + helptext (the ALLOW-but-restricted surface) ──────────────────

Then('{string} sees the {string} control disabled', async ({ user }, username: string, testid: string) => {
  const page = pageRegistry.get(user(username).username)!;
  const el = page.locator(`[data-testid="${testid}"]`);
  await expect(el).toBeVisible();
  // The component drives both [disabled] and [attr.aria-disabled]; assert both
  // so the a11y contract (a screen reader announces the disabled state) is
  // covered, not just the visual one.
  await expect(el).toBeDisabled();
  await expect(el).toHaveAttribute('aria-disabled', 'true');
});

Then('{string} sees the {string} control enabled', async ({ user }, username: string, testid: string) => {
  const page = pageRegistry.get(user(username).username)!;
  const el = page.locator(`[data-testid="${testid}"]`);
  await expect(el).toBeVisible();
  await expect(el).toBeEnabled();
});

Then('{string} sees help text {string}', async ({ user }, username: string, testid: string) => {
  // The greyed-out console shows a helptext span (e.g. gs-runner-help)
  // explaining WHY the action is unavailable — the requirement's
  // "disabled+helptext" pairing.
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toBeVisible();
});

// ── API-level cross-user DENY ───────────────────────────────────────────────
// The console is display-only; the BFF is the real gate. These steps fire a
// same-origin fetch with credentials:'include' so the HttpOnly bff_ cookie rides
// the request (the gateway turns it into the bearer server-side) and the actual
// admin-bff @PreAuthorize + domain-scope chain is exercised; capture the status.

When('{string} GETs {string}', async ({ user }, username: string, path: string) => {
  const page = pageRegistry.get(user(username).username)!;
  responseState.lastStatus = await page.evaluate(
    async (url) => {
      const r = await fetch(url, { credentials: 'include' });
      return r.status;
    },
    path,
  );
});

When(
  '{string} POSTs to {string} with body:',
  async ({ user }, username: string, path: string, body: string) => {
    // A REAL POST (not a GET stand-in): same-origin fetch, credentials:'include'
    // so the caller's HttpOnly bff_ cookie rides the request. The docstring body
    // must be BEAN-VALID for the target endpoint so a 400 can never shadow the
    // 403 under test — the only gate left standing is the authz chain.
    const page = pageRegistry.get(user(username).username)!;
    responseState.lastStatus = await page.evaluate(
      async ([url, payload]) => {
        const r = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
        return r.status;
      },
      [path, body] as const,
    );
  },
);

When('the unauthenticated client GETs {string}', async ({ page }, path: string) => {
  await page.goto('/');
  responseState.lastStatus = await page.evaluate(async (p) => {
    const r = await fetch(p);
    return r.status;
  }, path);
});

Then('the response status is {int}', async ({}, expected: number) => {
  expect(responseState.lastStatus).toBe(expected);
});

// NOTE: there is deliberately NO "response status is one of X or Y" step. Every
// DENY on this platform is deterministic (403 at the URL gate, 404-invisible on
// another brand's id), so each scenario asserts the ONE status its gate answers
// — an OR-assertion would let a wrong gate pass unnoticed.
