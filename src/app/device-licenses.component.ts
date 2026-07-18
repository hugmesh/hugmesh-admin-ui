import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminSshIssuedKey, BffService, DeviceRegistration } from './bff.service';
import { MfaStepUpDialogComponent } from './mfa/mfa-step-up-dialog.component';
import { isStepUpRequiredError } from './mfa/step-up-error';

/**
 * Superadmin "Device Licenses" console (own repo: snapdragon-admin-ui). The MVP
 * surface over the device-ownership / SSH-operate-license registry — the single
 * source of truth governing which operator may SSH which mesh node. SUPERADMIN-only
 * (route-guarded by {@link superadminGuard}); a non-superadmin is bounced to /login.
 *
 * <p>The view lists each registered device with its physical owner, domain residency
 * and currently-licensed operators, and lets a superadmin GRANT a license per-DEVICE
 * OR per-DOMAIN (pinning the exact SSH public-key fingerprints the operator may
 * present) and REVOKE an existing license. Every mutation is also SUPERADMIN-gated at
 * the BFF; the registry then drives the headscale ACL + per-node sshd (later PRs).
 *
 * <p>Each device row also lists its ISSUED SSH keys — credentials this console MINTED
 * (distinct from a grant's operator-supplied fingerprint) via the admin-bff
 * {@code AdminSshKeyIssuanceController}. Issuing, downloading the one-time private key,
 * and revoking are all SUPERADMIN-only and step-up gated; a "requires step-up" 403 opens
 * the inline {@link MfaStepUpDialogComponent} and the SAME action is retried once the
 * dialog reports success (no token needed — the BFF reads the freshness off this
 * session). The feature SHIPS DARK ({@code app.ssh-issue.enabled=false} by default): the
 * list response's {@code enabled} field gates the issue control + shows a notice,
 * mirroring image-gen's capability-gate posture, rather than surfacing a raw 503.
 */
@Component({
  selector: 'snap-device-licenses',
  standalone: true,
  imports: [CommonModule, FormsModule, MfaStepUpDialogComponent],
  templateUrl: './device-licenses.component.html',
  styleUrl: './device-licenses.component.scss',
})
export class DeviceLicensesComponent implements OnInit {
  private readonly bff = inject(BffService);

  /** All registered mesh nodes with their physical owners, domain residencies and licenses. */
  readonly devices = signal<DeviceRegistration[]>([]);
  /** Distinct domains across the registered devices — used as the per-DOMAIN grant picker options. */
  readonly domains = signal<string[]>([]);

  // ── SSH key-issuance (per-device issued-keys panel; only ONE panel is ever expanded, so
  //    this state is NOT device-keyed — it always describes the currently-expanded device). ──
  /** The device id whose issued-keys panel is expanded, or '' when none. */
  readonly expandedSshDeviceId = signal('');
  /** The expanded device's issued keys ([] before the first fetch resolves). */
  readonly sshIssuedKeys = signal<AdminSshIssuedKey[]>([]);
  /** Whether ssh-issuance is launched (the ships-dark signal off the list response) — a single
   *  DEPLOYMENT-WIDE flag, not per-device, so one fetch's answer is reused for every device.
   *  Undefined until the first fetch resolves (fail-CLOSED: every gated control stays disabled
   *  until proven enabled, never assumed enabled while unknown). */
  readonly sshIssueEnabled = signal<boolean | undefined>(undefined);
  /** True while an issue/download/revoke action is in flight on the expanded panel. */
  readonly sshBusy = signal(false);
  /** The last ssh-issuance action's inline result/error, or null. `kind` drives role=alert vs
   *  role=status (mirrors desktop-dials.component.ts's DialNote convention). */
  readonly sshNote = signal<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /** A pending step-up challenge for an ssh-issuance action, or null when none is in flight.
   *  `retry` re-attempts the SAME action once the inline dialog reports success. */
  readonly sshStepUpChallenge = signal<null | { action: string; retry: () => Promise<void> }>(null);

  // ── Grant form (ngModel-bound plain properties) ──
  /** The device ID for a per-DEVICE license (pre-filled with the first device on load). */
  deviceId = '';
  /**
   * The operator's Casdoor subject (lowercased before sending — comparison is case-insensitive
   * at the BFF but normalise on the way out to avoid duplicate grants differing only in case).
   */
  operator = '';
  /** License scope: DEVICE (single node) or DOMAIN (all admin-owned nodes in a domain). */
  scope: 'DEVICE' | 'DOMAIN' = 'DEVICE';
  /** The target domain for a per-DOMAIN license. */
  domain = '';
  /**
   * Comma/space/newline-separated SSH public-key fingerprints the operator may present.
   * These are the ONLY keys accepted by that device's `sshd` for this operator — the
   * registry drives a principal/key pin at each node via the reconcile loop.
   */
  keyFingerprints = '';
  /** Inline validation message surfaced in a `role=alert` live region. Empty = no error. */
  readonly formError = signal('');

  async ngOnInit(): Promise<void> {
    this.refresh(await this.bff.devices());
    // Pre-select the first device and first domain for a faster grant workflow.
    if (!this.deviceId && this.devices().length) this.deviceId = this.devices()[0].id;
    if (!this.domain && this.domains().length) this.domain = this.domains()[0];
  }

  /**
   * Update the device list and derive the distinct domain set. Called after every
   * grant/revoke to keep the picker in sync.
   *
   * @param devices - The updated list from the BFF response.
   */
  private refresh(devices: DeviceRegistration[]): void {
    this.devices.set(devices);
    // Extract distinct domains in the order they first appear (stable for the picker).
    this.domains.set([...new Set(devices.map((d) => d.domain))]);
  }

  /**
   * Issue a device-SSH license via the BFF. Validates that an operator and at least one
   * fingerprint are provided, then calls the appropriate BFF endpoint based on `scope`:
   * - DEVICE: `POST /bff/admin/device-licenses/{deviceId}/licenses`
   * - DOMAIN: `POST /bff/admin/device-licenses/domain/{domain}/licenses`
   *
   * The BFF is the authoritative gate (`hasRole('SUPERADMIN')` + own-domain ownership).
   *
   * @throws BFF error message surfaced into the `formError` signal on failure.
   */
  async grant(): Promise<void> {
    const operator = this.operator.trim().toLowerCase();
    const fingerprints = this.parseFingerprints(this.keyFingerprints);
    if (!operator || !fingerprints.length) {
      this.formError.set('Enter an operator and at least one SSH key fingerprint.');
      return;
    }
    if (this.scope === 'DEVICE' && !this.deviceId) {
      this.formError.set('Pick a device for a per-device license.');
      return;
    }
    if (this.scope === 'DOMAIN' && !this.domain) {
      this.formError.set('Pick a domain for a per-domain license.');
      return;
    }
    this.formError.set('');
    try {
      const devices = this.scope === 'DEVICE'
        ? await this.bff.grantDeviceLicense(this.deviceId, operator, fingerprints)
        : await this.bff.grantDomainLicense(this.domain, operator, fingerprints);
      this.refresh(devices);
      this.operator = '';
      this.keyFingerprints = '';
    } catch (e) {
      this.formError.set(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Revoke a device-SSH license by id (`DELETE /bff/admin/device-licenses/licenses/{id}`).
   * The BFF marks the row revoked and triggers a reconcile that removes the principal from
   * the node's sshd `AuthorizedKeys`.
   *
   * @param licenseId - The license row to revoke.
   */
  async revoke(licenseId: string): Promise<void> {
    this.refresh(await this.bff.revokeLicense(licenseId));
  }

  /**
   * Parse a raw fingerprint string (comma/space/newline-separated) into a de-duped,
   * trimmed, non-empty list. Fingerprints are typically in the form `SHA256:...`
   * (as output by `ssh-keygen -l -f <key>`).
   *
   * @param raw - The raw multi-value input from the textarea.
   * @returns A de-duped array of fingerprint strings.
   */
  private parseFingerprints(raw: string): string[] {
    return [...new Set(raw.split(/[\s,]+/).map((f) => f.trim()).filter((f) => f.length))];
  }

  // ── SSH key-issuance (per-device issued-keys panel) ────────────────────────────

  isSshExpanded(deviceId: string): boolean {
    return this.expandedSshDeviceId() === deviceId;
  }

  /** Toggle a device's issued-keys panel; fetches on expand (and every re-expand, to pick up
   *  actions taken elsewhere). Collapsing just hides the panel — no need to refetch. */
  async toggleSshPanel(deviceId: string): Promise<void> {
    if (this.expandedSshDeviceId() === deviceId) {
      this.expandedSshDeviceId.set('');
      return;
    }
    this.expandedSshDeviceId.set(deviceId);
    this.sshIssuedKeys.set([]);
    this.sshNote.set(null);
    await this.refreshIssuedKeys(deviceId);
  }

  private async refreshIssuedKeys(deviceId: string): Promise<void> {
    const list = await this.bff.issuedSshKeys(deviceId);
    // A slow response after the panel moved to (or off) a different device must not clobber it.
    if (this.expandedSshDeviceId() !== deviceId) return;
    this.sshIssuedKeys.set(list.issuedKeys);
    this.sshIssueEnabled.set(list.enabled);
  }

  isSshBusy(): boolean {
    return this.sshBusy();
  }

  /**
   * Run a privileged ssh-issuance mutation behind the busy guard. A "requires step-up" 403
   * opens the inline MFA dialog and BLINDLY retries {@code fn} on success (the same closure —
   * no re-confirmation, no token needed); any other failure sets an inline error note. Shared by
   * issue/download/revoke, the three mutations this panel gates identically.
   */
  private async runSshGated(action: string, fn: () => Promise<void>): Promise<void> {
    if (this.sshBusy()) return;
    this.sshBusy.set(true);
    this.sshNote.set(null);
    try {
      await fn();
    } catch (e) {
      if (isStepUpRequiredError(e)) {
        this.offerSshStepUp(action, () => this.runSshGated(action, fn));
        return;
      }
      this.sshNote.set({ kind: 'err', text: e instanceof Error ? e.message : 'The action could not be completed.' });
    } finally {
      this.sshBusy.set(false);
    }
  }

  /** Mint a fresh Ed25519 credential for {@code deviceId}. */
  async issueSshKey(deviceId: string): Promise<void> {
    await this.runSshGated('Issuing this SSH credential', async () => {
      const result = await this.bff.issueSshKey(deviceId);
      this.sshNote.set({
        kind: 'ok',
        text: `Issued a new credential (fingerprint ${result.fingerprint}). `
          + 'Download the private key now — it is available once only.',
      });
      await this.refreshIssuedKeys(deviceId);
    });
  }

  /** Download an issued credential's one-time private key. */
  async downloadSshKey(deviceId: string, issuedKeyId: string): Promise<void> {
    await this.runSshGated('Downloading this private key', async () => {
      const ok = await this.bff.downloadSshPrivateKey(issuedKeyId);
      if (!ok) this.sshNote.set({ kind: 'err', text: 'The private key could not be downloaded.' });
    });
  }

  /**
   * Revoke an issued credential, after a native confirm(). The confirm is OUTSIDE
   * {@link runSshGated} deliberately — a step-up retry re-invokes only the gated network action,
   * never re-prompts the operator (the platform's step-up dialogs are always a blind retry).
   */
  async revokeSshKey(deviceId: string, issuedKeyId: string): Promise<void> {
    if (this.sshBusy()) return;
    if (!confirm('Revoke this SSH credential? The operator will no longer be able to SSH into '
      + 'this device with it.')) return;
    await this.runSshGated('Revoking this SSH credential', async () => {
      const result = await this.bff.revokeSshKey(issuedKeyId);
      // A ships-dark refusal is a normal 200 {dark:true, revoked:false} here, NOT an error —
      // distinguish it from an ordinary "already revoked" so the note is never misleading.
      this.sshNote.set(result.dark
        ? { kind: 'err', text: 'SSH key issuance is not enabled yet on this deployment — nothing was revoked.' }
        : { kind: 'ok', text: result.revoked ? 'Credential revoked.' : 'Nothing to revoke (already revoked).' });
      await this.refreshIssuedKeys(deviceId);
    });
  }

  /** Offer the inline MFA step-up dialog for an ssh-issuance action that 403'd. Clears the
   *  busy flag so the dialog itself is interactive (the retry re-sets it). */
  private offerSshStepUp(action: string, retry: () => Promise<void>): void {
    this.sshBusy.set(false);
    this.sshStepUpChallenge.set({ action, retry });
  }

  /** The inline step-up dialog reported success — retry the gated action it was blocking. */
  async onSshStepUpSatisfied(): Promise<void> {
    const challenge = this.sshStepUpChallenge();
    this.sshStepUpChallenge.set(null);
    if (challenge) await challenge.retry();
  }

  /** The user cancelled the step-up dialog — drop the pending retry. */
  onSshStepUpDismissed(): void {
    this.sshStepUpChallenge.set(null);
  }
}
