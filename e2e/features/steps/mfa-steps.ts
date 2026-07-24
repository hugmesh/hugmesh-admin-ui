// Step definitions backing features/admin/mfa-security.feature — the self-service
// MFA console (MfaSecurityComponent, mfa-security-view) and the shared inline
// step-up dialog (MfaStepUpDialogComponent, mfa-stepup-dialog) every privileged
// console leans on. Covers three things nothing else does:
//   1. cross-user FACTOR ISOLATION — the admin-bff owner scope ("a caller only ever
//      sees/mutates their OWN factors", derived from the session subject, never a body
//      field) — victim-creates-first: a real enrolled factor in one context is invisible
//      in another. No TOTP needed (enroll alone creates the pending factor).
//   2. the DARK default-stack reality (app.casdoor.mfa.enabled=false → 503 → the
//      console shows "not enabled yet").
//   3. the step-up-gated remove + regenerate JOURNEY through the shared dialog, with a
//      REAL RFC-6238 code (tests/helpers/totp.ts) — the enabled-feature path.
//
// All @cluster (a live Casdoor + admin-bff); ships dark. The step-up/enroll journey
// additionally needs app.casdoor.mfa.enabled=true (noted on its scenario).

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';
import { totp } from '../../tests/helpers/totp';

/** Per-username enrolled-factor state captured this scenario: the real server
 *  factorId (the isolation oracle) + the base32 secret (to compute step-up codes).
 *  Serial execution + per-username keys keep two identities' factors distinct. */
const enrolled = new Map<string, { factorId: string; secret: string }>();

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** GET the caller's OWN factor ids, as that user (their bff_ cookie rides the call). */
async function factorIdsFor(username: string): Promise<string[]> {
  const page = pageOf(username);
  const read = await page.evaluate(async () => {
    const r = await fetch('/bff/mfa/factors', { credentials: 'include' });
    return { status: r.status, json: r.ok ? await r.json() : null };
  });
  expect(read.status, 'MFA factor list read must succeed (200) on an enabled deployment').toBe(200);
  const factors = (read.json as { factors?: Array<{ id: string }> } | null)?.factors ?? [];
  return factors.map((f) => f.id);
}

// ── 1. cross-user factor isolation (enroll creates the pending factor; no TOTP) ──

When('{string} starts TOTP enrollment via the BFF', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const res = await page.evaluate(async () => {
    const r = await fetch('/bff/mfa/enroll/totp', { method: 'POST', credentials: 'include' });
    return { status: r.status, json: r.ok ? await r.json() : null };
  });
  expect(res.status, 'starting TOTP enrollment must succeed (200) on an enabled deployment').toBe(200);
  const body = res.json as { factorId?: string; secret?: string } | null;
  if (!body?.factorId || !body?.secret) {
    throw new Error('enroll/totp returned no factorId/secret — cannot run the isolation oracle');
  }
  enrolled.set(user(username).username, { factorId: body.factorId, secret: body.secret });
});

Then("{string}'s factor list contains their enrolled factor", async ({ user }, username: string) => {
  const mine = enrolled.get(user(username).username);
  if (!mine) throw new Error(`No factor was enrolled for "${username}" in this scenario.`);
  expect(await factorIdsFor(user(username).username)).toContain(mine.factorId);
});

Then(
  "{string}'s factor list does not contain {string}'s enrolled factor",
  async ({ user }, observer: string, victim: string) => {
    const victimFactor = enrolled.get(user(victim).username);
    if (!victimFactor) throw new Error(`No factor was enrolled for "${victim}" in this scenario.`);
    // The observer reads THEIR OWN list (their bff_ cookie): the victim's real
    // factorId must never appear — the owner-scope isolation the BFF claims.
    expect(await factorIdsFor(user(observer).username)).not.toContain(victimFactor.factorId);
  },
);

// ── 2. dark default-stack reality ────────────────────────────────────────────

Then('{string} sees the MFA console dark state', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="mfa-security-dark"]')).toBeVisible({ timeout: 15_000 });
});

// ── 3. enabled-feature enroll + step-up-gated remove/regenerate journey ───────

When('{string} enrolls and verifies a TOTP factor via the BFF', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const start = await page.evaluate(async () => {
    const r = await fetch('/bff/mfa/enroll/totp', { method: 'POST', credentials: 'include' });
    return { status: r.status, json: r.ok ? await r.json() : null };
  });
  expect(start.status, 'enroll/totp must succeed (200)').toBe(200);
  const body = start.json as { factorId?: string; secret?: string } | null;
  if (!body?.factorId || !body?.secret) throw new Error('enroll/totp returned no factorId/secret');
  // Compute the current code from the server's REAL secret (never a hard-coded passcode).
  const passcode = totp(body.secret);
  const verifyStatus = await page.evaluate(async (code) => {
    const r = await fetch('/bff/mfa/enroll/totp/verify', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passcode: code }),
    });
    return r.status;
  }, passcode);
  // NOTE: this evaluate resolves to the bare status NUMBER (not a {status} object
  // like the enroll call above), so the assertion must read it directly.
  expect(verifyStatus, 'verify must enable the pending factor (200)').toBe(200);
  enrolled.set(user(username).username, { factorId: body.factorId, secret: body.secret });
});

Then('{string} sees their enrolled TOTP factor in the list', async ({ user }, username: string) => {
  const mine = enrolled.get(user(username).username);
  if (!mine) throw new Error(`No factor was enrolled for "${username}" in this scenario.`);
  const page = pageOf(user(username).username);
  await expect(page.locator(`[data-testid="mfa-factor-list"] [data-factor="${mine.factorId}"]`))
    .toBeVisible({ timeout: 15_000 });
});

When('{string} removes their TOTP factor', async ({ user }, username: string) => {
  const mine = enrolled.get(user(username).username);
  if (!mine) throw new Error(`No factor was enrolled for "${username}" in this scenario.`);
  const page = pageOf(user(username).username);
  await page.locator(`[data-factor="${mine.factorId}"] [data-testid="mfa-factor-remove"]`).click();
});

Then('{string} sees the MFA step-up dialog', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // The dialog appears mid-action ONLY after the mutation 403s "needs step-up".
  await expect(page.locator('[data-testid="mfa-stepup-dialog"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="mfa-stepup-intro"]')).toBeVisible();
});

When('{string} satisfies the step-up with their authenticator code', async ({ user }, username: string) => {
  const mine = enrolled.get(user(username).username);
  if (!mine) throw new Error(`No factor was enrolled for "${username}" in this scenario.`);
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="mfa-stepup-method-totp"]').check();
  // Fresh code from the enrolled factor's real secret.
  await page.locator('[data-testid="mfa-stepup-code"]').fill(totp(mine.secret));
  await page.locator('[data-testid="mfa-stepup-submit"]').click();
});

Then('{string} no longer sees their TOTP factor in the list', async ({ user }, username: string) => {
  const mine = enrolled.get(user(username).username);
  if (!mine) throw new Error(`No factor was enrolled for "${username}" in this scenario.`);
  const page = pageOf(user(username).username);
  // Step-up satisfied → the component retries the remove → the row disappears and the
  // dialog closes. Both are the successful-remove evidence.
  await expect(page.locator(`[data-factor="${mine.factorId}"]`)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('[data-testid="mfa-stepup-dialog"]')).toHaveCount(0);
});

When('{string} regenerates their recovery codes', async ({ user }, username: string) => {
  await pageOf(user(username).username).locator('[data-testid="mfa-security-regenerate"]').click();
});

Then('{string} sees a fresh set of one-time recovery codes', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // The one-time set renders only after the step-up-gated regenerate returns the codes.
  await expect(page.locator('[data-testid="mfa-new-recovery"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="mfa-new-recovery-codes"] li').first()).toBeVisible();
});
