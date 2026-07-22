// FLEET-OWNER "My fleet" step definitions (my-fleet.feature). The PUBLIC /bff/admin/phone-fleet
// plane where a non-superadmin FLEET_ADMIN manages ONLY their own owned phones. These drive the
// REAL console controls (the lock-reason input, Lock/Unlock buttons) and hold the DOM to the
// authoritative [data-lock-state] chip the BFF returned. The list-honesty step re-reads the SAME
// live owned read the console fetched. The lock is gated by a native confirm(); the step
// auto-accepts it.
//
// Session / navigation / guard / API-DENY steps are reused from session-steps.ts; only the
// my-fleet-specific verbs live here.

import { expect, Page } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string): Page {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** The deviceId of the first rendered owned-fleet row. */
async function firstOwnedId(page: Page): Promise<string> {
  const first = page.locator('[data-testid="mf-table"] tbody tr.mf-row').first();
  await expect(first).toBeVisible({ timeout: 15_000 });
  const id = await first.getAttribute('data-phone-id');
  if (!id) throw new Error('first owned phone row has no data-phone-id');
  return id;
}

/** Expand an owned row's detail (idempotent). */
async function expandOwned(page: Page, deviceId: string): Promise<void> {
  const detail = page.locator(`[data-phone-detail="${deviceId}"]`);
  if ((await detail.count()) === 0) {
    await page.locator(`[data-expand="${deviceId}"]`).click();
  }
  await expect(detail).toBeVisible({ timeout: 15_000 });
}

// ── Fleet-list honesty (DOM ↔ live owned BFF read) ──────────────────────────

Then(
  'the my fleet list mirrors the live owned phone-fleet read for {string}',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    // The same live read the console performs (MyFleetComponent.load → BffService.ownedPhones):
    // same-origin fetch, credentials:'include' so the caller's HttpOnly bff_ cookie rides it. A
    // non-200 fails the step loudly — the component's fail-soft [] must never masquerade as an
    // honest empty fleet.
    const phones: Array<{ deviceId: string }> = await page.evaluate(async () => {
      const r = await fetch('/bff/admin/phone-fleet', { credentials: 'include' });
      if (!r.ok) throw new Error(`owned phone-fleet read failed: ${r.status}`);
      const body = await r.json();
      return body.phones ?? [];
    });

    if (phones.length === 0) {
      await expect(page.locator('[data-testid="mf-empty"]')).toBeVisible();
      await expect(page.locator('[data-testid="mf-table"]')).toHaveCount(0);
      return;
    }
    await expect(page.locator('[data-testid="mf-table"] tbody tr.mf-row')).toHaveCount(phones.length);
    for (const p of phones) {
      await expect(page.locator(`[data-phone-id="${p.deviceId}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-testid="mf-empty"]')).toHaveCount(0);
  },
);

// ── Lock / unlock (own managed device) ───────────────────────────────────────

When(
  '{string} locks the first owned phone with reason {string}',
  async ({ user }, username: string, reason: string) => {
    const page = pageOf(user(username).username);
    const id = await firstOwnedId(page);
    await expandOwned(page, id);
    page.once('dialog', (d) => d.accept());
    await page.locator(`[data-lock-reason="${id}"]`).fill(reason);
    await page.locator(`[data-lock-action="${id}"]`).click();
    await expect(page.locator(`[data-phone-id="${id}"] [data-lock-state="locked"]`))
      .toBeVisible({ timeout: 15_000 });
  },
);

Then('{string} sees the first owned phone reported as locked', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const id = await firstOwnedId(page);
  await expect(page.locator(`[data-phone-id="${id}"] [data-lock-state="locked"]`))
    .toBeVisible({ timeout: 15_000 });
});

When('{string} unlocks the first owned phone', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const id = await firstOwnedId(page);
  await expandOwned(page, id);
  await page.locator(`[data-unlock-action="${id}"]`).click();
  await expect(page.locator(`[data-phone-id="${id}"] [data-lock-state="unlocked"]`))
    .toBeVisible({ timeout: 15_000 });
});

Then('{string} sees the first owned phone reported as unlocked', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const id = await firstOwnedId(page);
  await expect(page.locator(`[data-phone-id="${id}"] [data-lock-state="unlocked"]`))
    .toBeVisible({ timeout: 15_000 });
});

// ── BYOD not-lockable (disabled + helper) ────────────────────────────────────

Then(
  '{string} sees the lock control disabled for an unmanaged owned phone',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const rows = page.locator('[data-testid="mf-table"] tbody tr.mf-row');
    const count = await rows.count();
    let byodId: string | null = null;
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      if ((await row.locator('[data-management="unmanaged"]').count()) > 0) {
        byodId = await row.getAttribute('data-phone-id');
        break;
      }
    }
    if (!byodId) throw new Error('no unmanaged (BYOD) owned phone row found to assert the disabled lock control');
    await expandOwned(page, byodId);
    await expect(page.locator(`[data-lock-action="${byodId}"]`)).toBeDisabled();
    await expect(page.locator(`[data-lock-help="${byodId}"]`)).toBeVisible();
  },
);

// ── No superadmin provisioning affordance on the fleet-owner surface ─────────

Then(
  '{string} sees no owner-assignment or mark-managed control on the My fleet console',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const id = await firstOwnedId(page);
    await expandOwned(page, id);
    // Mark-managed and owner-assignment are SUPERADMIN provisioning — they must NOT exist here.
    await expect(page.locator('[data-owner-assign]')).toHaveCount(0);
    await expect(page.locator('[data-mark-managed]')).toHaveCount(0);
    await expect(page.locator('[data-clear-managed]')).toHaveCount(0);
  },
);
