// Step definitions backing features/admin/desktop-governance.feature — the
// Desktop-governance console's client-side gates (@offline) and the admin-bff
// role matrix behind its terminal / sudo / remote-install legs (@cluster).
//
// The console's "open terminal" / "grant sudo" buttons bind [disabled] and an
// aria-describedby pointing at their role=status gate help, but NOT
// aria-disabled — so the shared `sees the {string} control disabled` step (which
// demands aria-disabled="true") cannot be reused here; the desktop-control step
// below asserts the contract those buttons actually carry.
//
// The remote-install rows need the RESPONSE HEADER, not just the status: the
// A5 step-up gate answers 403 + `X-Step-Up-Required: X-Device-Terminal-StepUp`
// (admin-bff StepUpRequiredException + ApiExceptionHandler), which is what
// tells an admin's refusal apart from a mod's bare role 403 at the same status.

import { expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry, responseState } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** The last header-capturing request: status + the step-up signal, or null. */
const captured = { status: 0, signal: null as string | null };

// ── @offline: tabs and gate state ─────────────────────────────────────────

Given('the desktop dial-capability probe answers dark for {string}', async ({ user }, username: string) => {
  // GET /bff/superadmin/desktop/dials → 503, exactly what admin-bff answers while the
  // dial leg ships dark (desktopDialCapability() hides the tab on anything but r.ok).
  await pageOf(user(username).username).route('**/bff/superadmin/desktop/dials', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'dial leg is dark' }) }));
});

When('{string} opens the {string} desktop tab', async ({ user }, username: string, testid: string) => {
  const page = pageOf(user(username).username);
  const tab = page.locator(`[data-testid="${testid}"]`);
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
});

Then('{string} sees the {string} desktop tab', async ({ user }, username: string, testid: string) => {
  const page = pageOf(user(username).username);
  const tab = page.locator(`[data-testid="${testid}"]`);
  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute('role', 'tab');
});

Then('{string} sees no {string} desktop tab', async ({ user }, username: string, testid: string) => {
  // The tab nav has rendered (the caller asserted the console view, and the
  // sibling tab above), so a zero count is a settled negative, not a not-yet.
  const page = pageOf(user(username).username);
  await expect(page.locator('nav.dg-tabs [role="tab"]').first()).toBeVisible();
  await expect(page.locator(`[data-testid="${testid}"]`)).toHaveCount(0);
});

Then(
  'the {string} desktop control is disabled for {string} with the gate help {string} saying {string}',
  async ({ user }, controlId: string, username: string, helpId: string, text: string) => {
    const page = pageOf(user(username).username);
    const control = page.locator(`[data-testid="${controlId}"]`);
    await expect(control).toBeVisible();
    await expect(control).toBeDisabled();
    // The a11y half of the gate: the disabled control is DESCRIBED BY the help
    // span, whose id is the help testid (dst-gate-help / ds-gate-help).
    await expect(control).toHaveAttribute('aria-describedby', helpId);
    const help = page.locator(`[data-testid="${helpId}"]`);
    await expect(help).toBeVisible();
    await expect(help).toHaveAttribute('role', 'status');
    await expect(help).toHaveText(text);
  },
);

// ── @cluster: the BFF matrix ──────────────────────────────────────────────

When('{string} DELETEs {string}', async ({ user }, username: string, path: string) => {
  // A REAL DELETE, same-origin, credentials:'include' so the caller's HttpOnly
  // bff_ cookie rides the request — the authz chain is the only gate under test.
  const page = pageOf(user(username).username);
  responseState.lastStatus = await page.evaluate(async (url) => {
    const r = await fetch(url, { method: 'DELETE', credentials: 'include' });
    return r.status;
  }, path);
});

When(
  '{string} POSTs to {string} capturing the step-up signal with body:',
  async ({ user }, username: string, path: string, body: string) => {
    const page = pageOf(user(username).username);
    const r = await page.evaluate(
      async ([url, payload]) => {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
        return { status: res.status, signal: res.headers.get('X-Step-Up-Required') };
      },
      [path, body] as const,
    );
    captured.status = r.status;
    captured.signal = r.signal;
    responseState.lastStatus = r.status;
  },
);

Then('the captured response was a 403 carrying the step-up signal {string}', async ({}, flavour: string) => {
  expect(captured.status, 'status of the captured response').toBe(403);
  expect(captured.signal, 'X-Step-Up-Required on the captured response').toBe(flavour);
});

Then('the captured response was a 403 without any step-up signal', async ({}) => {
  expect(captured.status, 'status of the captured response').toBe(403);
  expect(captured.signal, 'X-Step-Up-Required must be absent on a role refusal').toBeNull();
});
