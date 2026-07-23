// Step definitions backing features/admin/device-radios.feature — the Device radios
// console (device-radios.component.ts, device-radios-view). ADMIN-capable (NOT
// superadmin), so the BFF (/bff/admin/device-radios/**) is the real gate. Two lanes:
//   - @offline — the per-transport form shape (the picker shows EXACTLY the selected
//     transport's fields, a mixed shape being a BFF 422) and the client-side blank
//     validation (attach() short-circuits with a role=alert before any BFF call). Pure
//     client behaviour, runs on `ng serve admin`.
//   - @cluster — the URL-gate DENY: a mod (sibling role, not ADMIN) attaching a radio
//     dies at /bff/admin/** with a bean-valid body, so the 403 is the authz verdict.

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

/** testid of the field each transport MUST show, and the fields it must NOT show. */
const TRANSPORT_FIELDS: Record<string, { present: string[]; absent: string[] }> = {
  serial: { present: ['dr-serial-path'], absent: ['dr-host', 'dr-topic-root'] },
  tcp: { present: ['dr-host', 'dr-port'], absent: ['dr-serial-path', 'dr-topic-root'] },
  mqtt: { present: ['dr-host', 'dr-port', 'dr-topic-root', 'dr-channel-name'], absent: ['dr-serial-path'] },
};

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

When('{string} selects the {string} radio transport', async ({ user }, username: string, transport: string) => {
  await pageOf(user(username).username).locator('[data-testid="dr-transport"]').selectOption(transport);
});

Then('{string} sees only the {string} radio transport fields', async ({ user }, username: string, transport: string) => {
  const spec = TRANSPORT_FIELDS[transport];
  if (!spec) throw new Error(`Unknown transport "${transport}".`);
  const page = pageOf(user(username).username);
  for (const id of spec.present) {
    await expect(page.locator(`[data-testid="${id}"]`), `${transport} must show ${id}`).toBeVisible();
  }
  for (const id of spec.absent) {
    await expect(page.locator(`[data-testid="${id}"]`), `${transport} must NOT show ${id}`).toHaveCount(0);
  }
});

When('{string} submits the radio attach form with no fields filled', async ({ user }, username: string) => {
  await pageOf(user(username).username).locator('[data-testid="dr-attach"]').click();
});

Then('{string} sees the radio attach validation error', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // attach() short-circuits with a role=alert BEFORE any BFF call — a real state
  // change (the alert appears) that fails against a blank page.
  const err = page.locator('[data-testid="dr-attach-error"]');
  await expect(err).toBeVisible();
  await expect(err).toHaveAttribute('role', 'alert');
});
