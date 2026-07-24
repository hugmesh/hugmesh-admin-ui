// Step definitions backing features/admin/domain-capabilities.feature — the
// three-actor CAPABILITY GATE (DomainCapabilitiesComponent + admin-bff
// /bff/admin/domain-capabilities). A user may register a mesh radio only once a
// SUPERADMIN has GRANTED `user-mesh-devices` to their domain AND that domain's
// ADMIN has ENABLED it, with a platform-wide kill switch on the ' global' sentinel.
//
// Exact DENY statuses are the admin-bff's own documented contract (bff.service.ts
// lines 1139-1143, re-read against DomainCapabilityAdminController):
//   PUT .../{domain}/{capability}          {granted} — SUPERADMIN ONLY (ADMIN → 403)
//   PUT .../{domain}/{capability}/enabled  {enabled} — ADMIN own-domain only
//                                                        (another domain / ' global' → 403)
// so the cross-domain / role DENYs assert exactly 403 (never an OR).
//
// The console leg drives the REAL forms/toggles (never a fabricated echo); the
// BFF leg fires the same same-origin fetch the app fires (credentials:'include').

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, responseState } from './_registry';

/** The single capability this console manages (BffService.USER_MESH_DEVICES). */
const CAPABILITY = 'user-mesh-devices';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

// ── SUPERADMIN: grant a domain through the console (the ALLOW write) ──────────

When(
  '{string} grants the mesh-devices capability to domain {string} through the console',
  async ({ user }, username: string, domain: string) => {
    const page = pageOf(user(username).username);
    // The "grant a new domain" mini-form upserts the row for a domain that has no
    // row yet (PUT .../{domain}/{capability} {granted:true}); on reload the row appears.
    await page.locator('#dc-new-domain').fill(domain);
    await page.locator('.dc-grant-form button[type="submit"]').click();
  },
);

Then(
  '{string} sees domain {string} granted in the capabilities table',
  async ({ user }, username: string, domain: string) => {
    const page = pageOf(user(username).username);
    // The row is rendered from the reloaded BFF list, so its checked state IS the
    // server's `granted` verdict — not a local echo.
    const row = page.locator(`[data-domain-row="${domain}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.locator(`input[aria-label="Granted for ${domain}"]`)).toBeChecked();
    await expect(page.locator('[data-testid="dc-error"]')).toHaveCount(0);
  },
);

// ── ADMIN: the own-domain hint flip + enable (the ALLOW write) ───────────────

Then('{string} sees their own domain is not yet granted the capability', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // Before the superadmin grant: the explanatory hint renders and the enable
  // checkbox is disabled (an admin can never flip a switch with no server effect).
  await expect(page.locator('[data-testid="dc-own-domain"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="dc-not-granted-hint"]')).toBeVisible();
  await expect(page.locator('#dc-own-enabled')).toBeDisabled();
});

Then('{string} sees their own domain is now granted the capability', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // After the superadmin grant + a reload: the hint is gone and the enable
  // checkbox is now operable (granted=true).
  await expect(page.locator('[data-testid="dc-own-domain"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="dc-not-granted-hint"]')).toHaveCount(0);
  await expect(page.locator('#dc-own-enabled')).toBeEnabled();
});

When('{string} enables the capability for their own domain', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await page.locator('#dc-own-enabled').check();
});

Then('{string} sees the capability enabled for their own domain', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // toggleOwnEnabled() PUTs {enabled:true} then reloads; the checkbox reflects the
  // reloaded server row, so a checked box here is the BFF's stored `enabled` state.
  await expect(page.locator('#dc-own-enabled')).toBeChecked({ timeout: 15_000 });
  await expect(page.locator('[data-testid="dc-error"]')).toHaveCount(0);
});

// ── SUPERADMIN: platform-wide kill switch through the console ─────────────────

When('{string} turns the platform-wide kill switch off through the console', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const kill = page.locator(`[data-testid="dc-global-panel"] input[aria-label="Platform-wide ${CAPABILITY} kill switch"]`);
  await expect(kill).toBeVisible({ timeout: 15_000 });
  await kill.uncheck();
});

Then('{string} sees the platform-wide kill switch off', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // toggleGranted() on the sentinel PUTs {granted:false} then reloads; an unchecked
  // box here is the reloaded server state (server-side this suppresses the capability
  // for EVERY domain regardless of per-domain grants — enforcement is BFF-side).
  const kill = page.locator(`[data-testid="dc-global-panel"] input[aria-label="Platform-wide ${CAPABILITY} kill switch"]`);
  await expect(kill).not.toBeChecked({ timeout: 15_000 });
  await expect(page.locator('[data-testid="dc-error"]')).toHaveCount(0);
});

// ── Cross-domain / role DENYs (BFF, exact 403) ───────────────────────────────

When(
  '{string} attempts to enable the capability for domain {string} via the BFF',
  async ({ user }, username: string, domain: string) => {
    const page = pageOf(user(username).username);
    responseState.lastStatus = await page.evaluate(
      async ([domain, capability]) => {
        const r = await fetch(
          `/bff/admin/domain-capabilities/${encodeURIComponent(domain)}/${encodeURIComponent(capability)}/enabled`,
          {
            method: 'PUT',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: true }),
          },
        );
        return r.status;
      },
      [domain, CAPABILITY] as const,
    );
  },
);

When(
  '{string} attempts to grant the capability to domain {string} via the BFF',
  async ({ user }, username: string, domain: string) => {
    const page = pageOf(user(username).username);
    responseState.lastStatus = await page.evaluate(
      async ([domain, capability]) => {
        const r = await fetch(
          `/bff/admin/domain-capabilities/${encodeURIComponent(domain)}/${encodeURIComponent(capability)}`,
          {
            method: 'PUT',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ granted: true }),
          },
        );
        return r.status;
      },
      [domain, CAPABILITY] as const,
    );
  },
);
