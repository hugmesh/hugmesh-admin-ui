import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppealsStore } from './appeals-store.service';

/**
 * Admin "Appeals" console (ROLE_ADMIN only, route-guarded). The single seam onto the
 * appeals-adjudication DECIDE action via the admin-bff decide-proxy
 * ({@code POST /bff/admin/moderation/{id}/decide?approve=<bool>}), which forwards the
 * admin's Casdoor JWT to snapdragon-federation-api — so the decision is scoped to the
 * admin's OWN domain (cross-domain rows are invisible/404 downstream).
 *
 * <p>Admin gating is defence-in-depth (gateway route-access rule + the /bff/admin/**
 * path rule + admin-bff @PreAuthorize('ADMIN') + federation-api's own
 * @PreAuthorize(ADMIN|SUPERADMIN) + per-domain scope); this UI mirrors it but the
 * services are the source of truth.
 *
 * <p>HONEST DEPENDENCY: there is no admin-bff endpoint that LISTS pending moderation
 * requests yet (see {@link AppealsStore}), so this console drives the decide by the
 * known request id rather than fabricating a pending queue, and renders a disabled
 * "Load pending appeals" control with helptext explaining WHY. It DOES keep an honest,
 * live record of the appeals decided in this session.
 */
@Component({
  selector: 'snap-appeals',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './appeals.component.html',
  styleUrl: './appeals.component.scss',
})
export class AppealsComponent {
  readonly store = inject(AppealsStore);

  /** The moderation-request id the admin is deciding (free text → validated number). */
  appealId = '';
  /** Inline validation for a bad/blank id (role=alert live region). Empty = valid. */
  readonly idError = signal('');

  /** Parse the entered id to a positive integer, or null when invalid (with a reason
   *  surfaced in {@link idError}). Mirrors the admin-bff @Positive validation so a bad
   *  id is caught before the request, not as a server 400. */
  private parseId(): number | null {
    const raw = this.appealId.trim();
    if (!raw) { this.idError.set('Enter the moderation request id to decide.'); return null; }
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      this.idError.set('The id must be a positive whole number.');
      return null;
    }
    this.idError.set('');
    return n;
  }

  /** Approve the entered moderation-request id (the appeal is upheld → action applies). */
  async approve(): Promise<void> { await this.submit(true); }
  /** Deny the entered moderation-request id (the appeal is rejected). */
  async deny(): Promise<void> { await this.submit(false); }

  private async submit(approve: boolean): Promise<void> {
    if (this.store.busy()) return;
    const id = this.parseId();
    if (id === null) return;
    const row = await this.store.decide(id, approve);
    // Only clear the input on a clean decision so a transient error keeps the id for a
    // retry (the error live region explains the failure).
    if (row) this.appealId = '';
  }
}
