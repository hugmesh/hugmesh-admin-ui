// REAL-WRITE (mutation) step definitions — the wave's create/update coverage.
//
// Two write channels, both honest:
//   - UI writes: drive the real console form (announcements editor,
//     games-services create form) and prove the outcome in the SAME view the
//     operator sees (saved confirmation + the row/instance appearing).
//   - BFF writes: fire the same same-origin fetch the app's services fire
//     (credentials:'include' → the HttpOnly bff_ cookie), capture the REAL
//     server-issued id, and use it as the oracle for the cross-user DENYs —
//     the victim-creates-first discipline. A DENY against a fabricated id
//     proves nothing; every attacked id here was created by its victim first.
//
// Names are uniquified per scenario (scenarioNonce) so repeated live runs never
// collide; the feature files keep the declarative base names.

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, responseState, scenarioState, scenarioNonce } from './_registry';
import { announcementTitlesFor, pollForAnnouncementTitle } from '../../tests/helpers/poll';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** The uniquified title actually sent to the server for a feature-file title. */
function fullTitleOf(baseTitle: string): string {
  const known = scenarioState.announcements.get(baseTitle)?.fullTitle
    ?? scenarioState.uniqueNames.get(baseTitle);
  if (!known) throw new Error(`No announcement created/titled "${baseTitle}" in this scenario.`);
  return known;
}

/** A bean-valid AnnouncementRequest body (the admin-bff requires title,
 *  body_html and — even for a draft — at least one target surface). */
function announcementBody(fullTitle: string): string {
  return JSON.stringify({
    title: fullTitle,
    body_html: '<p>e2e cross-domain oracle row.</p>',
    format: 'html',
    state: 'draft',
    target_home: true,
    target_login: false,
    target_akkoma: false,
    target_forum: false,
    priority: 0,
    starts_at: null,
    ends_at: null,
    timezone: 'UTC',
    dismissible: true,
  });
}

// ── Announcements — UI create/update (the superadmin ALLOW write) ───────────

When('{string} starts a new announcement', async ({ user }, username: string) => {
  await pageOf(user(username).username).locator('[data-testid="ann-new"]').click();
});

When('{string} titles the announcement {string}', async ({ user }, username: string, title: string) => {
  // Uniquify so a repeat run against a live stack cannot pass on a stale row.
  const fullTitle = `${title} [${scenarioNonce()}]`;
  scenarioState.uniqueNames.set(title, fullTitle);
  await pageOf(user(username).username).locator('[data-testid="ann-title"]').fill(fullTitle);
});

When('{string} retitles the announcement to {string}', async ({ user }, username: string, title: string) => {
  const fullTitle = `${title} [${scenarioNonce()}]`;
  scenarioState.uniqueNames.set(title, fullTitle);
  await pageOf(user(username).username).locator('[data-testid="ann-title"]').fill(fullTitle);
});

When('{string} writes the announcement body {string}', async ({ user }, username: string, html: string) => {
  await pageOf(user(username).username).locator('[data-testid="ann-body"]').fill(html);
});

When('{string} targets the announcement at the Home surface', async ({ user }, username: string) => {
  // The BFF requires at least one target surface even for a draft
  // (AnnouncementService.validated) — the editor mirrors the real operator flow.
  await pageOf(user(username).username).locator('[data-testid="target-target_home"]').check();
});

When('{string} saves the announcement', async ({ user }, username: string) => {
  await pageOf(user(username).username).locator('[data-testid="ann-save"]').click();
});

Then('{string} sees the announcement saved confirmation', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // ann-saved only renders after the BFF answered the POST/PUT with the stored
  // row (savedId set from the response) — a failed save shows ann-error instead.
  // HONEST on the update leg too: save() retracts savedId synchronously at
  // save-start (AnnouncementEditorComponent.save), so the badge seen here is
  // always THIS save's confirmation, never a stale one from the previous save
  // sampled while the PUT is still in flight.
  await expect(page.locator('[data-testid="ann-saved"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="ann-error"]')).toHaveCount(0);
});

Then(
  'the announcement {string} appears in {string}\'s announcements table',
  async ({ user }, title: string, username: string) => {
    const page = pageOf(user(username).username);
    const row = page
      .locator('[data-testid="announcements-table"] tbody tr')
      .filter({ hasText: fullTitleOf(title) });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
  },
);

// ── Announcements — BFF create + cross-domain attack (victim-creates-first) ──

When(
  '{string} creates an announcement titled {string} via the BFF',
  async ({ user }, username: string, title: string) => {
    const page = pageOf(user(username).username);
    const fullTitle = `${title} [${scenarioNonce()}]`;
    const created = await page.evaluate(
      async ([body]) => {
        const r = await fetch('/bff/admin/announcements', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        return { status: r.status, json: r.ok ? await r.json() : null };
      },
      [announcementBody(fullTitle)] as const,
    );
    // Honest ALLOW: the create must really succeed and yield a REAL id — this id
    // is the oracle every subsequent DENY is measured against.
    expect(created.status, 'victim create must succeed (201)').toBe(201);
    const id = (created.json as { id?: string } | null)?.id;
    if (!id) throw new Error('create returned no id — cannot run the victim-creates-first oracle');
    scenarioState.announcements.set(title, { id, fullTitle });
  },
);

When(
  '{string} attempts to update the announcement titled {string} via the BFF',
  async ({ user }, username: string, title: string) => {
    const target = scenarioState.announcements.get(title);
    if (!target) throw new Error(`No announcement "${title}" was created in this scenario.`);
    const page = pageOf(user(username).username);
    responseState.lastStatus = await page.evaluate(
      async ([id, body]) => {
        const r = await fetch(`/bff/admin/announcements/${encodeURIComponent(id)}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        return r.status;
      },
      [target.id, announcementBody(`${target.fullTitle} (defaced)`)] as const,
    );
  },
);

When(
  '{string} attempts to read the announcement titled {string} via the BFF',
  async ({ user }, username: string, title: string) => {
    // Cross-domain READ probe against the victim's REAL id — the admin-bff
    // resolves another brand's id to empty → 404 (invisible by design), the
    // deterministic DENY the scenario asserts.
    const target = scenarioState.announcements.get(title);
    if (!target) throw new Error(`No announcement "${title}" was created in this scenario.`);
    const page = pageOf(user(username).username);
    responseState.lastStatus = await page.evaluate(
      async ([id]) => {
        const r = await fetch(`/bff/admin/announcements/${encodeURIComponent(id)}`, {
          credentials: 'include',
        });
        return r.status;
      },
      [target.id] as const,
    );
  },
);

When(
  '{string} attempts to delete the announcement titled {string} via the BFF',
  async ({ user }, username: string, title: string) => {
    const target = scenarioState.announcements.get(title);
    if (!target) throw new Error(`No announcement "${title}" was created in this scenario.`);
    const page = pageOf(user(username).username);
    responseState.lastStatus = await page.evaluate(
      async ([id]) => {
        const r = await fetch(`/bff/admin/announcements/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        return r.status;
      },
      [target.id] as const,
    );
  },
);

Then(
  '{string} still reads the announcement titled {string} via the BFF',
  async ({ user }, username: string, title: string) => {
    // The second half of the oracle: the attacked row is UNTOUCHED for its
    // owner — same id, same (un-defaced) title.
    const target = scenarioState.announcements.get(title);
    if (!target) throw new Error(`No announcement "${title}" was created in this scenario.`);
    const page = pageOf(user(username).username);
    const read = await page.evaluate(
      async ([id]) => {
        const r = await fetch(`/bff/admin/announcements/${encodeURIComponent(id)}`, {
          credentials: 'include',
        });
        return { status: r.status, json: r.ok ? await r.json() : null };
      },
      [target.id] as const,
    );
    expect(read.status).toBe(200);
    expect((read.json as { title?: string } | null)?.title).toBe(target.fullTitle);
  },
);

// ── Announcements — cross-user scope assertions (superadmin crosses domains) ─

Then(
  'the announcement {string} appears in {string}\'s announcements list within {int} seconds',
  async ({ user }, title: string, username: string, seconds: number) => {
    const target = scenarioState.announcements.get(title);
    if (!target) throw new Error(`No announcement "${title}" was created in this scenario.`);
    await pollForAnnouncementTitle(pageOf(user(username).username), target.fullTitle, seconds);
  },
);

Then(
  '{string}\'s announcements list contains {string}',
  async ({ user }, username: string, title: string) => {
    const titles = await announcementTitlesFor(pageOf(user(username).username));
    expect(titles).toContain(fullTitleOf(title));
  },
);

Then(
  '{string}\'s announcements list does not contain {string}',
  async ({ user }, username: string, title: string) => {
    const titles = await announcementTitlesFor(pageOf(user(username).username));
    expect(titles).not.toContain(fullTitleOf(title));
  },
);

// ── Games-services — UI create (the games-admin ALLOW write) ────────────────

When('{string} selects the first offered game server', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const select = page.locator('[data-testid="gs-slug"]');
  const offered = select.locator('option:not([value=""])');
  // Honest ALLOW precondition: an empty offered catalog cannot prove a create —
  // fail loudly instead of "passing" against nothing.
  await expect(offered.first(), 'no game server is offered to this domain — seed an offer first')
    .toBeAttached({ timeout: 15_000 });
  const slug = await offered.first().getAttribute('value');
  await select.selectOption(slug!);
});

When('{string} names the new instance {string}', async ({ user }, username: string, name: string) => {
  // gs-name must be a DNS label (^[a-z0-9][a-z0-9-]{0,62}$) — the nonce is
  // lowercase alnum, so `${name}-${nonce}` stays valid and unique per run.
  const fullName = `${name}-${scenarioNonce()}`;
  scenarioState.uniqueNames.set(name, fullName);
  await pageOf(user(username).username).locator('[data-testid="gs-name"]').fill(fullName);
});

When('{string} submits the create-instance form', async ({ user }, username: string) => {
  await pageOf(user(username).username).locator('[data-testid="gs-create"]').click();
});

Then(
  'the instance {string} appears in {string}\'s instances list within {int} seconds',
  async ({ user }, name: string, username: string, seconds: number) => {
    const fullName = scenarioState.uniqueNames.get(name);
    if (!fullName) throw new Error(`No instance named "${name}" in this scenario.`);
    const page = pageOf(user(username).username);
    // The console prepends the BFF's stored instance (real id in
    // data-instance-id) — so this only passes when the POST truly succeeded.
    const item = page
      .locator('[data-testid="gs-instances"] li[data-instance-id]')
      .filter({ hasText: fullName });
    await expect(item).toBeVisible({ timeout: seconds * 1000 });
    await expect(page.locator('[data-testid="gs-form-error"]')).toHaveCount(0);
  },
);
