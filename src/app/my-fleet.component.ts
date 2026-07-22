import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, PhoneDevice } from './bff.service';
import { MfaStepUpDialogComponent } from './mfa/mfa-step-up-dialog.component';
import { isStepUpRequiredError } from './mfa/step-up-error';

/**
 * The "My fleet" console — the FLEET-OWNER view over the PUBLIC `/bff/admin/phone-fleet/**`
 * plane. A non-superadmin FLEET_ADMIN (or ADMIN) sees ONLY THEIR OWN phones and may lock/unlock
 * a managed one; it is the tenancy-walled twin of the SUPERADMIN {@link PhoneFleetComponent}.
 * Route-guarded by {@link fleetAdminGuard} (fleet_admin/admin/superadmin), but the BFF is the
 * authoritative gate — it re-enforces the role AND the per-subject entitlement AND scopes every
 * read/mutation to `physical_owner = caller AND owner_domain = caller-domain`.
 *
 * <p>The UI deliberately does NOT re-implement the owner/domain scoping (the BFF already did it —
 * this list renders exactly what `ownedPhones()` returned) and, critically, exposes NONE of the
 * SUPERADMIN provisioning affordances: there is no Mark-managed and no owner-assignment here
 * (those live only on the superadmin fleet page). A fleet owner can lock/unlock an
 * ALREADY-owned, ALREADY-managed device; a BYOD (unmanaged) row's Lock control is disabled with
 * a helper note (the BFF answers a clean 409). All mutations are step-up gated: a "requires
 * step-up" 403 opens the inline {@link MfaStepUpDialogComponent} and blindly retries the same
 * action on success. Reads stay fail-soft (a denied/un-entitled read shows an honest empty
 * fleet, never an error); mutations throw → an inline note. The step-up + busy/actionsLocked
 * plumbing mirrors PhoneFleetComponent exactly.
 */
@Component({
  selector: 'snap-my-fleet',
  standalone: true,
  imports: [CommonModule, FormsModule, MfaStepUpDialogComponent],
  templateUrl: './my-fleet.component.html',
  styleUrl: './my-fleet.component.scss',
})
export class MyFleetComponent implements OnInit {
  private readonly bff = inject(BffService);

  /** The caller's OWN phones, exactly as the BFF returned them (owner+domain scoped server-side). */
  readonly phones = signal<PhoneDevice[]>([]);
  /** True while a fleet load/refresh is in flight. */
  readonly loading = signal(true);
  /** Message from a NETWORK-level failure only — the BFF read itself is fail-soft (a denied /
   *  un-entitled read yields []). Displayed in a role=alert region; empty = no error. */
  readonly loadError = signal('');
  /** The deviceId whose detail row is expanded, or '' when none (one at a time). */
  readonly expandedDeviceId = signal('');

  // ── Lock/unlock action state (shared — only ONE detail row is ever open). ──
  /** True while a lock/unlock mutation is in flight — disables every action button. */
  readonly busy = signal(false);
  /** The last action's inline result/error, or null. `kind` drives role=alert vs role=status. */
  readonly actionNote = signal<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /** A pending step-up challenge for a lock/unlock action, or null. `retry` re-attempts the
   *  SAME action once the inline dialog reports success (a blind retry, no re-confirm). */
  readonly stepUpChallenge = signal<null | { action: string; retry: () => Promise<void> }>(null);
  /** The reason typed for a Lock action (bound to the expanded row's inline input). */
  lockReason = '';

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  /**
   * Load (or re-load) the caller's own fleet from `GET /bff/admin/phone-fleet`. The Refresh
   * button re-invokes this; an expanded row stays expanded across a refresh when its phone is
   * still listed (the detail row keys off deviceId, not index).
   */
  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.phones.set(await this.bff.ownedPhones());
      this.loadError.set('');
    } catch (e) {
      // A rejection is not guaranteed to be an Error — coerce so the role=alert region never
      // silently blanks on a bare string/object rejection.
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
    // Only one detail is ever open, so this shared action state is reset on every open/close
    // to stop a stale note / typed reason bleeding under the newly-expanded phone.
    this.actionNote.set(null);
    this.stepUpChallenge.set(null);
    this.lockReason = '';
  }

  /** Whether a phone's detail row is the expanded one. */
  isExpanded(deviceId: string): boolean {
    return this.expandedDeviceId() === deviceId;
  }

  /** The row's display name: marketing name, falling back to the codename, then the class. */
  deviceName(p: PhoneDevice): string {
    return p.marketingName || p.codename || p.deviceClass || '';
  }

  /**
   * DOM id for a row's expandable detail region (also its button's aria-controls). Keyed off the
   * registry `id` (a DB UUID — always id-charset-safe), falling back to a sanitized deviceId (a
   * raw deviceId can carry spaces/quotes — @Size(max=128) only — which would break the aria
   * linkage), mirroring PhoneFleetComponent.detailDomId.
   */
  detailDomId(p: PhoneDevice): string {
    const raw = p.id || p.deviceId || '';
    return 'mf-detail-' + raw.replace(/[^A-Za-z0-9_-]/g, '-');
  }

  /** Human label for a row's management mode: managed (mesh-owned) vs BYOD. */
  managementLabel(p: PhoneDevice): string {
    return p.managementMode === 'mesh_owned' ? 'managed' : 'BYOD';
  }

  /** Lock is permitted ONLY for a MANAGED (mesh_owned) device — a BYOD phone is not lockable
   *  (the BFF answers a clean 409), so the Lock control is disabled for it. */
  canLock(p: PhoneDevice): boolean {
    return p.managementMode === 'mesh_owned';
  }

  /**
   * True while any action is in flight OR a step-up dialog is open, so the row's other action
   * buttons stay disabled. Blocking on an open challenge (not just `busy`) prevents a second
   * action from overwriting the pending {@link stepUpChallenge} and orphaning the first action's
   * retry — a UX guard, not the security boundary (every action is still server-gated).
   */
  actionsLocked(): boolean {
    return this.busy() || this.stepUpChallenge() !== null;
  }

  /** Swap an updated row in place by its stable deviceId (the mutations return the updated
   *  PhoneDevice — no full refetch needed to reflect the new lock state). */
  private updateRow(updated: PhoneDevice): void {
    this.phones.update((list) => list.map((p) => (p.deviceId === updated.deviceId ? updated : p)));
  }

  /**
   * Run a lock/unlock mutation behind the busy guard. A "requires step-up" 403 opens the inline
   * MFA dialog and BLINDLY retries {@code fn} on success (the same closure); any other failure
   * sets an inline error note. Mirrors PhoneFleetComponent.runGated.
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

  /**
   * Lock one of the caller's OWN managed phones with the typed reason. Validates a non-blank
   * reason, then a native confirm() gates the (destructive) enforcement push — the confirm is
   * OUTSIDE runGated so a step-up retry never re-prompts. Enabled only when {@link canLock}.
   */
  async lock(p: PhoneDevice): Promise<void> {
    if (this.busy()) return;
    if (!this.canLock(p)) {
      this.actionNote.set({ kind: 'err', text: 'This is a BYOD (unmanaged) device — it is not lockable.' });
      return;
    }
    const reason = this.lockReason.trim();
    if (!reason) {
      this.actionNote.set({ kind: 'err', text: 'Enter a reason before locking this device.' });
      return;
    }
    if (!confirm(`Lock ${p.deviceId}? This commands a device-owner lock across the enabled enforcement channels.`)) return;
    await this.runGated('Locking this phone', async () => {
      const updated = await this.bff.lockOwnedPhone(p.deviceId, reason);
      this.updateRow(updated);
      this.lockReason = '';
      this.actionNote.set({
        kind: 'ok',
        text: `${updated.deviceId} locked (propagation ${updated.lockPropagationState ?? 'pending'}).`,
      });
    });
  }

  /** Unlock one of the caller's OWN phones (reversible; no confirm — unlocking only relaxes state). */
  async unlock(p: PhoneDevice): Promise<void> {
    await this.runGated('Unlocking this phone', async () => {
      const updated = await this.bff.unlockOwnedPhone(p.deviceId);
      this.updateRow(updated);
      this.actionNote.set({ kind: 'ok', text: `${updated.deviceId} unlocked.` });
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
