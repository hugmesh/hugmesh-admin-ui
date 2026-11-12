// Phone-width layout steps (features/admin/phone-width.feature, GUI-30).
//
// The measurement is the one the GUI walk used: documentElement.scrollWidth minus
// clientWidth, i.e. how far the page scrolls sideways. It is taken once the console
// has rendered and the network has gone quiet, never polled: a poll for "no overflow"
// passes on the blank page before the console arrives.

import { expect, Page } from '@playwright/test';
import { Given, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageFor(username: string): Page {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

Given('{string} uses a {int}x{int} viewport', async ({ user }, username: string, width: number, height: number) => {
  await pageFor(user(username).username).setViewportSize({ width, height });
});

Then('{string} sees no horizontal overflow', async ({ user }, username: string) => {
  const page = pageFor(user(username).username);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const edge = de.clientWidth + 0.5;
    // The outermost elements past the right edge, to name the culprit on failure.
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= edge || getComputedStyle(el).position === 'fixed') continue;
      const parent = el.parentElement?.getBoundingClientRect();
      if (parent && parent.right > edge) continue;
      offenders.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} ends at ${Math.round(r.right)}px`);
      if (offenders.length >= 5) break;
    }
    return { overflow: de.scrollWidth - de.clientWidth, width: de.clientWidth, offenders };
  });
  expect(m.overflow, `page scrolls ${m.overflow}px sideways at ${m.width}px: ${m.offenders.join('; ')}`).toBe(0);
});

Then('{string} sees the API docs navigator above its detail pane', async ({ user }, username: string) => {
  const page = pageFor(user(username).username);
  const nav = page.locator('hug-api-docs-docs-shell nav[aria-labelledby="nav-heading"]');
  const pane = page.locator('hug-api-docs-docs-shell .pane');
  await expect(nav).toBeVisible({ timeout: 15_000 });
  const n = (await nav.boundingBox())!;
  const p = (await pane.boundingBox())!;
  expect(p.y, 'the detail pane starts below the navigator').toBeGreaterThanOrEqual(n.y + n.height - 1);
  expect(p.width, 'the detail pane is as wide as the navigator').toBeGreaterThanOrEqual(n.width - 1);
});
