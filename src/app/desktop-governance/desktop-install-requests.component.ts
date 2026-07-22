import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  BffService,
  DeviceRegistration,
  DesktopInstallRequest,
} from '../bff.service';
import { SessionService } from '../session.service';
import { MfaStepUpDialogComponent } from '../mfa/mfa-step-up-dialog.component';
import { isStepUpRequiredError } from '../mfa/step-up-error';

/** A per-row busy/result note surfaced inline next to a request action. */
interface RowNote { id: string; kind: 'ok' | 'err'; text: string; }

/**
 * The DESKTOP INSTALL-REQUEST inbox + REMOTE-INSTALL button (own repo: hugmesh-admin-ui).
 * The admin front-end for the desktop-governance install-request surface (admin-bff
 * {@code DesktopInstallRequestAdminController} at {@code /bff/admin/desktop/install-requests})
 * AND the remote-install trigger ({@code DesktopRemoteInstallController} at
 * {@code /bff/admin/desktop/remote-install}).
 *
 * <p>A non-sudo desktop user asks their admin to allow/install an app on their device. This
 * inbox lists the brand's PENDING requests (own brand for a scoped admin; all for a superadmin)
 * and lets the admin DECIDE each one:
 * <ul>
 *   <li><b>Deny</b> — CAS {@code pending -> denied}.</li>
 *   <li><b>Approve</b> — CAS {@code pending -> approved}; the approve form optionally
 *       <em>adds the app to the catalog</em> (and enables it, so Discover offers it) and/or
 *       <em>triggers a remote install</em> onto the requester's device in one action.</li>
 *   <li><b>Remote-install</b> — a one-click install of the approved app onto the device, riding
 *       the admin's device-SSH license. Surfaced as a button on an approved row too.</li>
 * </ul>
 *
 * <h3>Remote-install gating (defence-in-depth — the BFF is authoritative)</h3>
 * Remote-install RIDES the acting admin's device-ssh-license + the own-domain wall + the
 * <em>enabled</em>-allowlist check: a denial is a 403. The console disables the remote-install
 * button + shows helptext when the device is superadmin-owned or the admin holds no active
 * license for it (presentation only — the BFF re-enforces and a server 403 is surfaced verbatim).
 * The approve action does NOT pre-gate (an admin may approve + add-to-catalog without ever
 * remote-installing); the remote-install leg is what carries the license gate.
 */
@Component({
  selector: 'hug-desktop-install-requests',
  standalone: true,
  imports: [CommonModule, FormsModule, MfaStepUpDialogComponent],
  templateUrl: './desktop-install-requests.component.html',
  styleUrl: './desktop-governance.component.scss',
})
export class DesktopInstallRequestsComponent implements OnInit {
  private readonly bff = inject(BffService);
  private readonly session = inject(SessionService);

  readonly requests = signal<DesktopInstallRequest[]>([]);
  readonly devices = signal<DeviceRegistration[]>([]);
  readonly loaded = signal(false);

  /** Per-row inline notes (busy result / error). */
  readonly notes = signal<RowNote[]>([]);

  /** The id of the row whose remote-install is currently minting a step-up / running (so the UI
   *  can disable the button + show busy helptext). */
  readonly installing = signal<string | null>(null);

  /** A pending step-up challenge for a remote-install, or null when none is in flight. `retry`
   *  re-attempts the SAME remote-install once the inline {@link MfaStepUpDialogComponent} reports
   *  the challenge satisfied (token-less — the BFF reads the fresh MFA stamp off this session). */
  readonly stepUpChallenge = signal<null | { action: string; retry: () => Promise<void> }>(null);

  /** The pending inbox (the headline list) + the already-decided rows (kept for audit/history). */
  readonly pending = computed(() => this.requests().filter((r) => r.status === 'pending'));
  readonly decided = computed(() => this.requests().filter((r) => r.status !== 'pending'));

  /** Approve-form opt-ins keyed by request id (the row expands an approve panel). */
  readonly approveAddToCatalog = signal<Record<string, boolean>>({});
  readonly approveRemoteInstall = signal<Record<string, boolean>>({});
  readonly approveDisplayName = signal<Record<string, string>>({});
  /** The id of the row whose approve panel is open (only one at a time). */
  readonly openApprove = signal<string | null>(null);

  private get operator(): string { return (this.session.session()?.id ?? '').toLowerCase(); }

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    const [requests, devices] = await Promise.all([
      this.bff.desktopInstallRequests(),
      this.bff.devices(),
    ]);
    this.requests.set(requests);
    this.devices.set(devices);
    this.loaded.set(true);
  }

  /** The device row for a request (for the remote-install gate + a11y labels), or undefined. */
  deviceOf(r: DesktopInstallRequest): DeviceRegistration | undefined {
    return this.devices().find((d) => d.id === r.deviceId);
  }

  /** Whether the acting admin holds an ACTIVE device-ssh-license for the request's device. */
  hasLicense(r: DesktopInstallRequest): boolean {
    const d = this.deviceOf(r);
    if (!d) return false;
    const op = this.operator;
    return d.licenses.some((l) =>
      l.state === 'active'
      && (l.operator ?? '').toLowerCase() === op
      && (l.scope_type === 'DEVICE' ? l.device_id === d.id : (l.target_domain ?? '') === d.domain));
  }

  superadminOwned(r: DesktopInstallRequest): boolean {
    return this.deviceOf(r)?.owner_type === 'SUPERADMIN';
  }

  /** The single reason remote-install is blocked (presentation), or '' when permitted. */
  remoteInstallGate(r: DesktopInstallRequest): string {
    if (this.superadminOwned(r)) {
      return 'Superadmin-owned device — remote install is not available.';
    }
    if (!this.hasLicense(r)) {
      return 'You hold no active device-SSH license for this device — remote install is blocked.';
    }
    return '';
  }

  canRemoteInstall(r: DesktopInstallRequest): boolean {
    return this.remoteInstallGate(r) === '';
  }

  toggleApprove(id: string): void {
    this.openApprove.set(this.openApprove() === id ? null : id);
  }

  setAddToCatalog(id: string, v: boolean): void {
    this.approveAddToCatalog.update((m) => ({ ...m, [id]: v }));
  }
  setRemoteInstall(id: string, v: boolean): void {
    this.approveRemoteInstall.update((m) => ({ ...m, [id]: v }));
  }
  setDisplayName(id: string, v: string): void {
    this.approveDisplayName.update((m) => ({ ...m, [id]: v }));
  }

  /** Deny a request (CAS pending -> denied). */
  async deny(r: DesktopInstallRequest): Promise<void> {
    await this.decideRow(r, 'denied');
  }

  /**
   * Approve a request. Steps, each best-effort + independently reported:
   *  1. (optional) add the app to the brand catalog AND enable it (so Discover offers it).
   *  2. CAS the request pending -> approved.
   *  3. (optional) trigger a remote install onto the requester's device.
   * A failure in any optional step is surfaced inline but does not roll back the decide.
   */
  async approve(r: DesktopInstallRequest): Promise<void> {
    const addCatalog = !!this.approveAddToCatalog()[r.id];
    const remote = !!this.approveRemoteInstall()[r.id];

    if (addCatalog) {
      const display = (this.approveDisplayName()[r.id] ?? '').trim() || r.appRef;
      try {
        const entry = await this.bff.desktopCatalogAdd(r.appRef, display, 'FLATPAK');
        // add != enable — make it appear in Discover.
        await this.bff.desktopCatalogEnable(entry.id);
      } catch (e) {
        this.setNote(r.id, 'err', 'Approved decide pending; add-to-catalog failed: ' + (e as Error).message);
      }
    }

    const ok = await this.decideRow(r, 'approved', !remote && !addCatalog);
    if (!ok) return;

    if (remote) {
      await this.remoteInstall(r);
    }
  }

  /** Whether a remote install is currently minting/running for this row (busy = disable + helptext). */
  isInstalling(r: DesktopInstallRequest): boolean {
    return this.installing() === r.id;
  }

  /**
   * Trigger a one-click remote install for a request's app onto its device. Remote-install now
   * REQUIRES a step-up token (BFF fail-closed tightening): mint a fresh desktop step-up
   * IMMEDIATELY before the install call and carry it in the X-Device-Terminal-StepUp header.
   * Pre-gated for presentation; the BFF re-enforces and a 403 (missing step-up / no license /
   * cross-domain / ref-not-enabled — all collapsed to one generic message) is surfaced verbatim.
   * While the BFF ships dark, the not-ready result descriptor is surfaced as a note.
   */
  async remoteInstall(r: DesktopInstallRequest): Promise<void> {
    if (!this.canRemoteInstall(r)) {
      this.setNote(r.id, 'err', this.remoteInstallGate(r));
      return;
    }
    if (this.installing()) return; // a mint/install is already in flight
    this.installing.set(r.id);
    try {
      // Mint a fresh single-use step-up, then immediately spend it on the install.
      let stepUp: string;
      try {
        stepUp = (await this.bff.desktopStepUp()).stepUpToken;
      } catch (e) {
        // A "requires step-up" mint 403 (fresh MFA re-auth needed) opens the inline dialog and
        // the SAME install is retried on success; any other mint failure (e.g. no license) stays
        // a verbatim note.
        if (isStepUpRequiredError(e)) {
          this.offerStepUp('Remote-installing ' + r.appRef, () => this.remoteInstall(r));
          return;
        }
        this.setNote(r.id, 'err', 'Remote install requires step-up: ' + (e as Error).message);
        return;
      }
      const msg = await this.bff.desktopRemoteInstall(r.deviceId, r.appRef, stepUp);
      this.setNote(r.id, 'ok', 'Remote install triggered: ' + (msg || 'queued'));
      await this.reload();
    } catch (e) {
      if (isStepUpRequiredError(e)) {
        this.offerStepUp('Remote-installing ' + r.appRef, () => this.remoteInstall(r));
        return;
      }
      this.setNote(r.id, 'err', 'Remote install denied: ' + (e as Error).message);
    } finally {
      this.installing.set(null);
    }
  }

  /** Offer the inline MFA step-up dialog for a remote-install that just 403'd with the
   *  "requires step-up" contract. `retry` is invoked once the dialog reports success. */
  private offerStepUp(action: string, retry: () => Promise<void>): void {
    this.stepUpChallenge.set({ action, retry });
  }

  /** The inline step-up dialog reported success — retry the remote-install it was blocking (the
   *  BFF now mints/accepts against a fresh MFA stamp on this session; no token needed here). */
  async onStepUpSatisfied(): Promise<void> {
    const challenge = this.stepUpChallenge();
    this.stepUpChallenge.set(null);
    if (challenge) await challenge.retry();
  }

  /** The user cancelled the step-up dialog — drop the pending retry. */
  onStepUpDismissed(): void {
    this.stepUpChallenge.set(null);
  }

  /** Issue the decide CAS; reload + (optionally) report on success. Returns whether it stuck. */
  private async decideRow(r: DesktopInstallRequest, status: 'approved' | 'denied',
                          report = true): Promise<boolean> {
    try {
      const res = await this.bff.desktopDecideRequest(r.id, status);
      if (res.decided === 0) {
        this.setNote(r.id, 'err', 'No change — the request was already decided or out of scope.');
        await this.reload();
        return false;
      }
      if (report) this.setNote(r.id, 'ok', 'Request ' + status + '.');
      this.openApprove.set(null);
      await this.reload();
      return true;
    } catch (e) {
      this.setNote(r.id, 'err', (e as Error).message);
      return false;
    }
  }

  private setNote(id: string, kind: 'ok' | 'err', text: string): void {
    this.notes.update((cur) => [...cur.filter((n) => n.id !== id), { id, kind, text }]);
  }
  noteFor(id: string): RowNote | undefined {
    return this.notes().find((n) => n.id === id);
  }

  requestLabel(r: DesktopInstallRequest): string {
    return `${r.appRef} for ${r.requester} on ${this.deviceOf(r)?.hostname ?? r.deviceId}`;
  }
}
