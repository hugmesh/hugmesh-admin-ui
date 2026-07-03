// Step definitions backing features/admin/allowlist-invite.feature — the
// ADMIN-INVITE leg of the cross-service admin-invite -> register -> access
// loop (wave 3). Same write-channel discipline as mutation-steps.ts: drives
// the REAL console form and asserts the SAME evidence the operator sees (the
// invited handle rendered in the allowlist list, from the BFF's own
// response) — never a bare "request succeeded".
//
// Invited handles are uniquified per scenario (scenarioNonce) so repeated
// live runs never collide with a stale allowlist row from a prior run.

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, scenarioState, scenarioNonce } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

When(
  '{string} invites the Gmail address named {string} to the platform',
  async ({ user }, username: string, name: string) => {
    const page = pageOf(user(username).username);
    const email = `e2e-invite-${scenarioNonce()}-${name}@gmail.com`.toLowerCase();
    scenarioState.uniqueNames.set(name, email);
    await page.locator('[data-testid="admin-email"]').fill(email);
    await page.locator('[data-testid="admin-invite"]').click();
  },
);

When(
  '{string} invites the Discord username named {string} to the platform',
  async ({ user }, username: string, name: string) => {
    const page = pageOf(user(username).username);
    const handle = `e2e-invite-${scenarioNonce()}-${name}`.toLowerCase();
    scenarioState.uniqueNames.set(name, handle);
    await page.locator('[data-testid="admin-discord"]').fill(handle);
    await page.locator('[data-testid="admin-invite-discord"]').click();
  },
);

Then(
  'the Gmail address named {string} appears in {string}\'s allowlist',
  async ({ user }, name: string, username: string) => {
    const email = scenarioState.uniqueNames.get(name);
    if (!email) throw new Error(`No Gmail address named "${name}" was invited in this scenario.`);
    const page = pageOf(user(username).username);
    await expect(
      page.locator(`[data-testid="admin-allowlist"] [data-email="${email}"]`),
    ).toBeVisible({ timeout: 15_000 });
  },
);

Then(
  'the Discord username named {string} appears in {string}\'s allowlist',
  async ({ user }, name: string, username: string) => {
    const handle = scenarioState.uniqueNames.get(name);
    if (!handle) throw new Error(`No Discord username named "${name}" was invited in this scenario.`);
    const page = pageOf(user(username).username);
    await expect(
      page.locator(`[data-testid="admin-allowlist-discord"] [data-discord="${handle}"]`),
    ).toBeVisible({ timeout: 15_000 });
  },
);
