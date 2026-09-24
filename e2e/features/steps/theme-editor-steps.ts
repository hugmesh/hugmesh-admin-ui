// Step definitions backing features/admin/theme-editor-axes.feature — the domain
// theme editor's selectable axes (and hugmesh-host-shell#19's missing effect axis).
//
// GET /bff/admin/themes is answered by page.route() with the DomainTheme list shape
// the store reads (`{ themes: DomainTheme[] }`, themes/domain-themes.service.ts
// refresh()), so the editor opens with no backend. Nothing is saved.

import { expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** The persona whose editor the Then steps read — the scenario's single actor. */
let editorOwner = '';

Given('the admin-bff lists one themed domain {string} to {string}', async ({ user }, domain: string, username: string) => {
  const page = pageOf(user(username).username);
  editorOwner = user(username).username;
  const body = {
    themes: [{
      domain, preset: 'pride-progress', ramp: 'dark', style: 'soft', decor: 'none',
      renderedBy: 'e2e-mock', updatedBy: 'e2e-mock',
    }],
  };
  await page.route('**/bff/admin/themes', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
});

When('{string} opens the theme editor for {string}', async ({ user }, username: string, domain: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator(`[data-testid="theme-row-${domain}"]`)).toBeVisible({ timeout: 15_000 });
  await page.locator(`[data-testid="edit-${domain}"]`).click();
  await expect(page.locator('[data-testid="theme-editor"]')).toBeVisible();
});

Then('the theme editor offers the {string} choice including {string}', async ({}, testid: string, value: string) => {
  const editor = pageOf(editorOwner).locator('[data-testid="theme-editor"]');
  const select = editor.locator(`select[data-testid="${testid}"]`);
  await expect(select).toBeEnabled();
  await expect(select.locator(`option[value="${value}"]`)).toHaveCount(1);
  // Selectable, not just listed: the draft follows the pick.
  await select.selectOption(value);
  await expect(select).toHaveValue(value);
});

Then('the theme editor offers a background effect choice with more than one effect', async ({}) => {
  // Located by its accessible name, not a testid the feature does not have yet —
  // "effect" is the vocabulary of the issue, host-shell's `--sd-bg-effect` and
  // login-ui's effect catalogue.
  const editor = pageOf(editorOwner).locator('[data-testid="theme-editor"]');
  const effect = editor.getByLabel(/effect/i);
  await expect(effect).toHaveCount(1);
  await expect(effect).toBeEnabled();
  const options = effect.locator('option');
  expect(await options.count(), 'effect options offered').toBeGreaterThan(1);
  // Selectable: picking a second option sticks.
  const second = await options.nth(1).getAttribute('value');
  expect(second, 'the second effect option carries a value').toBeTruthy();
  await effect.selectOption(second!);
  await expect(effect).toHaveValue(second!);
});
