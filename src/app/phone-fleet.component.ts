import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BffService, PhoneDevice } from './bff.service';

/**
 * Superadmin "Phone fleet" console (own repo: snapdragon-admin-ui). READ-ONLY view over
 * the sovereign MDM phone registry — every Android phone that has INGESTED (self-reported
 * its provisioning snapshot to the admin BFF). SUPERADMIN-only (route-guarded by
 * {@link superadminGuard}; the BFF re-enforces the role on every read).
 *
 * <p>The table shows one row per phone (identity, OS, role, attached domain, tailscale
 * address, enterprise-profile presence, attestation verdict, ingest telemetry), newest
 * ingest activity first — the BFF's own ordering, preserved as-is. Each row expands into
 * the FULL record: identity, mesh/tailscale, enterprise-profile (the on-device WORK
 * profile, distinct from any admin scope), attestation and ingest-telemetry blocks.
 *
 * <p>Deliberately NO mutations and NO step-up: enrolment and profile management happen
 * device-side via the phone wizard — this console only observes what the fleet reports.
 */
@Component({
  selector: 'snap-phone-fleet',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './phone-fleet.component.html',
  styleUrl: './phone-fleet.component.scss',
})
export class PhoneFleetComponent implements OnInit {
  private readonly bff = inject(BffService);

  /** Every ingested phone, newest ingest activity first (the BFF's ordering). */
  readonly phones = signal<PhoneDevice[]>([]);
  /** True while a fleet load/refresh is in flight. */
  readonly loading = signal(true);
  /** Message from a failed fleet load (a network-level failure — the BFF read itself is
   *  fail-soft). Displayed in a role=alert region; empty = no error. */
  readonly loadError = signal('');
  /** The deviceId whose detail row is expanded, or '' when none (one at a time). */
  readonly expandedDeviceId = signal('');

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  /**
   * Load (or re-load) the fleet from `GET /bff/superadmin/phone-devices`. The Refresh
   * button re-invokes this; a previously-expanded row stays expanded across a refresh
   * when its phone is still listed (the detail row keys off deviceId, not index).
   */
  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.phones.set(await this.bff.phones());
      this.loadError.set('');
    } catch (e) {
      // A rejection is not guaranteed to be an Error (a bare string/object would
      // leave `.message` undefined, silently blanking the role=alert region).
      this.loadError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Expand a phone's detail row, or collapse it when it is the one already open.
   *
   * @param deviceId - The stable device id of the row being toggled.
   */
  toggle(deviceId: string): void {
    this.expandedDeviceId.set(this.expandedDeviceId() === deviceId ? '' : deviceId);
  }

  /**
   * Whether a phone's detail row is the expanded one.
   *
   * @param deviceId - The stable device id of the row.
   */
  isExpanded(deviceId: string): boolean {
    return this.expandedDeviceId() === deviceId;
  }

  /**
   * The row's display name under the device id: marketing name, falling back to the
   * build codename, then the device class.
   *
   * @param p - The phone row.
   */
  deviceName(p: PhoneDevice): string {
    return p.marketingName || p.codename || p.deviceClass || '';
  }

  /**
   * DOM id for a row's expandable detail region (also its button's aria-controls).
   * Keyed off the registry `id` (a DB UUID — always unique and id-charset-safe),
   * falling back to a sanitized deviceId. A raw deviceId can carry spaces/quotes
   * (the ingest DTO only bounds it @Size(max=128)), which would produce an invalid
   * HTML id — breaking the aria-controls linkage assistive tech relies on.
   *
   * @param p - The phone row.
   */
  detailDomId(p: PhoneDevice): string {
    const raw = p.id || p.deviceId || '';
    return 'pf-detail-' + raw.replace(/[^A-Za-z0-9_-]/g, '-');
  }
}
