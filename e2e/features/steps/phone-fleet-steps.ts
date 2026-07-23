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

import { expect, Page } from '@playwright/test';
import { Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** The device-reported provider fields the wave-2 chip/Intune-id/asymmetry-note surface keys off. */
type ProviderRow = {
  deviceId: string;
  mdmProvider?: 'headwind' | 'azure-intune' | null;
  intuneDeviceId?: string | null;
  lockState?: 'unlocked' | 'locked' | null;
};

/** Re-read the SAME live superadmin registry the console fetched (same-origin, the caller's
 *  HttpOnly bff_ cookie rides it). A non-200 fails loudly — never a masquerading empty fleet. */
async function livePhones(page: Page): Promise<ProviderRow[]> {
  return page.evaluate(async () => {
    const r = await fetch('/bff/superadmin/phone-devices', { credentials: 'include' });
    if (!r.ok) throw new Error(`phone-devices read failed: ${r.status}`);
    return (await r.json()).phones ?? [];
  });
}

/** Expand a phone-fleet row's detail (idempotent). */
async function expandRow(page: Page, deviceId: string): Promise<void> {
  const detail = page.locator(`[data-phone-detail="${deviceId}"]`);
  if ((await detail.count()) === 0) {
    await page.locator(`[data-expand="${deviceId}"]`).click();
  }
  await expect(detail).toBeVisible({ timeout: 15_000 });
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

// ── Wave-2: co-equal Azure Intune MDM provider surface ──────────────────────

Then(
  '{string} sees the {string} provider chip and its Intune device id for an azure-reported phone',
  async ({ user }, username: string, label: string) => {
    const page = pageOf(user(username).username);
    const azure = (await livePhones(page)).find((p) => p.mdmProvider === 'azure-intune');
    if (!azure) throw new Error('no azure-intune phone in the live fleet to assert the Intune surface');
    await expandRow(page, azure.deviceId);
    const detail = page.locator(`[data-phone-detail="${azure.deviceId}"]`);
    const chip = detail.locator('[data-testid="pf-mdm-provider"]');
    await expect(chip).toHaveAttribute('data-mdm-provider', 'azure-intune');
    await expect(chip).toHaveText(label); // 'Azure Intune'
    // The Intune-device-id row renders ONLY for an azure phone; assert it against the BFF value.
    const intune = detail.locator('[data-testid="pf-intune-device-id"]');
    await expect(intune).toBeVisible();
    if (azure.intuneDeviceId) await expect(intune).toContainText(azure.intuneDeviceId);
  },
);

Then(
  '{string} sees the {string} provider chip and no Intune id for a headwind-reported phone',
  async ({ user }, username: string, label: string) => {
    const page = pageOf(user(username).username);
    // A null/unset provider is server-backfilled to 'headwind', so treat both as headwind.
    const headwind = (await livePhones(page)).find((p) => (p.mdmProvider ?? 'headwind') === 'headwind');
    if (!headwind) throw new Error('no headwind (default-provider) phone in the live fleet to assert the chip');
    await expandRow(page, headwind.deviceId);
    const detail = page.locator(`[data-phone-detail="${headwind.deviceId}"]`);
    const chip = detail.locator('[data-testid="pf-mdm-provider"]');
    await expect(chip).toHaveAttribute('data-mdm-provider', 'headwind');
    await expect(chip).toHaveText(label); // 'Headwind'
    // No Intune-device-id row and no unlock-asymmetry note for a non-azure phone.
    await expect(detail.locator('[data-testid="pf-intune-device-id"]')).toHaveCount(0);
    await expect(page.locator(`[data-azure-unlock-note="${headwind.deviceId}"]`)).toHaveCount(0);
  },
);

Then(
  '{string} sees the Azure unlock-asymmetry note for a locked azure-intune phone',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    // The note renders ONLY when the row is BOTH azure-intune AND locked.
    const lockedAzure = (await livePhones(page))
      .find((p) => p.mdmProvider === 'azure-intune' && p.lockState === 'locked');
    if (!lockedAzure) {
      throw new Error('no LOCKED azure-intune phone in the live fleet to assert the unlock-asymmetry note');
    }
    await expandRow(page, lockedAzure.deviceId);
    const note = page.locator(`[data-azure-unlock-note="${lockedAzure.deviceId}"]`);
    await expect(note).toBeVisible();
    await expect(note).toContainText('does not force-unlock the handset');
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
