import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, PhoneDevice } from './bff.service';
import { MfaStepUpDialogComponent } from './mfa/mfa-step-up-dialog.component';
import { isStepUpRequiredError } from './mfa/step-up-error';

/**
 * Superadmin "Phone fleet" console (own repo: hugmesh-admin-ui). Lists the sovereign
 * MDM phone registry — every Android phone that has INGESTED (self-reported its provisioning
 * snapshot to the admin BFF) — and gives a superadmin device-management + lockout ACTIONS.
 * SUPERADMIN-only (route-guarded by {@link superadminGuard}; the BFF re-enforces the role on
 * every read AND every mutation).
 *
 * <p>The table shows one row per phone (identity, OS, role, a MANAGEMENT chip managed/BYOD,
 * a LOCK chip locked/unlocked, attached domain, tailscale address, enterprise-profile presence,
 * attestation verdict, ingest telemetry), newest ingest activity first — the BFF's own
 * ordering, preserved as-is. Each row expands into the FULL record plus a "Device management"
 * block with the authoritative managementMode/lockState/propagation and the SUPERADMIN actions.
 *
 * <p>Management + lock are AUTHORITATIVE and operator-set: `managementMode` (mesh_owned/unmanaged)
 * is written only here (never self-claimed by a device — the device-reported `mdmEnrolled` is
 * shown separately as an advisory promotion hint). Lock is permitted ONLY for a mesh_owned
 * (managed) device; a BYOD row's Lock control is disabled with a helper note. All three
 * mutations (mark/clear managed, lock, unlock) are step-up gated: a "requires step-up" 403 opens
 * the inline {@link MfaStepUpDialogComponent} and the SAME action is retried once the dialog
 * reports success (a blind retry — no token needed, the BFF reads freshness off this session).
 * Reads stay fail-soft; mutations throw → an inline note.
 */
@Component({
  selector: 'hug-phone-fleet',
  standalone: true,
  imports: [CommonModule, FormsModule, MfaStepUpDialogComponent],
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

  // ── Management / lock actions (only ONE detail row is ever open, so this state is NOT
  //    device-keyed — it always describes the currently-expanded row, mirroring
  //    device-licenses' ssh-issuance panel state). ──
  /** True while a management/lock mutation is in flight — disables every action button. */
  readonly busy = signal(false);
  /** The last action's inline result/error, or null. `kind` drives role=alert vs role=status. */
  readonly actionNote = signal<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /** A pending step-up challenge for a management/lock action, or null. `retry` re-attempts the
   *  SAME action once the inline dialog reports success (a blind retry, no re-confirm). */
  readonly stepUpChallenge = signal<null | { action: string; retry: () => Promise<void> }>(null);
  /** The reason typed for a Lock action (bound to the expanded row's inline input). Cleared on a
   *  successful lock and whenever the open row changes. */
  lockReason = '';
  /** The physicalOwner (Casdoor subject) typed for an owner-assignment on the expanded row.
   *  Prefilled from the row's current owner on expand; cleared/re-prefilled when the open row
   *  changes. */
  ownerPhysical = '';
  /** The ownerDomain (brand/domain) typed for an owner-assignment on the expanded row. */
  ownerDomain = '';

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
    const next = this.expandedDeviceId() === deviceId ? '' : deviceId;
    this.expandedDeviceId.set(next);
    // The action state (note, typed lock reason, owner-assignment inputs) is shared across rows
    // since only one detail is ever open — reset it on every open/close so a stale note from
    // another row can't bleed through under the newly-expanded phone. The owner inputs are
    // PREFILLED from the newly-expanded row's current owner (so an edit starts from the current
    // value, not blank).
    this.actionNote.set(null);
    this.stepUpChallenge.set(null);
    this.lockReason = '';
    const opened = next ? this.phones().find((p) => p.deviceId === next) : undefined;
    this.ownerPhysical = opened?.physicalOwner ?? '';
    this.ownerDomain = opened?.ownerDomain ?? '';
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

  // ── Device management + lockout actions (SUPERADMIN, step-up gated) ────────────────

  /** Human label for a row's authoritative management mode: managed (mesh-owned) vs BYOD. */
  managementLabel(p: PhoneDevice): string {
    return p.managementMode === 'mesh_owned' ? 'managed' : 'BYOD';
  }

  /** Human label for a row's DEVICE-REPORTED MDM provider: 'Azure Intune' for the cloud Graph
   *  backend, 'Headwind' for the sovereign self-hosted DPC (the default when unset/null). */
  providerLabel(p: PhoneDevice): string {
    return p.mdmProvider === 'azure-intune' ? 'Azure Intune' : 'Headwind';
  }

  /** Lock is permitted ONLY for a MANAGED (mesh_owned) device — a BYOD/unmanaged phone is not
   *  lockable (the BFF answers a clean 409), so the Lock control is disabled for it. */
  canLock(p: PhoneDevice): boolean {
    return p.managementMode === 'mesh_owned';
  }

  /**
   * True while any management/lock action is in flight OR a step-up dialog is open, so the
   * row's other action buttons stay disabled. Blocking on an open challenge (not just `busy`)
   * prevents a second action from overwriting the pending {@link stepUpChallenge} and orphaning
   * the first action's retry — every action is still independently server-gated, this is a UX
   * guard, not the security boundary.
   */
  actionsLocked(): boolean {
    return this.busy() || this.stepUpChallenge() !== null;
  }

  /** Swap an updated row in place by its stable deviceId (the mutations return the updated
   *  PhoneDevice — no full refetch needed to reflect the new management/lock state). */
  private updateRow(updated: PhoneDevice): void {
    this.phones.update((list) => list.map((p) => (p.deviceId === updated.deviceId ? updated : p)));
  }

  /**
   * Run a privileged management/lock mutation behind the busy guard. A "requires step-up" 403
   * opens the inline MFA dialog and BLINDLY retries {@code fn} on success (the same closure — no
   * re-confirmation, no token needed); any other failure sets an inline error note. Shared by all
   * four actions (mark/clear managed, lock, unlock), mirroring device-licenses' runSshGated.
   */
  private async runGated(action: string, fn: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionNote.set(null);
    try {
      await fn();
    } catch (e) {
      if (isStepUpRequiredError(e)) {
        this.offerStepUp(action, () => this.runGated(action, fn));
        return;
      }
      this.actionNote.set({ kind: 'err', text: e instanceof Error ? e.message : 'The action could not be completed.' });
    } finally {
      this.busy.set(false);
    }
  }

  /** Mark an UNMANAGED phone as managed (mesh_owned) — the authoritative promotion. */
  async markManaged(p: PhoneDevice): Promise<void> {
    await this.runGated('Marking this phone managed', async () => {
      const updated = await this.bff.setPhoneManagement(p.deviceId, 'mesh_owned');
      this.updateRow(updated);
      this.actionNote.set({ kind: 'ok', text: `${updated.deviceId} is now managed (mesh-owned).` });
    });
  }

  /**
   * Clear the managed flag (mesh_owned → unmanaged). DESTRUCTIVE when the device is LOCKED —
   * clearing also unlocks it server-side (a BYOD device cannot stay locked) — so a native
   * confirm() (that warns about the implicit unlock) gates it. The confirm is OUTSIDE
   * {@link runGated} deliberately: a step-up retry re-invokes only the gated network call, never
   * re-prompts the operator (the platform's step-up dialogs are always a blind retry).
   */
  async clearManaged(p: PhoneDevice): Promise<void> {
    if (this.busy()) return;
    const warning = p.lockState === 'locked'
      ? `Clear the managed flag on ${p.deviceId}? It is currently LOCKED — clearing will also UNLOCK it `
        + '(a BYOD device cannot stay locked).'
      : `Clear the managed flag on ${p.deviceId}? It becomes BYOD and can no longer be locked.`;
    if (!confirm(warning)) return;
    await this.runGated('Clearing the managed flag', async () => {
      const updated = await this.bff.setPhoneManagement(p.deviceId, 'unmanaged');
      this.updateRow(updated);
      this.actionNote.set({ kind: 'ok', text: `${updated.deviceId} is now unmanaged (BYOD).` });
    });
  }

  /**
   * Lock a MANAGED phone with the typed reason. Validates a non-blank reason, then a native
   * confirm() gates the (destructive) enforcement push — the confirm is OUTSIDE runGated so a
   * step-up retry never re-prompts. Enabled only when {@link canLock}; the template also disables
   * the control for a BYOD row.
   */
  async lock(p: PhoneDevice): Promise<void> {
    if (this.busy()) return;
    if (!this.canLock(p)) {
      this.actionNote.set({ kind: 'err', text: 'This is a BYOD (unmanaged) device — mark it managed before locking.' });
      return;
    }
    const reason = this.lockReason.trim();
    if (!reason) {
      this.actionNote.set({ kind: 'err', text: 'Enter a reason before locking this device.' });
      return;
    }
    if (!confirm(`Lock ${p.deviceId}? This commands a device-owner lock across the enabled enforcement channels.`)) return;
    await this.runGated('Locking this phone', async () => {
      const updated = await this.bff.lockPhone(p.deviceId, reason);
      this.updateRow(updated);
      this.lockReason = '';
      this.actionNote.set({
        kind: 'ok',
        text: `${updated.deviceId} locked (propagation ${updated.lockPropagationState ?? 'pending'}).`,
      });
    });
  }

  /** Unlock a phone (reversible; no confirm — unlocking only relaxes state). */
  async unlock(p: PhoneDevice): Promise<void> {
    await this.runGated('Unlocking this phone', async () => {
      const updated = await this.bff.unlockPhone(p.deviceId);
      this.updateRow(updated);
      this.actionNote.set({ kind: 'ok', text: `${updated.deviceId} unlocked.` });
    });
  }

  /**
   * Assign this phone's OPERATOR-AUTHORITATIVE fleet owner (physicalOwner Casdoor subject +
   * ownerDomain brand) — the two changeset-305 columns that ARE the tenancy wall for the public
   * fleet-owner surface. SUPERADMIN provisioning, step-up gated (via {@link runGated}). BOTH
   * fields are required (the BFF rejects a blank one with 400); validated here so an empty
   * submit surfaces an inline error instead of a network round-trip. Not destructive → no
   * confirm(). Once assigned, the FLEET_ADMIN/ADMIN owner (with an active entitlement) can
   * manage the device from their own "My fleet" console.
   */
  async assignOwner(p: PhoneDevice): Promise<void> {
    if (this.busy()) return;
    const physicalOwner = this.ownerPhysical.trim();
    const ownerDomain = this.ownerDomain.trim();
    if (!physicalOwner || !ownerDomain) {
      this.actionNote.set({
        kind: 'err',
        text: 'Enter both a physical owner (Casdoor subject) and an owner domain.',
      });
      return;
    }
    await this.runGated('Assigning the fleet owner', async () => {
      const updated = await this.bff.setPhoneOwner(p.deviceId, { physicalOwner, ownerDomain });
      this.updateRow(updated);
      this.actionNote.set({
        kind: 'ok',
        text: `${updated.deviceId} owner set to ${updated.physicalOwner} (${updated.ownerDomain}).`,
      });
    });
  }

  /** Offer the inline MFA step-up dialog for an action that 403'd. Clears the busy flag so the
   *  dialog itself is interactive (the retry re-sets it). */
  private offerStepUp(action: string, retry: () => Promise<void>): void {
    this.busy.set(false);
    this.stepUpChallenge.set({ action, retry });
  }

  /** The inline step-up dialog reported success — retry the gated action it was blocking. */
  async onStepUpSatisfied(): Promise<void> {
    const challenge = this.stepUpChallenge();
    this.stepUpChallenge.set(null);
    if (challenge) await challenge.retry();
  }

  /** The user cancelled the step-up dialog — drop the pending retry. */
  onStepUpDismissed(): void {
    this.stepUpChallenge.set(null);
  }
}
