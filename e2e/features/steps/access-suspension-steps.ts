// Step definitions backing features/admin/access-suspension.feature — the
// Delegation console's PROFILE access-role suspend/lift (the real ban <->
// restore lever behind the cross-service appeals loop).
//
// UI write: drives the actual Delegation console form (dg-suspend-*) and the
// "Lift" button rendered per row, asserting the row the SERVER returned (the
// suspensions table re-renders from DelegationStore.suspend/clear's response,
// not an optimistic local write) — the same evidence standard as
// mutation-steps.ts.
// BFF write: fires the same same-origin fetch the app's BffService fires
// (credentials:'include'), for the victim-creates-first cross-domain oracle.

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, scenarioState, scenarioNonce } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** The uniquified casdoor-user actually sent to the server for a feature-file
 *  base name (mirrors mutation-steps.ts' fullTitleOf for announcements). */
function fullUserOf(base: string): string {
  const known = scenarioState.uniqueNames.get(base);
  if (!known) throw new Error(`No user "${base}" was banned in this scenario.`);
  return known;
}

// ── Delegation console — UI ban + lift (the ALLOW write) ────────────────────

When(
  '{string} bans {string} from the {string} access role permanently via the delegation console',
  async ({ user }, admin: string, targetBase: string, role: string) => {
    const page = pageOf(user(admin).username);
    // Uniquify so a repeat run against a live stack cannot collide on a
    // stale row from a prior run.
    const target = `${targetBase}-${scenarioNonce()}`;
    scenarioState.uniqueNames.set(targetBase, target);
    await page.locator('[data-tab="suspensions"]').click();
    await page.locator('[data-testid="dg-suspend-role"]').selectOption(role);
    await page.locator('[data-testid="dg-suspend-user"]').fill(target);
    // TTL left blank -> the endpoint's permanent (null-ttl) branch, i.e. a
    // BAN rather than a timed suspend (SuspensionService.suspend).
    await page.locator('[data-testid="dg-suspend"]').click();
  },
);

Then(
  '{string} sees the suspension row for {string} with role {string}',
  async ({ user }, admin: string, targetBase: string, role: string) => {
    const page = pageOf(user(admin).username);
    const target = fullUserOf(targetBase);
    const row = page
      .locator('[data-testid="dg-suspensions-table"] tbody tr')
      .filter({ hasText: target })
      .filter({ hasText: role });
    // Honest ALLOW: only passes when the POST truly landed a server row
    // (the table renders straight off DelegationStore.suspend's response).
    await expect(row).toHaveCount(1, { timeout: 15_000 });
  },
);

When(
  '{string} lifts the suspension for {string}',
  async ({ user }, admin: string, targetBase: string) => {
    const page = pageOf(user(admin).username);
    const target = fullUserOf(targetBase);
    const row = page
      .locator('[data-testid="dg-suspensions-table"] tbody tr')
      .filter({ hasText: target });
    await row.locator('button[data-clear]').click();
  },
);

Then(
  '{string} sees no suspension row for {string}',
  async ({ user }, admin: string, targetBase: string) => {
    const page = pageOf(user(admin).username);
    const target = fullUserOf(targetBase);
    const row = page
      .locator('[data-testid="dg-suspensions-table"] tbody tr')
      .filter({ hasText: target });
    // Honest RESTORE: only passes when the DELETE truly cleared the server
    // row (the table re-renders from DelegationStore.clear's response, which
    // omits the now-restored row) — not merely that a local flag flipped.
    await expect(row).toHaveCount(0, { timeout: 15_000 });
  },
);

// ── BFF ban + cross-domain invisibility (victim-creates-first) ──────────────

When(
  '{string} bans {string} from the {string} access role permanently via the BFF',
  async ({ user }, admin: string, targetBase: string, role: string) => {
    const page = pageOf(user(admin).username);
    const target = `${targetBase}-${scenarioNonce()}`;
    scenarioState.uniqueNames.set(targetBase, target);
    const status = await page.evaluate(
      async ([url, body]) => {
        const r = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        return r.status;
      },
      [
        `/bff/admin/access-roles/${role}/${encodeURIComponent(target)}`,
        JSON.stringify({ ttlSeconds: null, reason: 'e2e cross-domain probe' }),
      ] as const,
    );
    // Honest ALLOW precondition: the victim ban must really succeed (200,
    // AdminController.suspendAccessRole) — this row is the oracle the
    // cross-domain DENY below is measured against.
    expect(status, 'victim ban must succeed (200)').toBe(200);
  },
);

async function hasSuspensionFor(username: string, target: string): Promise<boolean> {
  const page = pageOf(username);
  const body = await page.evaluate(async () => {
    const r = await fetch('/bff/admin/access-roles', { credentials: 'include' });
    return r.ok ? await r.json() : null;
  });
  const suspensions = (body as { suspensions?: Array<{ casdoorUser?: string }> } | null)?.suspensions ?? [];
  return suspensions.some((s) => s.casdoorUser === target);
}

Then(
  '{string} does not see the suspension for {string} in their access-roles list via the BFF',
  async ({ user }, admin: string, targetBase: string) => {
    const target = fullUserOf(targetBase);
    const found = await hasSuspensionFor(user(admin).username, target);
    expect(found, `expected "${admin}" NOT to see the cross-domain suspension row`).toBe(false);
  },
);

Then(
  '{string} still sees the suspension for {string} in their access-roles list via the BFF',
  async ({ user }, admin: string, targetBase: string) => {
    const target = fullUserOf(targetBase);
    const found = await hasSuspensionFor(user(admin).username, target);
    expect(found, `expected "${admin}" to still see their own suspension row`).toBe(true);
  },
);
