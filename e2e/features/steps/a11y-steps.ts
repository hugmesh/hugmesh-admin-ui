// Accessibility step definitions. The admin-ui is the multi-tenant authz
// keystone AND carries the org a11y standard (skip-link, aria landmarks, roving
// tabindex on the module menu, focus restoration after a route change). These
// steps assert those contracts against the real shell markup:
//   - app.component.html renders `<a class="skip" href="#main">` →
//     `<main id="main" tabindex="-1">` (the skip-link + focus target).
//   - admin.component.html renders the module menu as
//     `<nav aria-label="Admin modules"><ul><li><a class="nav-link">…`.

import { expect } from '@playwright/test';
import { Then, When } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

// ── Skip-link ────────────────────────────────────────────────────────────────

Then('{string} can tab to the skip link', async ({}, username: string) => {
  const page = pageOf(username);
  await page.keyboard.press('Tab');
  const skip = page.locator('a.skip');
  await expect(skip).toBeFocused();
  await expect(skip).toHaveAttribute('href', '#main');
});

Then('activating the skip link moves focus to the main region', async ({}, username: string) => {
  const page = pageOf(username);
  await page.locator('a.skip').press('Enter');
  const main = page.locator('main#main');
  await expect(main).toBeFocused();
  // The skip target must be programmatically focusable without being a tab stop.
  await expect(main).toHaveAttribute('tabindex', '-1');
});

// ── ARIA landmarks / labels ──────────────────────────────────────────────────

Then('the admin module menu has an accessible name', async ({}, username: string) => {
  const page = pageOf(username);
  await expect(page.locator('nav[aria-label="Admin modules"]')).toBeVisible();
});

Then('the {string} view has an accessible name', async ({}, username: string, testid: string) => {
  const page = pageOf(username);
  const view = page.locator(`[data-testid="${testid}"]`);
  // Each console root is aria-labelledby a heading (or has an explicit
  // aria-label) — assert one of the two is present so assistive tech can name
  // the region.
  const labelledby = await view.getAttribute('aria-labelledby');
  const ariaLabel = await view.getAttribute('aria-label');
  expect(Boolean(labelledby) || Boolean(ariaLabel)).toBe(true);
});

Then('the capability-gate banner announces unavailability', async ({}, username: string) => {
  const page = pageOf(username);
  const gate = page.locator('[data-testid="capability-gate"]');
  await expect(gate).toBeVisible();
  // role="status" → announced politely (a degraded, non-error state), plus an
  // explicit accessible name carrying the detail.
  await expect(gate).toHaveAttribute('role', 'status');
  const name = await gate.getAttribute('aria-label');
  expect(name && name.length > 0).toBe(true);
});

// ── Roving tabindex on the module menu ───────────────────────────────────────

When('{string} focuses the first admin module link', async ({}, username: string) => {
  const page = pageOf(username);
  await page.locator('nav[aria-label="Admin modules"] a.nav-link').first().focus();
});

Then('arrow-key navigation moves focus along the admin module links', async ({}, username: string) => {
  const page = pageOf(username);
  const links = page.locator('nav[aria-label="Admin modules"] a.nav-link');
  await expect(links.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  // Roving tabindex: focus advances to the next link without leaving the menu.
  await expect(links.nth(1)).toBeFocused();
});

// ── Focus restoration after a route change ───────────────────────────────────

Then('focus is restored to the main region after navigation', async ({}, username: string) => {
  const page = pageOf(username);
  await expect(page.locator('main#main')).toBeFocused();
});
