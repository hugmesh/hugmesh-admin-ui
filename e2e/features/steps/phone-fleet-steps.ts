// Phone-fleet console step definitions — the superadmin-only READ-ONLY MDM phone
// registry (phone-fleet.feature). The console has no write seam, so the steps here
// are pure observation:
//   - the list-honesty step re-reads the SAME live /bff/superadmin/phone-devices
//     list the console fetched (same-origin, the caller's HttpOnly bff_ cookie rides
//     the request) and holds the DOM to it — one row per reported phone, or the
//     explicit empty state when the fleet is empty. Both branches assert exactly
//     what the BFF reported, never a bare "element exists".
//   - the menu-item steps assert the superadminOnly nav split on the admin landing
//     view (admin.component.ts allMenu → [data-menu="<path>"] inside the admin-menu
//     nav). Generic on purpose — any superadmin-only item can reuse them.
// Session/navigation/guard steps are reused from session-steps.ts.

import { expect } from '@playwright/test';
import { Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

// ── Fleet-list honesty (DOM ↔ live BFF read) ────────────────────────────────

Then(
  'the phone fleet list mirrors the live phone-devices read for {string}',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    // The same live read the console performs (PhoneFleetComponent.load →
    // BffService.phones): same-origin fetch, credentials:'include' so the caller's
    // HttpOnly bff_ cookie rides it. A non-200 here fails the step loudly — the
    // component's fail-soft [] must never masquerade as an honest empty fleet.
    const phones: Array<{ deviceId: string }> = await page.evaluate(async () => {
      const r = await fetch('/bff/superadmin/phone-devices', { credentials: 'include' });
      if (!r.ok) throw new Error(`phone-devices read failed: ${r.status}`);
      const body = await r.json();
      return body.phones ?? [];
    });

    if (phones.length === 0) {
      // Zero ingested phones: the explicit empty state renders and the table
      // (mutually exclusive with it) does not.
      await expect(page.locator('[data-testid="pf-empty"]')).toBeVisible();
      await expect(page.locator('[data-testid="pf-table"]')).toHaveCount(0);
      return;
    }

    // Non-empty fleet: exactly one summary row per reported phone, each keyed by
    // the deviceId the BFF returned, and no empty state.
    await expect(page.locator('[data-testid="pf-table"] tbody tr.pf-row'))
      .toHaveCount(phones.length);
    for (const p of phones) {
      await expect(page.locator(`[data-phone-id="${p.deviceId}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-testid="pf-empty"]')).toHaveCount(0);
  },
);

// ── superadminOnly menu split on the admin landing view ─────────────────────

Then('{string} sees the {string} menu item', async ({ user }, username: string, path: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator(`[data-testid="admin-menu"] [data-menu="${path}"]`)).toBeVisible();
});

Then(
  '{string} does not see the {string} menu item',
  async ({ user }, username: string, path: string) => {
    const page = pageOf(user(username).username);
    // Assert against the RENDERED menu (not a blank page) so the absence is the
    // superadminOnly filter's verdict, never a failed render.
    await expect(page.locator('[data-testid="admin-menu"]')).toBeVisible();
    await expect(page.locator(`[data-testid="admin-menu"] [data-menu="${path}"]`)).toHaveCount(0);
  },
);
