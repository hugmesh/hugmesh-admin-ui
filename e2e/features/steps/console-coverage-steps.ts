// EVERY-FUNCTION coverage step definitions — the previously-uncovered admin
// consoles: the Gateway-access rule editor (route-access), the Node-storage
// console (storage-pools), the read-only / infra-gated surfaces (usage, ISO
// downloads, ArgoCD, Backup, Recovery) and the Pending-devices pick-list.
//
// Two honesty lanes, matching the harness's split:
//   - @offline steps assert PURE CLIENT-SIDE behaviour reachable with NO backend
//     (form validation, a client-side heuristic warning, an empty/degraded state,
//     a disabled control). They run against `ng serve admin` (the standalone dev
//     shell mounts ADMIN_ROUTES at the root — see src/app/app.routes.ts) with
//     E2E_BASE_URL pointing at it; every assertion is a REAL observable state
//     change that fails against a blank page (never a bare "element exists").
//   - @cluster steps drive the REAL BFF write/gate (add/remove a gateway rule;
//     the role-DENY POSTs) and reuse the generic `POSTs to … / response status`
//     steps in session-steps.ts where possible.
//
// No component was modified: every data-testid referenced here already exists on
// the real control in the component template (verified against src/app/**).

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, scenarioState, scenarioNonce } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

// ── Gateway access (route-access) — client-side validation (offline) ─────────

When(
  '{string} submits the gateway-access form with a blank URL pattern',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    // The pattern field defaults to empty; clear it explicitly so the intent is
    // unmistakable, then submit. RouteAccessComponent.add() short-circuits with a
    // formError BEFORE any BFF call when the pattern is blank — pure client-side.
    await page.locator('[data-testid="ra-pattern"]').fill('');
    await page.locator('[data-testid="ra-add"]').click();
  },
);

Then(
  '{string} sees the gateway-access validation error',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const err = page.locator('[data-testid="ra-error"]');
    await expect(err).toBeVisible();
    await expect(err).toContainText('URL pattern and a role are required');
    // The field flips aria-invalid — the a11y half of the validation contract.
    await expect(page.locator('[data-testid="ra-pattern"]')).toHaveAttribute('aria-invalid', 'true');
    // And nothing was persisted: the client-side gate blocked the write, so the
    // rules table has no rows.
    await expect(page.locator('[data-testid="route-access-rules"] tbody tr')).toHaveCount(0);
  },
);

// ── Gateway access (route-access) — real add / remove write (@cluster) ───────

When(
  '{string} adds a gateway-access rule through the console',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const pattern = `/api/e2e-${scenarioNonce()}/**`;
    scenarioState.uniqueNames.set('ra-pattern', pattern);
    await page.locator('[data-testid="ra-pattern"]').fill(pattern);
    await page.locator('[data-testid="ra-role"]').fill('ROLE_ADMIN');
    await page.locator('[data-testid="ra-add"]').click();
  },
);

Then(
  'the gateway-access rule appears in {string}\'s rules table',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const pattern = scenarioState.uniqueNames.get('ra-pattern');
    if (!pattern) throw new Error('No gateway-access rule added in this scenario.');
    // The row is rendered from the SERVER's response (add() re-sets rules() to the
    // BFF payload), and each row carries the server-issued data-rule-id.
    const row = page.locator('[data-testid="route-access-rules"] tbody tr', { hasText: pattern });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await expect(row).toHaveAttribute('data-rule-id', /.+/);
    await expect(page.locator('[data-testid="ra-error"]')).toHaveCount(0);
  },
);

When(
  '{string} removes that gateway-access rule',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const pattern = scenarioState.uniqueNames.get('ra-pattern');
    if (!pattern) throw new Error('No gateway-access rule added in this scenario.');
    const row = page.locator('[data-testid="route-access-rules"] tbody tr', { hasText: pattern });
    await row.locator('button[data-remove]').click();
  },
);

Then(
  'the gateway-access rule no longer appears in {string}\'s rules table',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const pattern = scenarioState.uniqueNames.get('ra-pattern');
    if (!pattern) throw new Error('No gateway-access rule added in this scenario.');
    await expect(
      page.locator('[data-testid="route-access-rules"] tbody tr', { hasText: pattern }),
    ).toHaveCount(0, { timeout: 15_000 });
  },
);

// ── Node storage (storage-pools) — client-side heuristic + validation (offline)

When(
  '{string} enters a database-shaped service name in the assign form',
  async ({ user }, username: string) => {
    // "postgres-primary" hits StoragePoolsComponent.assignWarning()'s stateful-name
    // heuristic — a PURE client-side computation re-run on every ngModel change.
    await pageOf(user(username).username).locator('[data-testid="sp-service"]').fill('postgres-primary');
  },
);

Then(
  '{string} sees the node-pinned no-HA storage warning',
  async ({ user }, username: string) => {
    const warn = pageOf(user(username).username).locator('[data-testid="sp-assign-warning"]');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText('NO HA');
    // Announced politely (a non-error advisory), not an error alert.
    await expect(warn).toHaveAttribute('role', 'status');
  },
);

When(
  '{string} submits the attach-pool form with blank fields',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    // Disk serial + node-local path are empty by default → attach() short-circuits
    // with attachError BEFORE any BFF call.
    await page.locator('[data-testid="sp-disk"]').fill('');
    await page.locator('[data-testid="sp-path"]').fill('');
    await page.locator('[data-testid="sp-attach"]').click();
  },
);

Then(
  '{string} sees the attach-pool validation error',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const err = page.locator('[data-testid="sp-attach-error"]');
    await expect(err).toBeVisible();
    await expect(err).toContainText('disk serial');
    await expect(page.locator('[data-testid="sp-disk"]')).toHaveAttribute('aria-invalid', 'true');
    // No pool row was created (the client-side gate blocked the write).
    await expect(page.locator('[data-testid="sp-pools"] li[data-pool-id]')).toHaveCount(0);
  },
);

// ── Read-only / infra-gated consoles — honest offline states (offline) ───────

Then(
  '{string} sees the usage dashboard with default figures',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    // With no BFF the usage() signal stays null and the template renders its
    // defaults — a REAL render (the figures + both breakdown tables), not a spinner.
    await expect(page.locator('[data-testid="usage-active"]')).toHaveText('0');
    await expect(page.locator('[data-testid="usage-total"]')).toHaveText('0');
    await expect(page.locator('[data-testid="usage-by-module"]')).toBeVisible();
    await expect(page.locator('[data-testid="usage-by-action"]')).toBeVisible();
  },
);

Then(
  '{string} sees the ISO downloads empty state',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const empty = page.locator('[data-testid="iso-empty"]');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No ISO builds delivered yet');
    // The empty state is mutually exclusive with any listed download.
    await expect(page.locator('[data-testid="iso-list"] li[data-iso]')).toHaveCount(0);
  },
);

Then(
  '{string} sees the recovery empty state',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const empty = page.locator('[data-testid="recovery-empty"]');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No completed backups available to restore');
    // With nothing to select, the restore form is not rendered.
    await expect(page.locator('[data-testid="recovery-form"]')).toHaveCount(0);
  },
);

Then(
  '{string} sees the {string} capability-gate notice',
  async ({ user }, username: string, capability: string) => {
    const page = pageOf(user(username).username);
    const gate = page.locator(`[data-testid="capability-gate"][data-capability="${capability}"]`);
    await expect(gate).toBeVisible();
    // Degraded-state banner: announced politely with an explicit accessible name.
    await expect(gate).toHaveAttribute('role', 'status');
    const name = await gate.getAttribute('aria-label');
    expect(name && name.length > 0).toBe(true);
  },
);

Then(
  'the {string} action is not rendered for {string}',
  async ({ user }, testid: string, username: string) => {
    // The capability-gate degrades the console: its write/action surface is
    // SUPPRESSED (not merely disabled) while the foundational infra is absent.
    await expect(pageOf(user(username).username).locator(`[data-testid="${testid}"]`)).toHaveCount(0);
  },
);

// ── Pending devices (device-pending) — disabled register control (offline) ───

Then(
  '{string} sees the register control disabled with no assignable node',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const register = page.locator('[data-testid="dp-register"]');
    await expect(register).toBeVisible();
    // [disabled]="!selectedFp" — with no enrolled/unregistered node there is
    // nothing selected, so the register action is disabled.
    await expect(register).toBeDisabled();
    // …and the read-only opaque-fingerprint display shows its placeholder.
    await expect(page.locator('[data-testid="dp-fp-value"]')).toHaveText('—');
  },
);
