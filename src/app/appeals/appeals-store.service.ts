import { Injectable, computed, inject, signal } from '@angular/core';
import { BffService, ModerationRequest } from '../bff.service';

/**
 * Datastore for the admin Appeals-Decide console (ROLE_ADMIN only). A signal-backed
 * service (the platform datastore standard) over the admin-bff appeals decide-proxy
 * {@code POST /bff/admin/moderation/{id}/decide?approve=<bool>}, which forwards the
 * admin's Casdoor JWT to hugmesh-federation-api so the decision is scoped to the
 * admin's own domain (a cross-domain row is invisible/404 downstream).
 *
 * <p>DEPENDENCY / GAP (kept HONEST, not faked): there is no admin-bff endpoint that
 * LISTS pending moderation requests yet — federation-api exposes
 * {@code GET /api/federation/moderation?status=} but admin-bff does not proxy it, and
 * this remote only reaches admin-bff. So this store does NOT pre-populate a pending
 * queue; the admin enters the known moderation-request id (surfaced from the federation
 * moderation system / mod tooling) and decides it. The store keeps a local list of the
 * rows DECIDED in this session (newest first) so the console shows an honest record of
 * what was approved/denied, and an OPTIMISTIC pending marker while a decide is in
 * flight — reconciled with the server's returned row (or rolled back on error).
 */
@Injectable({ providedIn: 'root' })
export class AppealsStore {
  private readonly bff = inject(BffService);

  /** Rows decided in this session, newest first (the on-screen decision record). */
  readonly decided = signal<ModerationRequest[]>([]);
  /** The id currently being decided (optimistic in-flight marker). 0/absent = idle. */
  readonly deciding = signal<number | null>(null);
  /** A human note from the most recent decision (role=status live region). */
  readonly note = signal('');
  /** A hard error from the decide-proxy (the BFF/federation {error}). Empty = none. */
  readonly error = signal('');

  /** True while a decide request is in flight (drives disabled buttons + busy text). */
  readonly busy = computed(() => this.deciding() !== null);

  /**
   * Approve OR deny a referred moderation request by id. OPTIMISTIC: it flips to a
   * busy state immediately (so the buttons disable and the live region announces the
   * in-flight action), calls the decide-proxy, then prepends the server's returned row
   * — the authoritative decided state — to the session record. On error nothing is
   * recorded and the error live region carries the BFF/federation message.
   *
   * @returns the decided row on success, or null on a validation/transport error.
   */
  async decide(id: number, approve: boolean): Promise<ModerationRequest | null> {
    this.error.set('');
    this.note.set('');
    this.deciding.set(id);
    try {
      const row = await this.bff.decideModeration(id, approve);
      // Reconcile: drop any earlier session record of the same id, prepend the fresh
      // server row (its status is the authoritative approved|denied).
      this.decided.update((rows) => [row, ...rows.filter((r) => r.id !== row.id)]);
      this.note.set(`Appeal #${row.id} ${row.status === 'approved' ? 'approved' : 'denied'}.`);
      return row;
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'The appeal decision failed.');
      return null;
    } finally {
      this.deciding.set(null);
    }
  }

  /** Clear the on-screen decision record + notes (does not affect the server). */
  reset(): void {
    this.decided.set([]);
    this.note.set('');
    this.error.set('');
  }
}
