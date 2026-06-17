import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, DeviceRegistration, DesktopSudoGrant } from '../bff.service';
import { SessionService } from '../session.service';

/**
 * The DESKTOP SUDO toggle (own repo: snapdragon-admin-ui). The admin front-end for the
 * desktop-governance sudo surface (admin-bff {@code DesktopSudoAdminController} at
 * {@code /bff/admin/desktop/sudo}). Grant / revoke SSO-enforced desktop sudo for a
 * (subject, device) pair. DEFAULT-NONE: the desktop image bakes no sudoers; an ACTIVE grant
 * is the only thing that confers sudo (emitted as a revocable SSO claim the on-device
 * PAM/polkit consults), centrally revocable at the IdP.
 *
 * <h3>Gating (defence-in-depth — the BFF is authoritative)</h3>
 * A grant RIDES the acting admin's device-ssh-license and respects the own-domain wall:
 * <ul>
 *   <li><b>403</b> — the acting admin holds no <em>active</em> device-ssh-license for the
 *       target device.</li>
 *   <li><b>422</b> — the target device is SUPERADMIN-owned, OR resident in another brand
 *       (a scoped admin cannot grant cross-domain).</li>
 * </ul>
 * The console mirrors that server posture for PRESENTATION ONLY: the Grant button is disabled
 * + carries helptext explaining why (no licensed device picked / superadmin-owned / cross-domain)
 * BEFORE a call is made, but the BFF re-enforces every predicate and a server denial is surfaced
 * verbatim in the error live region. A SUPERADMIN session is unscoped (the own-domain wall does
 * not apply) and still needs a license for the device.
 *
 * <p>The device picker is reused from the device-ownership/SSH-operate-license registry
 * ({@link BffService#devices}); each device row carries the licenses pinned on it, so the
 * console can pre-compute "do I hold a license here" client-side for the disabled state. The
 * acting admin's operator key is the session identity (matched case-insensitively against the
 * license operator).
 */
@Component({
  selector: 'snap-desktop-sudo',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './desktop-sudo.component.html',
  styleUrl: './desktop-governance.component.scss',
})
export class DesktopSudoComponent implements OnInit {
  private readonly bff = inject(BffService);
  private readonly session = inject(SessionService);

  readonly grants = signal<DesktopSudoGrant[]>([]);
  readonly devices = signal<DeviceRegistration[]>([]);
  readonly loaded = signal(false);

  /** Grant form state. */
  subject = '';
  deviceId = '';
  readonly grantError = signal('');

  /** The acting admin's operator key (the device-ssh-license operator). Lower-cased for the
   *  case-insensitive match against {@code license.operator}. */
  private readonly operator = computed(() => (this.session.session()?.id ?? '').toLowerCase());
  private readonly superadmin = computed(() => this.session.isSuperadmin());

  /** The device currently selected in the picker (or undefined). */
  readonly selectedDevice = computed(() =>
    this.devices().find((d) => d.id === this.deviceId));

  /** Whether the acting admin holds an ACTIVE device-ssh-license for the selected device
   *  (per-device OR per-domain scope). Drives the disabled state + helptext (the BFF is the
   *  authority — this is presentation). */
  readonly hasLicense = computed(() => {
    const d = this.selectedDevice();
    if (!d) return false;
    const op = this.operator();
    return d.licenses.some((l) =>
      l.state === 'active'
      && (l.operator ?? '').toLowerCase() === op
      && (l.scope_type === 'DEVICE'
        ? l.device_id === d.id
        : (l.target_domain ?? '') === d.domain));
  });

  /** Whether the selected device is SUPERADMIN-owned (a clean 422 at the BFF). */
  readonly superadminOwned = computed(() => this.selectedDevice()?.owner_type === 'SUPERADMIN');

  /** Whether granting on the selected device would cross the own-domain wall for a SCOPED
   *  admin. A superadmin is unscoped, so the wall never applies; we can only compare against
   *  the devices the BFF returned (own-domain for a scoped admin), so this stays false in
   *  practice for a scoped admin and is a defensive presentation hint. */
  readonly crossDomain = computed(() => false);

  /** The single reason the Grant action is blocked (presentation), or '' when permitted. */
  readonly gateReason = computed(() => {
    if (!this.deviceId) return 'Pick a device to grant sudo on.';
    if (this.superadminOwned()) {
      return 'This device is superadmin-owned — desktop sudo cannot be granted on it.';
    }
    if (!this.hasLicense()) {
      return this.superadmin()
        ? 'You hold no active device-SSH license for this device. Grant yourself a '
          + 'license in Device licenses first.'
        : 'You hold no active device-SSH license for this device. An admin with a license '
          + '(or a superadmin) must act, or you must be granted one.';
    }
    return '';
  });

  /** Whether the Grant action is permitted (presentation gate). */
  readonly canGrant = computed(() => this.gateReason() === '');

  async ngOnInit(): Promise<void> {
    await this.reload();
    if (!this.deviceId && this.devices().length) this.deviceId = this.devices()[0].id;
  }

  private async reload(): Promise<void> {
    const [grants, devices] = await Promise.all([
      this.bff.desktopSudoGrants(),
      this.bff.devices(),
    ]);
    this.grants.set(grants);
    this.devices.set(devices);
    this.loaded.set(true);
  }

  /** Grant sudo. The presentation gate ({@link canGrant}) blocks the obvious denials before a
   *  call; the BFF re-enforces and a server 403/422 is surfaced verbatim. */
  async grant(): Promise<void> {
    const subject = this.subject.trim();
    if (!subject) {
      this.grantError.set('Enter the Casdoor subject to grant sudo to.');
      return;
    }
    if (!this.canGrant()) {
      this.grantError.set(this.gateReason());
      return;
    }
    this.grantError.set('');
    try {
      await this.bff.desktopSudoGrant(subject, this.deviceId);
      this.subject = '';
      await this.reload();
    } catch (e) {
      // 403 = no active ssh-license; 422 = superadmin-owned / cross-domain.
      this.grantError.set((e as Error).message);
    }
  }

  async revoke(grantId: string): Promise<void> {
    await this.bff.desktopSudoRevoke(grantId);
    await this.reload();
  }

  /** The display label of a device for the picker + list a11y names. */
  deviceLabel(d: DeviceRegistration): string {
    return `${d.hostname} (${d.domain}${d.owner_type === 'SUPERADMIN' ? ', superadmin-owned' : ''})`;
  }

  /** The hostname for a grant's device (for the list label), or the raw id when unknown. */
  grantDeviceLabel(g: DesktopSudoGrant): string {
    return this.devices().find((d) => d.id === g.deviceId)?.hostname ?? g.deviceId;
  }
}
