// SUPERADMIN fleet-provisioning step definitions (fleet-provisioning.feature). Two surfaces:
//   - owner ASSIGNMENT on the phone-fleet console (expand the first row, fill the physical-owner
//     + owner-domain inputs, click Assign owner, hold the DOM to the [data-testid="pf-owner"]
//     value the BFF returned);
//   - the Fleet entitlements console (fill the grant form, click Grant, hold the DOM to the new
//     [data-entitlement] row; Revoke removes it — the destructive revoke is confirm()-gated and
//     auto-accepted here).
//
// Session / navigation / guard / menu-split / API-DENY steps are reused from session-steps.ts +
// phone-fleet-steps.ts; only the provisioning-specific verbs live here.

import { expect, Page } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string): Page {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** The deviceId of the first rendered phone-fleet row. */
async function firstPhoneId(page: Page): Promise<string> {
  const first = page.locator('[data-testid="pf-table"] tbody tr.pf-row').first();
  await expect(first).toBeVisible({ timeout: 15_000 });
  const id = await first.getAttribute('data-phone-id');
  if (!id) throw new Error('first phone row has no data-phone-id');
  return id;
}

/** Expand a phone-fleet row's detail (idempotent). */
async function expandRow(page: Page, deviceId: string): Promise<void> {
  const detail = page.locator(`[data-phone-detail="${deviceId}"]`);
  if ((await detail.count()) === 0) {
    await page.locator(`[data-expand="${deviceId}"]`).click();
  }
  await expect(detail).toBeVisible({ timeout: 15_000 });
}

// ── Owner assignment (SUPERADMIN, on the phone-fleet console) ─────────────────

When(
  '{string} assigns the first phone to owner {string} in domain {string}',
  async ({ user }, username: string, owner: string, domain: string) => {
    const page = pageOf(user(username).username);
    const id = await firstPhoneId(page);
    await expandRow(page, id);
    await page.locator(`[data-owner-physical="${id}"]`).fill(owner);
    await page.locator(`[data-owner-domain="${id}"]`).fill(domain);
    await page.locator(`[data-owner-assign="${id}"]`).click();
    await expect(page.locator(`[data-phone-detail="${id}"] [data-testid="pf-owner"]`))
      .toContainText(owner, { timeout: 15_000 });
  },
);

Then('{string} sees the first phone owned by {string}', async ({ user }, username: string, owner: string) => {
  const page = pageOf(user(username).username);
  const id = await firstPhoneId(page);
  await expandRow(page, id);
  await expect(page.locator(`[data-phone-detail="${id}"] [data-testid="pf-owner"]`))
    .toContainText(owner, { timeout: 15_000 });
});

// ── Fleet entitlement grant / revoke (SUPERADMIN) ────────────────────────────

When('{string} grants a fleet entitlement to {string}', async ({ user }, username: string, subject: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="fe-subject"]').fill(subject);
  await page.locator('[data-testid="fe-grant"]').click();
  await expect(page.locator(`[data-entitlement="${subject}"]`)).toBeVisible({ timeout: 15_000 });
});

Then('{string} sees a fleet entitlement for {string}', async ({ user }, username: string, subject: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator(`[data-entitlement="${subject}"]`)).toBeVisible({ timeout: 15_000 });
});

When('{string} revokes the fleet entitlement for {string}', async ({ user }, username: string, subject: string) => {
  const page = pageOf(user(username).username);
  // The revoke is destructive — the component confirms via a native dialog. Auto-accept it.
  page.once('dialog', (d) => d.accept());
  await page.locator(`[data-revoke="${subject}"]`).click();
  await expect(page.locator(`[data-entitlement="${subject}"]`)).toHaveCount(0, { timeout: 15_000 });
});

Then('{string} sees no fleet entitlement for {string}', async ({ user }, username: string, subject: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator(`[data-entitlement="${subject}"]`)).toHaveCount(0);
});
