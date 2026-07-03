import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, DeviceRegistration } from './bff.service';

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
 */
@Component({
  selector: 'snap-device-licenses',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './device-licenses.component.html',
  styleUrl: './device-licenses.component.scss',
})
export class DeviceLicensesComponent implements OnInit {
  private readonly bff = inject(BffService);

  /** All registered mesh nodes with their physical owners, domain residencies and licenses. */
  readonly devices = signal<DeviceRegistration[]>([]);
  /** Distinct domains across the registered devices — used as the per-DOMAIN grant picker options. */
  readonly domains = signal<string[]>([]);

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
}
