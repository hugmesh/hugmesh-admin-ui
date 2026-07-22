import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, FleetEntitlement } from './bff.service';
import { MfaStepUpDialogComponent } from './mfa/mfa-step-up-dialog.component';
import { isStepUpRequiredError } from './mfa/step-up-error';

/**
 * The SUPERADMIN "Fleet entitlements" console — grant / update / revoke the per-subject
 * FLEET-ADMIN subscription (admin-bff changeset 306) that a non-superadmin FLEET_ADMIN needs to
 * reach the public "My fleet" ({@code /bff/admin/phone-fleet/**}) owner surface. SUPERADMIN-only
 * (route-guarded by {@link superadminGuard}; the BFF re-enforces {@code hasRole('SUPERADMIN')} on
 * every read AND every mutation, and both mutations additionally require step-up).
 *
 * <p>The table lists every entitlement (subject, active on/off, advisory seats, optional expiry,
 * last updated). The grant form upserts a subject's entitlement ({@code active} defaults true, an
 * optional non-negative {@code seats} count, an optional expiry the BFF evaluates fail-closed);
 * each row carries a Revoke. Both mutations are step-up gated: a "requires step-up" 403 opens the
 * inline {@link MfaStepUpDialogComponent} and blindly retries the SAME action on success. Reads
 * stay fail-soft (a denied read shows an honest empty list, never an error); mutations throw → an
 * inline note. The busy/actionsLocked/step-up plumbing mirrors PhoneFleetComponent.
 */
@Component({
  selector: 'snap-fleet-entitlements',
  standalone: true,
  imports: [CommonModule, FormsModule, MfaStepUpDialogComponent],
  templateUrl: './fleet-entitlements.component.html',
  styleUrl: './fleet-entitlements.component.scss',
})
export class FleetEntitlementsComponent implements OnInit {
  private readonly bff = inject(BffService);

  /** Every fleet-admin entitlement (the BFF's ordering, preserved). */
  readonly entitlements = signal<FleetEntitlement[]>([]);
  /** True while a load/refresh is in flight. */
  readonly loading = signal(true);
  /** Message from a NETWORK-level load failure only — the BFF read itself is fail-soft. */
  readonly loadError = signal('');

  // ── Grant form (ngModel-bound plain fields). ──
  /** The Casdoor subject to grant/update (e.g. `casdoor:alice`). */
  subject = '';
  /** The active on/off switch (defaults true — a bare grant enables access). */
  active = true;
  /** Advisory seat count (NOT enforced by the tenancy wall); blank/null = unset. */
  seats: number | null = null;
  /** Optional expiry as a datetime-local string; blank = no expiry. Converted to ISO on submit. */
  expiresAt = '';

  // ── Mutation state (shared — grant + revoke). ──
  /** True while a grant/revoke mutation is in flight — disables every action button. */
  readonly busy = signal(false);
  /** The last action's inline result/error, or null. `kind` drives role=alert vs role=status. */
  readonly actionNote = signal<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /** A pending step-up challenge, or null. `retry` re-attempts the SAME action on success. */
  readonly stepUpChallenge = signal<null | { action: string; retry: () => Promise<void> }>(null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  /** Load (or re-load) every entitlement from `GET /bff/superadmin/fleet-entitlements`. */
  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.entitlements.set(await this.bff.listFleetEntitlements());
      this.loadError.set('');
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * True while a mutation is in flight OR a step-up dialog is open, so the form + row actions
   * stay disabled (blocking on an open challenge prevents a second action orphaning the first
   * action's retry). A UX guard — the BFF is still the security boundary.
   */
  actionsLocked(): boolean {
    return this.busy() || this.stepUpChallenge() !== null;
  }

  /** Human label for an entitlement's effective state. */
  stateLabel(e: FleetEntitlement): string {
    if (!e.active) return 'inactive';
    if (e.expiresAt && new Date(e.expiresAt).getTime() <= Date.now()) return 'expired';
    return 'active';
  }

  /**
   * Run a grant/revoke mutation behind the busy guard. A "requires step-up" 403 opens the inline
   * MFA dialog and BLINDLY retries {@code fn} on success; any other failure sets an inline error
   * note. Mirrors PhoneFleetComponent.runGated.
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
   * Grant OR update (upsert) a subject's fleet-admin entitlement. Validates a non-blank subject
   * and a well-formed optional expiry, CAPTURES the current form values (so a step-up retry
   * reuses them even if the form is edited meanwhile), then upserts behind the step-up gate. On
   * success the returned row replaces/prepends into the table and the subject field is cleared.
   */
  async grant(): Promise<void> {
    if (this.busy()) return;
    const subject = this.subject.trim();
    if (!subject) {
      this.actionNote.set({ kind: 'err', text: 'Enter a subject (Casdoor identity) to grant.' });
      return;
    }
    const active = this.active;
    const seats = this.seats;
    const expiresAtIso = this.toIso(this.expiresAt);
    if (this.expiresAt.trim() && !expiresAtIso) {
      this.actionNote.set({ kind: 'err', text: 'Enter a valid expiry date/time, or leave it blank for no expiry.' });
      return;
    }
    if (seats != null && seats < 0) {
      this.actionNote.set({ kind: 'err', text: 'Seats must not be negative.' });
      return;
    }
    await this.runGated('Granting this entitlement', async () => {
      const body: { active: boolean; seats?: number | null; expiresAt?: string | null } = { active };
      if (seats != null) body.seats = seats;
      if (expiresAtIso) body.expiresAt = expiresAtIso;
      const saved = await this.bff.upsertFleetEntitlement(subject, body);
      this.upsertRow(saved);
      this.subject = '';
      this.actionNote.set({
        kind: 'ok',
        text: `Entitlement for ${saved.subject} saved (${this.stateLabel(saved)}).`,
      });
    });
  }

  /**
   * Revoke a subject's entitlement. DESTRUCTIVE (they lose the fleet-owner console) → a native
   * confirm() gates it, OUTSIDE runGated so a step-up retry never re-prompts. On success the row
   * is removed from the table.
   */
  async revoke(e: FleetEntitlement): Promise<void> {
    if (this.busy()) return;
    if (!confirm(
      `Revoke the fleet entitlement for ${e.subject}? They lose access to the fleet-owner console `
      + '(their devices stay owned, but they can no longer manage them).')) {
      return;
    }
    await this.runGated('Revoking this entitlement', async () => {
      await this.bff.removeFleetEntitlement(e.subject);
      this.entitlements.update((list) => list.filter((x) => x.subject !== e.subject));
      this.actionNote.set({ kind: 'ok', text: `Entitlement for ${e.subject} revoked.` });
    });
  }

  /** Convert a datetime-local (or ISO) string to an ISO-8601 instant, or null when blank/invalid. */
  private toIso(v: string): string | null {
    const s = v.trim();
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  /** Insert or replace a saved entitlement by its subject (upsert returns the persisted row). */
  private upsertRow(saved: FleetEntitlement): void {
    this.entitlements.update((list) => {
      const idx = list.findIndex((e) => e.subject === saved.subject);
      if (idx >= 0) {
        const copy = [...list];
        copy[idx] = saved;
        return copy;
      }
      return [saved, ...list];
    });
  }

  /** Offer the inline MFA step-up dialog for an action that 403'd. */
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
