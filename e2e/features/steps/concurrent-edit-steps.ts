// Step definitions backing features/admin/concurrent-admin-edits.feature — two
// admins of the SAME domain mutating the same announcement (every existing two-actor
// scenario is cross-domain or cross-role; none is same-domain concurrent). The
// announcements editor has no optimistic-locking UI, so the concrete risks are a
// zombie row (a2 saves onto a row a1 already deleted) and a last-write race (rival
// retitles). Both are exercised at the BFF seam — the same "the console is
// display-only; the BFF is the real gate" idiom the suite's other write legs use.
//
// Reuses mutation-steps.ts for the shared create/delete/update/list-contains vocab;
// adds only the same-domain retitle (a REAL authorized PUT that must win, not 403).

import { expect } from '@playwright/test';
import { When } from '../support/fixtures';
import { pageRegistry, scenarioState, scenarioNonce } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** A bean-valid AnnouncementRequest carrying a specific title (mirrors mutation-steps'
 *  announcementBody: title + body_html + at least one target surface, even for a draft). */
function bodyWithTitle(title: string): string {
  return JSON.stringify({
    title,
    body_html: '<p>e2e concurrent-edit row.</p>',
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

When(
  '{string} retitles the shared announcement {string} to {string} via the BFF',
  async ({ user }, username: string, origTitle: string, newTitle: string) => {
    const target = scenarioState.announcements.get(origTitle);
    if (!target) throw new Error(`No announcement "${origTitle}" was created in this scenario.`);
    const fullNew = `${newTitle} [${scenarioNonce()}]`;
    const page = pageOf(user(username).username);
    const status = await page.evaluate(
      async ([id, body]) => {
        const r = await fetch(`/bff/admin/announcements/${encodeURIComponent(id)}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body,
        });
        return r.status;
      },
      [target.id, bodyWithTitle(fullNew)] as const,
    );
    // Same-domain admin → a REAL authorized update, must succeed (200). Record the new
    // title under its feature-file name so the shared "list contains" step resolves it,
    // and keep the announcement row's tracked title in sync (same id, new title) so a
    // later retitle of the SAME row still targets it.
    expect(status, 'a same-domain admin update must succeed (200)').toBe(200);
    scenarioState.uniqueNames.set(newTitle, fullNew);
    scenarioState.announcements.set(origTitle, { id: target.id, fullTitle: fullNew });
  },
);
