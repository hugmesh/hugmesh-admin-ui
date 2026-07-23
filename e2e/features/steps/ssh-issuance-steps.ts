// Step definitions backing features/admin/ssh-key-issuance.feature — the SSH
// key-ISSUANCE panel on the Device Licenses console (device-licenses.component.ts
// runSshGated/issue/download/revoke). A superadmin-only credential mint with a
// one-time private-key download, all SUPERADMIN-only + step-up gated (admin-bff
// AdminSshKeyIssuanceController: every mutating verb is @PreAuthorize("hasRole('SUPERADMIN')")
// and 403s "requires step-up" without a fresh step-up — verified against the source).
// The panel reuses the SAME shared MfaStepUpDialogComponent (mfa-stepup-dialog) as the
// MFA console, so the "sees the MFA step-up dialog" / "satisfies the step-up ..." steps
// (mfa-steps.ts) drive the SSH step-up too.
//
// Ships dark by default (app.ssh-issue.enabled=false → issued-keys read reports
// enabled:false → the console disables everything and shows the not-enabled note).

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

/** The device + issued-key this scenario operates on, captured from the live DOM so
 *  download/revoke target REAL server-issued ids, never a guess. Serial execution
 *  makes module-globals safe. */
let sshDeviceId: string | null = null;
let sshKeyId: string | null = null;

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

When('{string} opens the SSH keys panel for the first registered device', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // Honest precondition: the panel needs a real device. An empty registry cannot
  // prove anything — fail loudly instead of "passing" against nothing.
  const firstDevice = page.locator('[data-testid="dl-devices"] li[data-device-id]').first();
  await expect(firstDevice, 'no device is registered — seed one first').toBeVisible({ timeout: 15_000 });
  sshDeviceId = await firstDevice.getAttribute('data-device-id');
  if (!sshDeviceId) throw new Error('registered device row carried no data-device-id');
  await page.locator(`[data-ssh-toggle="${sshDeviceId}"]`).click();
  await expect(page.locator(`[data-ssh-panel="${sshDeviceId}"]`)).toBeVisible();
});

Then('{string} sees SSH key issuance is not enabled for that device', async ({ user }, username: string) => {
  if (!sshDeviceId) throw new Error('SSH panel was not opened in this scenario.');
  const page = pageOf(user(username).username);
  // The ships-dark note (from the issued-keys read's enabled:false) + the issue
  // control disabled — the honest default-deployment state.
  await expect(page.locator(`[data-testid="ssh-dark-${sshDeviceId}"]`)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`[data-ssh-issue="${sshDeviceId}"]`)).toBeDisabled();
});

When('{string} issues a new SSH credential for that device', async ({ user }, username: string) => {
  if (!sshDeviceId) throw new Error('SSH panel was not opened in this scenario.');
  await pageOf(user(username).username).locator(`[data-ssh-issue="${sshDeviceId}"]`).click();
});

Then('{string} sees a newly issued SSH key for that device', async ({ user }, username: string) => {
  if (!sshDeviceId) throw new Error('SSH panel was not opened in this scenario.');
  const page = pageOf(user(username).username);
  // After the step-up-satisfied retry mints, the panel reloads the issued-keys list;
  // an 'issued' row appears and the note is a success (not an error).
  const row = page.locator(`[data-ssh-panel="${sshDeviceId}"] li[data-issued-key-id]`).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  sshKeyId = await row.getAttribute('data-issued-key-id');
  if (!sshKeyId) throw new Error('minted key row carried no data-issued-key-id');
  await expect(page.locator(`[data-testid="ssh-note-${sshDeviceId}"]`)).not.toHaveClass(/dl-ssh-note-err/);
});

When('{string} downloads that SSH key private key', async ({ user }, username: string) => {
  if (!sshKeyId) throw new Error('No SSH key was minted in this scenario.');
  await pageOf(user(username).username).locator(`[data-ssh-download="${sshKeyId}"]`).click();
});

Then('{string} can no longer download that SSH key private key', async ({ user }, username: string) => {
  if (!sshKeyId) throw new Error('No SSH key was minted in this scenario.');
  const page = pageOf(user(username).username);
  // One-time download: once downloadedAt is stamped the console disables the button —
  // the UI-level guarantee that the private key is retrievable exactly once.
  await expect(page.locator(`[data-ssh-download="${sshKeyId}"]`)).toBeDisabled({ timeout: 15_000 });
});
