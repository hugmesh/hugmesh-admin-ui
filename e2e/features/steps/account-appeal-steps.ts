// Step definitions backing features/admin/account-appeals-decide.feature — the
// ACCOUNT-BAN appeal inbox (admin-ui #65 / admin-bff #189), distinct from
// functional-steps.ts's moderation-appeals coverage (a different table entirely:
// account_appeal vs. federation-api's moderation_requests).
//
// Victim-creates-first throughout: the appellant's own POST /bff/me/appeal call is
// the oracle every later step (the ban, the decide, the restore re-read) is measured
// against — never a fabricated id/handle.

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, responseState, scenarioState } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

function appealOf(username: string): { id: string; handle: string } {
  const found = scenarioState.accountAppeals.get(username);
  if (!found) throw new Error(`No account-ban appeal submitted by "${username}" in this scenario.`);
  return found;
}

// ── Submit (the appellant's own real appeal — victim-creates-first) ─────────────

When(
  '{string} submits an account-ban appeal via the BFF',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const submitted = await page.evaluate(async () => {
      const r = await fetch('/bff/me/appeal', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'e2e account-appeal oracle',
          contactEmail: 'e2e-appellant@example.test',
        }),
      });
      return { status: r.status, json: r.ok ? await r.json() : null };
    });
    // Honest precondition: the submit must really create/return a PENDING appeal
    // (201, or the idempotent 200 re-fetch) with a server-resolved id + handle —
    // every later step in the scenario is measured against THIS real row.
    expect([200, 201], `appeal submit for "${username}" must succeed`).toContain(submitted.status);
    const body = submitted.json as { id?: string; handle?: string; status?: string } | null;
    if (!body?.id || !body?.handle) {
      throw new Error(`account-appeal submit for "${username}" returned no id/handle — cannot seed the scenario`);
    }
    expect(body.status, 'a fresh submit must be PENDING').toBe('PENDING');
    scenarioState.accountAppeals.set(username, { id: body.id, handle: body.handle });
  },
);

// ── Ban the appellant's EXACT captured handle (the decide's restore target) ─────

When(
  '{string} bans {string}\'s account permanently via the BFF',
  async ({ user }, admin: string, appellant: string) => {
    const { handle } = appealOf(appellant);
    const page = pageOf(user(admin).username);
    const status = await page.evaluate(
      async ([handle]) => {
        const r = await fetch(`/bff/admin/access-roles/PROFILE/${encodeURIComponent(handle)}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttlSeconds: null, reason: 'e2e account-appeal ban' }),
        });
        return r.status;
      },
      [handle] as const,
    );
    // Honest ALLOW precondition: the ban must really land (200) — the decide's
    // "access restored" / "access stays restricted" assertions are only meaningful
    // against a REAL active suspension row.
    expect(status, `PROFILE ban of "${appellant}" (${handle}) must succeed (200)`).toBe(200);
  },
);

// ── Decide — UI (the ALLOW writes) ───────────────────────────────────────────────

When(
  '{string} approves the pending appeal from {string} through the console',
  async ({ user }, admin: string, appellant: string) => {
    const { id } = appealOf(appellant);
    const page = pageOf(user(admin).username);
    await page.locator(`button[data-approve="${id}"]`).click();
  },
);

When(
  '{string} denies the pending appeal from {string} through the console',
  async ({ user }, admin: string, appellant: string) => {
    const { id } = appealOf(appellant);
    const page = pageOf(user(admin).username);
    await page.locator(`button[data-deny="${id}"]`).click();
  },
);

Then(
  '{string} sees the appeal from {string} decided as {string}',
  async ({ user }, admin: string, appellant: string, status: string) => {
    const { id } = appealOf(appellant);
    const page = pageOf(user(admin).username);
    // Honest ALLOW: the decided table only renders a row here once the CAS write
    // truly landed (AccountAppealsComponent.reload() re-fetches after the decide
    // resolves) — the SAME evidence the operator sees. The pending list losing the
    // row is the other half of the same single-winner CAS.
    const decidedRow = page.locator(`[data-testid="aa-decided"] li[data-appeal-id="${id}"]`);
    await expect(decidedRow).toBeVisible({ timeout: 15_000 });
    await expect(decidedRow).toContainText(status);
    await expect(page.locator(`[data-testid="aa-pending"] li[data-appeal-id="${id}"]`)).toHaveCount(0);
  },
);

// ── Restore oracle — re-read the REAL access-roles state via the BFF ────────────

async function hasActiveProfileSuspensionFor(username: string, handle: string): Promise<boolean> {
  const page = pageOf(username);
  const body = await page.evaluate(async () => {
    const r = await fetch('/bff/admin/access-roles', { credentials: 'include' });
    return r.ok ? await r.json() : null;
  });
  const suspensions =
    (body as { suspensions?: Array<{ casdoorUser?: string; role?: string }> } | null)?.suspensions ?? [];
  return suspensions.some((s) => s.casdoorUser === handle && s.role === 'PROFILE');
}

Then(
  '{string} no longer sees an active PROFILE suspension for {string} via the BFF',
  async ({ user }, admin: string, appellant: string) => {
    const { handle } = appealOf(appellant);
    const found = await hasActiveProfileSuspensionFor(user(admin).username, handle);
    // The honesty keystone: an APPROVE that didn't actually restore access would
    // leave this true even though the decide call itself returned 200 / the console
    // showed APPROVED — this is the check that catches a dishonest "approved".
    expect(found, `expected "${appellant}"'s (${handle}) PROFILE suspension to be CLEARED`).toBe(false);
  },
);

Then(
  '{string} still sees an active PROFILE suspension for {string} via the BFF',
  async ({ user }, admin: string, appellant: string) => {
    const { handle } = appealOf(appellant);
    const found = await hasActiveProfileSuspensionFor(user(admin).username, handle);
    expect(found, `expected "${appellant}"'s (${handle}) PROFILE suspension to STILL be active (deny must not restore)`).toBe(true);
  },
);

// ── Decide — BFF role DENY (mod is deliberately excluded, real 403 not UI-hidden) ─

When(
  '{string} attempts to decide the appeal from {string} via the BFF',
  async ({ user }, username: string, appellant: string) => {
    const { id } = appealOf(appellant);
    const page = pageOf(user(username).username);
    responseState.lastStatus = await page.evaluate(
      async ([id]) => {
        const r = await fetch(`/bff/admin/account-appeals/${encodeURIComponent(id)}/decide?status=APPROVED`, {
          method: 'POST',
          credentials: 'include',
        });
        return r.status;
      },
      [id] as const,
    );
  },
);

Then(
  '{string} still has a pending account-ban appeal via the BFF',
  async ({ user }, username: string) => {
    const { id } = appealOf(username);
    const page = pageOf(user(username).username);
    const mine = await page.evaluate(async () => {
      const r = await fetch('/bff/me/appeal', { credentials: 'include' });
      return { status: r.status, json: r.ok ? await r.json() : null };
    });
    expect(mine.status).toBe(200);
    const appeals = (mine.json as Array<{ id: string; status: string }> | null) ?? [];
    const row = appeals.find((a) => a.id === id);
    expect(row, `appeal ${id} not found in "${username}"'s own appeal history`).toBeTruthy();
    // The re-read oracle: the denied decide attempt truly changed nothing — not
    // just that the HTTP call answered 403.
    expect(row!.status).toBe('PENDING');
  },
);
