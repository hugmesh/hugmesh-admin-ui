// Wave 2 FUNCTIONAL/WRITE step definitions — Appeals decide, Superadmin Domains
// register, Namespace Access grant. Same two write channels as mutation-steps.ts:
//   - UI writes: drive the real console form and prove the outcome in the SAME view
//     the operator sees.
//   - BFF writes: fire the same same-origin fetch the app's services fire
//     (credentials:'include' → the HttpOnly bff_ cookie), capture REAL server state,
//     and use it as the oracle for cross-user DENYs — victim-creates-first.
//
// Appeals additionally seeds through mod-bff (POST /bff/mod/moderation,
// POST /bff/mod/moderation/{id}/refer) because admin-bff proxies ONLY the decide leg
// of the federation-api moderation workflow — there is no admin-bff submit/refer proxy
// (see AppealsComponent's doc comment). Seeding through the real mod→admin escalation
// chain is the only way to hand the admin console a REAL referred id to decide.

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, responseState, scenarioState, scenarioNonce } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

// ── Appeals — seed via mod-bff (submit + refer) ─────────────────────────────

When('{string} submits a moderation request via the mod BFF', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // instance-block is decision-only downstream (no auto-applied kill-switch, unlike
  // user-removal) — the honest choice for an e2e probe that must not leave a live
  // side effect on a real account.
  const target = `e2e-appeal-${scenarioNonce()}.example.test`;
  const submitted = await page.evaluate(
    async ([target]) => {
      const r = await fetch('/bff/mod/moderation', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'instance-block', target, reason: 'e2e appeals-decide oracle' }),
      });
      return { status: r.status, json: r.ok ? await r.json() : null };
    },
    [target] as const,
  );
  expect(submitted.status, 'mod submit must succeed (200)').toBe(200);
  const id = (submitted.json as { request?: { id?: number } } | null)?.request?.id;
  if (!id) throw new Error('mod-bff submit returned no request id — cannot seed the appeal');
  scenarioState.moderationRequestId = id;
});

When(
  '{string} refers the moderation request to admins via the mod BFF',
  async ({ user }, username: string) => {
    const id = scenarioState.moderationRequestId;
    if (!id) throw new Error('No moderation request submitted in this scenario.');
    const page = pageOf(user(username).username);
    const referred = await page.evaluate(
      async ([id]) => {
        const r = await fetch(`/bff/mod/moderation/${id}/refer`, {
          method: 'POST',
          credentials: 'include',
        });
        return { status: r.status };
      },
      [id] as const,
    );
    expect(referred.status, 'mod refer must succeed (200)').toBe(200);
  },
);

Then(
  '{string} sees the moderation request status {string}',
  async ({ user }, username: string, status: string) => {
    // Re-read the REAL server state through mod-user's own triage queue — the
    // authoritative confirmation that a decide (or a denied decide attempt) did or
    // did not change anything, not just an assumption from the HTTP status alone.
    const id = scenarioState.moderationRequestId;
    if (!id) throw new Error('No moderation request submitted in this scenario.');
    const page = pageOf(user(username).username);
    const listed = await page.evaluate(async () => {
      const r = await fetch('/bff/mod/moderation', { credentials: 'include' });
      return { status: r.status, json: r.ok ? await r.json() : null };
    });
    expect(listed.status).toBe(200);
    const requests = (listed.json as { requests?: Array<{ id: number; status: string }> } | null)
      ?.requests ?? [];
    const row = requests.find((r) => r.id === id);
    expect(row, `moderation request ${id} not found in ${username}'s queue`).toBeTruthy();
    expect(row!.status).toBe(status);
  },
);

// ── Appeals — admin console decide (the ALLOW write) ────────────────────────

When(
  '{string} enters the referred moderation request id in the appeals console',
  async ({ user }, username: string) => {
    const id = scenarioState.moderationRequestId;
    if (!id) throw new Error('No moderation request submitted in this scenario.');
    await pageOf(user(username).username).locator('[data-testid="ap-id"]').fill(String(id));
  },
);

When('{string} approves the appeal', async ({ user }, username: string) => {
  await pageOf(user(username).username).locator('[data-testid="ap-approve"]').click();
});

Then('{string} sees the appeal approved confirmation', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // ap-note only renders after the decide-proxy answered with the stored row.
  await expect(page.locator('[data-testid="ap-note"]')).toContainText('approved', { timeout: 15_000 });
  await expect(page.locator('[data-testid="ap-error"]')).toHaveCount(0);
});

Then(
  'the appeal appears in {string}\'s decided appeals table with status {string}',
  async ({ user }, username: string, status: string) => {
    const id = scenarioState.moderationRequestId;
    if (!id) throw new Error('No moderation request submitted in this scenario.');
    const page = pageOf(user(username).username);
    const row = page.locator(`[data-testid="ap-decided-table"] tbody tr[data-appeal-id="${id}"]`);
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await expect(row.locator('[data-cell="status"]')).toContainText(status);
  },
);

// ── Appeals — BFF decide attempt (the role + cross-domain DENYs) ────────────

When(
  '{string} attempts to decide the referred moderation request via the BFF',
  async ({ user }, username: string) => {
    const id = scenarioState.moderationRequestId;
    if (!id) throw new Error('No moderation request submitted in this scenario.');
    const page = pageOf(user(username).username);
    responseState.lastStatus = await page.evaluate(
      async ([id]) => {
        const r = await fetch(`/bff/admin/moderation/${id}/decide?approve=true`, {
          method: 'POST',
          credentials: 'include',
        });
        return r.status;
      },
      [id] as const,
    );
  },
);

// ── Superadmin Domains — UI register (the ALLOW write) ───────────────────────

When('{string} registers a new domain through the console', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const clusterDomain = `e2e-${scenarioNonce()}.example.test`;
  scenarioState.uniqueNames.set('domain', clusterDomain);
  await page.locator('[data-testid="sd-cluster-domain"]').fill(clusterDomain);
  await page.locator('[data-testid="sd-brand"]').fill(`e2e-brand-${scenarioNonce()}`);
  await page.locator('[data-testid="sd-register"]').click();
});

Then('{string} sees the registered domain in the domains list', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const clusterDomain = scenarioState.uniqueNames.get('domain');
  if (!clusterDomain) throw new Error('No domain registered in this scenario.');
  const row = page.locator(`[data-testid="sd-domains"] li[data-cluster-domain="${clusterDomain}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="sd-error"]')).toHaveCount(0);
});

// ── Namespace Access — UI grant (the ALLOW write) ────────────────────────────

When(
  '{string} grants namespace access to a user through the console',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const grantedUser = `e2e-ns-${scenarioNonce()}@example.test`;
    scenarioState.uniqueNames.set('ns-user', grantedUser);
    // The <select> options render only after ngOnInit's namespaceAccess() call
    // resolves — wait for the real option before picking it.
    const option = page.locator('[data-testid="ns-select"] option[value="observability"]');
    await option.waitFor({ state: 'attached', timeout: 15_000 });
    await page.locator('[data-testid="ns-user"]').fill(grantedUser);
    await page.locator('[data-testid="ns-select"]').selectOption('observability');
    await page.locator('[data-testid="ns-grant"]').click();
  },
);

Then(
  'the granted user appears in {string}\'s namespace grants list',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const grantedUser = scenarioState.uniqueNames.get('ns-user');
    if (!grantedUser) throw new Error('No namespace grant created in this scenario.');
    const li = page.locator(`[data-testid="ns-grants"] li[data-user="${grantedUser}"]`);
    await expect(li).toBeVisible({ timeout: 15_000 });
  },
);

// ── Namespace Access — BFF grant + cross-domain isolation read ──────────────

When(
  '{string} grants namespace access to a user via the BFF',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const grantedUser = `e2e-ns-${scenarioNonce()}@example.test`;
    scenarioState.uniqueNames.set('ns-user', grantedUser);
    const granted = await page.evaluate(
      async ([grantedUser]) => {
        const r = await fetch('/bff/admin/namespace-access', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: grantedUser, namespace: 'observability' }),
        });
        return { status: r.status };
      },
      [grantedUser] as const,
    );
    expect(granted.status, 'victim grant must succeed (200)').toBe(200);
  },
);

async function namespaceGrantUsersFor(username: string): Promise<string[]> {
  const page = pageOf(username);
  const read = await page.evaluate(async () => {
    const r = await fetch('/bff/admin/namespace-access', { credentials: 'include' });
    return { status: r.status, json: r.ok ? await r.json() : null };
  });
  expect(read.status).toBe(200);
  const grants = (read.json as { grants?: Array<{ user: string }> } | null)?.grants ?? [];
  return grants.map((g) => g.user);
}

Then(
  'the granted user does not appear in {string}\'s namespace grants list \\(via the BFF\\)',
  async ({ user }, username: string) => {
    const grantedUser = scenarioState.uniqueNames.get('ns-user');
    if (!grantedUser) throw new Error('No namespace grant created in this scenario.');
    const users = await namespaceGrantUsersFor(user(username).username);
    expect(users).not.toContain(grantedUser);
  },
);

Then(
  'the granted user appears in {string}\'s namespace grants list \\(via the BFF\\)',
  async ({ user }, username: string) => {
    const grantedUser = scenarioState.uniqueNames.get('ns-user');
    if (!grantedUser) throw new Error('No namespace grant created in this scenario.');
    const users = await namespaceGrantUsersFor(user(username).username);
    expect(users).toContain(grantedUser);
  },
);
