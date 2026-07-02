import { Page, expect } from '@playwright/test';

/**
 * expect.poll-style CROSS-USER wait helpers (the org standard for "X appears in
 * <ctx>'s view within Ns" assertions — NEVER a bare waitForTimeout). Each helper
 * re-fetches the observing user's OWN view of a collection through their page's
 * origin (credentials:'include', so their HttpOnly bff_ cookie rides the call and
 * the admin-bff DomainScope chain answers for THAT user) until the expectation
 * holds or the deadline passes.
 */

/**
 * Poll the observing user's /bff/admin/announcements list until an announcement
 * with the given (already-uniquified) title is visible to THEM. Used by the
 * cross-domain scenarios: another persona created the row; this proves it
 * arrived in the observer's scope — the honest cross-user oracle.
 */
export async function pollForAnnouncementTitle(
  page: Page,
  fullTitle: string,
  seconds: number,
): Promise<void> {
  await expect
    .poll(
      async () =>
        await page.evaluate(async () => {
          const r = await fetch('/bff/admin/announcements', { credentials: 'include' });
          if (!r.ok) return [] as string[];
          const body = (await r.json()) as { announcements?: Array<{ title?: string }> };
          return (body.announcements ?? []).map((a) => a.title ?? '');
        }),
      {
        timeout: seconds * 1000,
        message: `announcement "${fullTitle}" did not appear in the observer's list within ${seconds}s`,
      },
    )
    .toContain(fullTitle);
}

/** One user's CURRENT announcements list (titles), fetched as that user. Used
 *  for the point-in-time contains / does-not-contain scope assertions. */
export async function announcementTitlesFor(page: Page): Promise<string[]> {
  return await page.evaluate(async () => {
    const r = await fetch('/bff/admin/announcements', { credentials: 'include' });
    if (!r.ok) throw new Error(`GET /bff/admin/announcements → ${r.status}`);
    const body = (await r.json()) as { announcements?: Array<{ title?: string }> };
    return (body.announcements ?? []).map((a) => a.title ?? '');
  });
}
