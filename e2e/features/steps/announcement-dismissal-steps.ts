// Step definitions backing features/admin/announcement-dismissal.feature — the
// admin-ui AUTHORING leg of per-user announcement dismissal. The editor exposes a
// `dismissible` flag (announcement-editor.component.ts) that nothing exercised. The
// per-user banner-suppression BEHAVIOUR (one user's dismissal not hiding it for
// another; dismissible=false rendering with no dismiss control) is rendered by the
// hugmesh.systems HOST shell's announcement banner, NOT this remote — a cross-repo
// leg (see the feature's note). What THIS repo owns is that the flag is authored and
// persisted exactly as set, proven by re-reading the stored row (dismissible round-trips).

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, scenarioState, scenarioNonce } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** Bean-valid AnnouncementRequest carrying the dismissible flag under test (same
 *  known-good shape mutation-steps uses; Home-targeted so it is a real banner row). */
function bodyWith(title: string, dismissible: boolean): string {
  return JSON.stringify({
    title,
    body_html: '<p>e2e dismissal-authoring row.</p>',
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
    dismissible,
  });
}

async function createAnnouncement(username: string, title: string, dismissible: boolean): Promise<void> {
  const page = pageOf(username);
  const fullTitle = `${title} [${scenarioNonce()}]`;
  const created = await page.evaluate(
    async ([body]) => {
      const r = await fetch('/bff/admin/announcements', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body,
      });
      return { status: r.status, json: r.ok ? await r.json() : null };
    },
    [bodyWith(fullTitle, dismissible)] as const,
  );
  expect(created.status, 'the announcement create must succeed (201)').toBe(201);
  const id = (created.json as { id?: string } | null)?.id;
  if (!id) throw new Error('create returned no id — cannot re-read the stored dismissible flag');
  scenarioState.announcements.set(title, { id, fullTitle });
}

/** Re-read the stored row and return its dismissible flag (the honest persistence oracle). */
async function storedDismissible(username: string, title: string): Promise<boolean> {
  const target = scenarioState.announcements.get(title);
  if (!target) throw new Error(`No announcement "${title}" was created in this scenario.`);
  const page = pageOf(username);
  const read = await page.evaluate(async ([id]) => {
    const r = await fetch(`/bff/admin/announcements/${encodeURIComponent(id)}`, { credentials: 'include' });
    return { status: r.status, json: r.ok ? await r.json() : null };
  }, [target.id] as const);
  expect(read.status).toBe(200);
  return (read.json as { dismissible?: boolean } | null)?.dismissible === true;
}

When(
  '{string} creates an announcement titled {string} with dismissal allowed via the BFF',
  async ({ user }, username: string, title: string) => {
    await createAnnouncement(user(username).username, title, true);
  },
);

When(
  '{string} creates an announcement titled {string} with dismissal disabled via the BFF',
  async ({ user }, username: string, title: string) => {
    await createAnnouncement(user(username).username, title, false);
  },
);

Then('the announcement titled {string} is stored with dismissal allowed', async ({ user }, title: string) => {
  // The observer here is always the creating superadmin (only one actor in this
  // authoring-leg scenario); resolve their page via the announcements map's context.
  const username = 'superadmin';
  expect(await storedDismissible(user(username).username, title)).toBe(true);
});

Then('the announcement titled {string} is stored with dismissal disabled', async ({ user }, title: string) => {
  const username = 'superadmin';
  expect(await storedDismissible(user(username).username, title)).toBe(false);
});
