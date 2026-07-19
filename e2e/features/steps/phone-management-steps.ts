// Phone device-management + lockout step definitions — the superadmin WRITE seam on the
// phone-fleet console (phone-management.feature). Unlike the read-only phone-fleet steps,
// these drive the REAL console controls (mark-managed / lock buttons, the inline lock-reason
// input) and hold the DOM to the AUTHORITATIVE chip the BFF returned — the [data-management]
// and [data-lock-state] chips the component swaps in on a successful mutation. The destructive
// lock is gated by a native confirm(); the lock step auto-accepts it (a step-up 403 would open
// the inline MFA dialog, but these @cluster scenarios ship dark and are not run live).
//
// Session / navigation / guard / API-DENY steps are reused from session-steps.ts +
// functional-steps.ts; only the phone-management-specific verbs live here.

import { expect, Page } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string): Page {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** The deviceId of the first rendered fleet row (the BFF's newest-ingest-first ordering). */
async function firstPhoneId(page: Page): Promise<string> {
  const first = page.locator('[data-testid="pf-table"] tbody tr.pf-row').first();
  await expect(first).toBeVisible({ timeout: 15_000 });
  const id = await first.getAttribute('data-phone-id');
  if (!id) throw new Error('first phone row has no data-phone-id');
  return id;
}

/** Expand a row's detail (idempotent — only clicks the toggle when it is not already open). */
async function expandRow(page: Page, deviceId: string): Promise<void> {
  const detail = page.locator(`[data-phone-detail="${deviceId}"]`);
  if ((await detail.count()) === 0) {
    await page.locator(`[data-expand="${deviceId}"]`).click();
  }
  await expect(detail).toBeVisible({ timeout: 15_000 });
}

// ── Management promotion (BYOD → managed) ────────────────────────────────────

When('{string} marks the first phone managed', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const id = await firstPhoneId(page);
  await expandRow(page, id);
  // If the phone is already managed the Mark-managed button is absent (Clear-managed shows
  // instead) — nothing to click; the chip assertion below still holds it to managed.
  const mark = page.locator(`[data-mark-managed="${id}"]`);
  if ((await mark.count()) > 0) {
    await mark.click();
  }
  await expect(page.locator(`[data-phone-id="${id}"] [data-management="mesh_owned"]`))
    .toBeVisible({ timeout: 15_000 });
});

Then('{string} sees the first phone reported as managed', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const id = await firstPhoneId(page);
  await expect(page.locator(`[data-phone-id="${id}"] [data-management="mesh_owned"]`))
    .toBeVisible({ timeout: 15_000 });
});

// ── Lockout (managed device) ─────────────────────────────────────────────────

When(
  '{string} locks the first phone with reason {string}',
  async ({ user }, username: string, reason: string) => {
    const page = pageOf(user(username).username);
    const id = await firstPhoneId(page);
    await expandRow(page, id);
    // The lock is destructive — the component confirms via a native dialog. Auto-accept it.
    page.once('dialog', (d) => d.accept());
    await page.locator(`[data-lock-reason="${id}"]`).fill(reason);
    await page.locator(`[data-lock-action="${id}"]`).click();
    await expect(page.locator(`[data-phone-id="${id}"] [data-lock-state="locked"]`))
      .toBeVisible({ timeout: 15_000 });
  },
);

Then('{string} sees the first phone reported as locked', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const id = await firstPhoneId(page);
  await expect(page.locator(`[data-phone-id="${id}"] [data-lock-state="locked"]`))
    .toBeVisible({ timeout: 15_000 });
});

// ── BYOD not-lockable (disabled + helper) ────────────────────────────────────

Then(
  '{string} sees the lock control disabled for an unmanaged phone',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    // Find a BYOD (unmanaged) row by its management chip, then read its row's device id.
    const rows = page.locator('[data-testid="pf-table"] tbody tr.pf-row');
    const count = await rows.count();
    let byodId: string | null = null;
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      if ((await row.locator('[data-management="unmanaged"]').count()) > 0) {
        byodId = await row.getAttribute('data-phone-id');
        break;
      }
    }
    if (!byodId) throw new Error('no unmanaged (BYOD) phone row found to assert the disabled lock control');
    await expandRow(page, byodId);
    // The component disables the Lock button for a BYOD device and shows the not-lockable helper.
    await expect(page.locator(`[data-lock-action="${byodId}"]`)).toBeDisabled();
    await expect(page.locator(`[data-lock-help="${byodId}"]`)).toBeVisible();
  },
);
