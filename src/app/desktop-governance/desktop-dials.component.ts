import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BffService, DeviceSshDial } from '../bff.service';
import { SessionService } from '../session.service';
import { MfaStepUpDialogComponent } from '../mfa/mfa-step-up-dialog.component';
import { isStepUpRequiredError } from '../mfa/step-up-error';

/** A per-row inline note (action result / error). */
interface DialNote { deviceId: string; kind: 'ok' | 'err'; text: string; }

/**
 * The SSH-DIAL MANAGEMENT sub-tab (own repo: snapdragon-admin-ui). The SUPERADMIN-only front-end
 * for the desktop-governance dial control plane (admin-bff at
 * {@code /bff/superadmin/desktop/dials}). Each {@code device_ssh_dial} row is the per-device
 * BFF&rarr;device SSH trust: the BFF authenticates to the device as the dial user using a
 * Vault/ESO-mounted dial key (never shown here — only NON-SECRET fingerprints/refs are projected).
 * The in-UI SSH terminal and one-click remote-install cannot go live for a device until its dial
 * is <b>ACTIVE</b>.
 *
 * <h3>Deliberate SUPERADMIN actions</h3>
 * <ul>
 *   <li><b>Activate</b> — a deliberate {@code PENDING -> ACTIVE} flip (generation bumped). The BFF
 *       REFUSES activation of a row with no host-key pin (422) — the verifying pinned test-connect
 *       is held-until-live behind {@code app.device-terminal.dial.enabled}.</li>
 *   <li><b>Revoke</b> — a CAS {@code -> REVOKED}.</li>
 * </ul>
 * Both REQUIRE a fresh single-use step-up token (minted via {@link BffService#desktopStepUp},
 * carried in the shared {@code X-Device-Terminal-StepUp} header).
 *
 * <h3>Visibility (cosmetic; the BFF is authoritative)</h3>
 * The tab is shown only when {@link SessionService#isSuperadmin} AND a capability probe reports the
 * dial leg enabled (HIDDEN-tier, mirroring the workload-console probe). A plain ADMIN never sees
 * it, and the BFF re-enforces {@code hasRole('SUPERADMIN')} on every endpoint; a denied/dark list
 * collapses to an empty list (no existence leak).
 */
@Component({
  selector: 'snap-desktop-dials',
  standalone: true,
  imports: [CommonModule, MfaStepUpDialogComponent],
  templateUrl: './desktop-dials.component.html',
  styleUrl: './desktop-governance.component.scss',
})
export class DesktopDialsComponent implements OnInit {
  private readonly bff = inject(BffService);
  private readonly session = inject(SessionService);

  readonly isSuperadmin = computed(() => this.session.isSuperadmin());

  readonly dials = signal<DeviceSshDial[]>([]);
  readonly loaded = signal(false);
  /** The device id currently minting/running an activate/revoke (busy = disable + helptext). */
  readonly busy = signal<string | null>(null);
  readonly notes = signal<DialNote[]>([]);

  /** A pending step-up challenge for an activate/revoke, or null when none is in flight. `retry`
   *  re-attempts the SAME action once the inline {@link MfaStepUpDialogComponent} reports the
   *  challenge satisfied (token-less — the BFF reads the fresh MFA stamp off this session). */
  readonly stepUpChallenge = signal<null | { action: string; retry: () => Promise<void> }>(null);

  async ngOnInit(): Promise<void> {
    // Defence-in-depth: a plain ADMIN should never have reached this component (the shell hides
    // the tab), but never fetch the SUPERADMIN list for a non-superadmin.
    if (!this.isSuperadmin()) {
      this.loaded.set(true);
      return;
    }
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.dials.set(await this.bff.desktopDials());
    this.loaded.set(true);
  }

  /** A dial may be activated only from PENDING and only when it carries a host-key pin (the BFF
   *  re-enforces 422; this is presentation only). */
  canActivate(d: DeviceSshDial): boolean {
    return d.status === 'PENDING' && !!d.hostKeyFp && this.busy() === null;
  }

  /** The single reason activate is blocked (presentation), or '' when permitted. */
  activateGate(d: DeviceSshDial): string {
    if (d.status === 'ACTIVE') return 'Already active.';
    if (d.status === 'REVOKED') return 'Revoked — re-provision the dial before it can be activated.';
    if (!d.hostKeyFp) {
      return 'No host-key pin recorded — activation is refused until the device host key is pinned.';
    }
    if (this.busy() !== null) return 'Another dial action is in flight.';
    return '';
  }

  canRevoke(d: DeviceSshDial): boolean {
    return d.status !== 'REVOKED' && this.busy() === null;
  }

  isBusy(d: DeviceSshDial): boolean {
    return this.busy() === d.deviceId;
  }

  async activate(d: DeviceSshDial): Promise<void> {
    if (!this.canActivate(d)) {
      this.setNote(d.deviceId, 'err', this.activateGate(d));
      return;
    }
    await this.run(d, (token) => this.bff.desktopDialActivate(d.deviceId, token), 'activated');
  }

  async revoke(d: DeviceSshDial): Promise<void> {
    if (!this.canRevoke(d)) return;
    if (!confirm(`Revoke the SSH dial for device "${d.deviceId}"? The in-UI terminal + remote `
      + 'install will stop working on it until a new dial is provisioned and activated.')) return;
    await this.run(d, (token) => this.bff.desktopDialRevoke(d.deviceId, token), 'revoked');
  }

  /** Mint a fresh step-up, spend it on the action, then reload. A "requires step-up" 403 on the
   *  mint OR the activate/revoke leg opens the inline MFA dialog and the SAME action is retried on
   *  success; any other 422/503/404/403 surfaces verbatim (the BFF collapses device-targeting
   *  denials to one generic message). */
  private async run(d: DeviceSshDial, action: (token: string) => Promise<DeviceSshDial>,
                    verb: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(d.deviceId);
    try {
      let stepUp: string;
      try {
        stepUp = (await this.bff.desktopStepUp()).stepUpToken;
      } catch (e) {
        if (isStepUpRequiredError(e)) {
          this.offerStepUp(this.actionLabel(verb), () => this.run(d, action, verb));
          return;
        }
        this.setNote(d.deviceId, 'err', 'Step-up required: ' + (e as Error).message);
        return;
      }
      await action(stepUp);
      this.setNote(d.deviceId, 'ok', `Dial ${verb}.`);
      await this.reload();
    } catch (e) {
      if (isStepUpRequiredError(e)) {
        this.offerStepUp(this.actionLabel(verb), () => this.run(d, action, verb));
        return;
      }
      this.setNote(d.deviceId, 'err', (e as Error).message);
    } finally {
      this.busy.set(null);
    }
  }

  private actionLabel(verb: string): string {
    return verb === 'activated' ? 'Activating this SSH dial' : 'Revoking this SSH dial';
  }

  /** Offer the inline MFA step-up dialog for an activate/revoke that just 403'd with the
   *  "requires step-up" contract. `retry` is invoked once the dialog reports success. */
  private offerStepUp(action: string, retry: () => Promise<void>): void {
    this.stepUpChallenge.set({ action, retry });
  }

  /** The inline step-up dialog reported success — retry the action it was blocking (the BFF now
   *  mints/accepts against a fresh MFA stamp on this session; no token is needed here). */
  async onStepUpSatisfied(): Promise<void> {
    const challenge = this.stepUpChallenge();
    this.stepUpChallenge.set(null);
    if (challenge) await challenge.retry();
  }

  /** The user cancelled the step-up dialog — drop the pending retry. */
  onStepUpDismissed(): void {
    this.stepUpChallenge.set(null);
  }

  private setNote(deviceId: string, kind: 'ok' | 'err', text: string): void {
    this.notes.update((cur) => [...cur.filter((n) => n.deviceId !== deviceId), { deviceId, kind, text }]);
  }
  noteFor(deviceId: string): DialNote | undefined {
    return this.notes().find((n) => n.deviceId === deviceId);
  }

  statusLabel(d: DeviceSshDial): string {
    return `Dial ${d.status.toLowerCase()} for device ${d.deviceId} (user ${d.dialUser})`;
  }
}
