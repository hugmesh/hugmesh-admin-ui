// Step definitions backing features/admin/egress-vpn-cross-domain.feature — the
// superadmin cross-domain WRITE gap (wave 3): a superadmin imports a VPN config
// into a brand that is NOT its own, and a scoped admin's identical attempt is
// denied outright. Same two write channels as functional-steps.ts:
//   - UI write: drives the real Egress-VPN console import form and proves the
//     outcome in the SAME view the operator sees (the ev-configs list re-renders
//     from EgressVpnController#importConfig's stored row).
//   - BFF write: the generic "{string} POSTs to {string} with body:" step in
//     session-steps.ts already covers the DENY leg — no bespoke step needed there.

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, scenarioState, scenarioNonce } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

// A real, parseable ProtonVPN WireGuard .conf — VpnConfigParser's own PROTON_WG
// fixture text. A malformed config 422s BEFORE the domain residency check ever
// runs, so a real import proves the domain write actually landed, not that
// validation was dodged.
const PROTON_WG = [
  '[Interface]',
  'PrivateKey = aGVsbG8td29ybGQtcHJpdmF0ZS1rZXktYmFzZTY0AA==',
  'Address = 10.2.0.2/32',
  'DNS = 10.2.0.1',
  '',
  '[Peer]',
  'PublicKey = cGVlci1wdWJsaWMta2V5LWJhc2U2NC1oZXJlAAAAAAA=',
  'AllowedIPs = 0.0.0.0/0',
  'Endpoint = 185.159.157.1:51820',
].join('\n');

// ── Egress VPN — UI import into a foreign domain (the superadmin ALLOW write) ──

When(
  '{string} imports a VPN config for domain {string} through the console',
  async ({ user }, username: string, domain: string) => {
    const page = pageOf(user(username).username);
    // Uniquify so a repeat run against a live stack cannot collide on a stale
    // (domain, name) active row (EgressVpnService#performImportConfig is
    // idempotent on that pair).
    const name = `e2e-egress-${scenarioNonce()}`;
    scenarioState.uniqueNames.set('egress-vpn-config', name);
    await page.locator('[data-testid="ev-import-domain"]').fill(domain);
    await page.locator('[data-testid="ev-import-name"]').fill(name);
    await page.locator('[data-testid="ev-import-provider"]').fill('protonvpn');
    await page.locator('[data-testid="ev-import-config"]').fill(PROTON_WG);
    await page.locator('[data-testid="ev-import"]').click();
  },
);

Then(
  '{string} sees the imported config for domain {string} in the configs list',
  async ({ user }, username: string, domain: string) => {
    const page = pageOf(user(username).username);
    const name = scenarioState.uniqueNames.get('egress-vpn-config');
    if (!name) throw new Error('No VPN config imported in this scenario.');
    // Honest ALLOW: only passes when the POST truly landed a server row STAMPED
    // with the TYPED (non-own) domain — the list renders straight off
    // EgressVpnComponent's reload(), i.e. the BFF's own stored VpnConfigRow, the
    // same evidence the operator sees.
    const row = page.locator(`[data-testid="ev-configs"] li[data-config-id]`).filter({ hasText: name });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(`domain: ${domain}`);
    await expect(row.locator('[data-config-state="active"]')).toBeVisible();
    await expect(page.locator('[data-testid="ev-import-error"]')).toHaveCount(0);
  },
);
