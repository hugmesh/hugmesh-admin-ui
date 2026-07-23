// Step definitions backing features/admin/workload-hidden-tier.feature — the
// HIDDEN menu tier (admin.component.ts workloadVisible + workloadConsoleGuard).
// The Workload console is surfaced ONLY when a server-confirmed capability probe
// (GET /bff/admin/workloads/capability) passes, which happens once a SUPERADMIN
// has issued a live grant (POST /bff/superadmin/workloads/grants). This proves the
// causal loop nothing else covers: a grant makes the menu item + route appear for a
// specific admin mid-session, and a revoke makes the route bounce again.
//
// The guard denies an admin with no live grant by REDIRECTING TO /admin (not /login —
// the host-level adminGuard already passed; it is the grant that is missing), so the
// revoke assertion is a redirect-to-landing, distinct from the /login bounce the
// route-matrix uses for a non-admin.

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

/** The live grant id issued this scenario (captured from the POST response so the
 *  revoke targets the REAL server-issued grant, never a guess). Overwritten on each
 *  grant, read by the revoke — serial execution makes a module-global safe. */
let grantId: string | null = null;

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

When(
  '{string} grants the workload console to {string} via the BFF',
  async ({ user }, admin: string, granteeName: string) => {
    const page = pageOf(user(admin).username);
    const grantee = user(granteeName);
    const result = await page.evaluate(
      async ([grantee, targetDomain]) => {
        const r = await fetch('/bff/superadmin/workloads/grants', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ grantee, targetDomain, logAccess: false, ttlHours: 1 }),
        });
        return { status: r.status, json: r.ok ? await r.json() : null };
      },
      [grantee.username, grantee.domain ?? ''] as const,
    );
    // Honest ALLOW: the grant must really succeed and yield a real id — that id is
    // the oracle the revoke leg is measured against.
    expect(result.status, 'the workload grant must succeed (200)').toBe(200);
    const id = (result.json as { id?: string } | null)?.id;
    if (!id) throw new Error('workload grant returned no id — cannot run the grant/revoke loop');
    grantId = id;
  },
);

When('{string} revokes that workload console grant via the BFF', async ({ user }, admin: string) => {
  if (!grantId) throw new Error('No workload grant was issued in this scenario.');
  const page = pageOf(user(admin).username);
  const status = await page.evaluate(async ([id]) => {
    const r = await fetch(`/bff/superadmin/workloads/grants/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return r.status;
  }, [grantId] as const);
  expect(status, 'the workload grant revoke must succeed (200)').toBe(200);
});

Then('{string} is redirected to the admin landing page', async ({ user }, username: string) => {
  // DENY for an admin without a live grant: workloadConsoleGuard returns
  // parseUrl('/admin') (NOT /login — the admin IS an admin, they just lack the grant).
  const page = pageOf(user(username).username);
  await page.waitForURL((url) => url.pathname === '/admin', { timeout: 15_000 });
  await expect(page).toHaveURL(/\/admin(\?|$)/);
  await expect(page.locator('[data-testid="admin-view"]')).toBeVisible({ timeout: 15_000 });
});
