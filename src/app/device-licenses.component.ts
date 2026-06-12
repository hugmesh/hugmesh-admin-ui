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

  readonly devices = signal<DeviceRegistration[]>([]);
  /** Distinct domains across the registered devices (per-DOMAIN grant targets). */
  readonly domains = signal<string[]>([]);

  /** Grant form state. */
  deviceId = '';
  operator = '';
  scope: 'DEVICE' | 'DOMAIN' = 'DEVICE';
  domain = '';
  keyFingerprints = '';
  /** Inline validation surfaced in a role=alert live region. Empty = valid. */
  readonly formError = signal('');

  async ngOnInit(): Promise<void> {
    this.refresh(await this.bff.devices());
    if (!this.deviceId && this.devices().length) this.deviceId = this.devices()[0].id;
    if (!this.domain && this.domains().length) this.domain = this.domains()[0];
  }

  private refresh(devices: DeviceRegistration[]): void {
    this.devices.set(devices);
    this.domains.set([...new Set(devices.map((d) => d.domain))]);
  }

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
    const devices = this.scope === 'DEVICE'
      ? await this.bff.grantDeviceLicense(this.deviceId, operator, fingerprints)
      : await this.bff.grantDomainLicense(this.domain, operator, fingerprints);
    this.refresh(devices);
    this.operator = '';
    this.keyFingerprints = '';
  }

  async revoke(licenseId: string): Promise<void> {
    this.refresh(await this.bff.revokeLicense(licenseId));
  }

  /** Comma/space/newline-separated fingerprints → trimmed, de-duped, non-empty list. */
  private parseFingerprints(raw: string): string[] {
    return [...new Set(raw.split(/[\s,]+/).map((f) => f.trim()).filter((f) => f.length))];
  }
}
