import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AccessRole, AccessSuspension, BffService, DomainLock, DomainLockRole } from '../bff.service';
import { DelegationStore } from './delegation-store.service';
import { accessibleName } from '../accessible-name';
import { RovingFocusDirective } from '../a11y/roving-focus.directive';

type Tab = 'suspensions' | 'domain-lock' | 'namespaces';

/**
 * Admin "Delegation / access roles" console (ROLE_ADMIN only, route-guarded).
 * The single seam onto the narrow, contract-verified AdminController delegation
 * surface — THREE wired capabilities:
 *
 * <ol>
 *   <li>SUSPEND / BAN a user's platform access role (timed via ttlSeconds OR
 *       permanent when blank) + LIFT — the access_suspension ban/suspend table
 *       (closed vocab ROLE_MATRIX|ROLE_MASTODON|PROFILE).</li>
 *   <li>DOMAIN-LOCK add / remove (force local-only marker; ROLE_*_DOMAINLOCKED)
 *       — ADD-semantics; the user KEEPS their base role.</li>
 *   <li>NAMESPACE-ACCESS grant / revoke — cluster-namespace access grants.</li>
 * </ol>
 *
 * <p>Every effect is HONESTLY pending-reconcile: the endpoints only write the
 * desired-state table + trigger a tick; the single-writer reconcile loop drives
 * Casdoor + the homeserver asynchronously. The console surfaces that in a
 * role=status live region (never claims an instant effect).
 *
 * <p>The controls with NO admin-bff endpoint (general arbitrary role grant/revoke,
 * external-client grant, appeals adjudication) are rendered DISABLED with
 * aria-describedby helptext (defence-in-depth: the admin-bff is the source of
 * truth) — NEVER wired to a non-existent endpoint.
 */
@Component({
  selector: 'hug-delegation',
  standalone: true,
  imports: [CommonModule, FormsModule, RovingFocusDirective],
  templateUrl: './delegation.component.html',
  styleUrl: './delegation.component.scss',
})
export class DelegationComponent implements OnInit {
  readonly store = inject(DelegationStore);
  private readonly bff = inject(BffService);

  readonly tabs: ReadonlyArray<{ id: Tab; label: string }> = [
    { id: 'suspensions', label: 'Suspend / ban' },
    { id: 'domain-lock', label: 'Domain lock' },
    { id: 'namespaces', label: 'Namespace access' },
  ];
  readonly tab = signal<Tab>('suspensions');

  /** The CLOSED suspension vocabulary (AdminController @Pattern). */
  readonly accessRoles: ReadonlyArray<{ value: AccessRole; label: string }> = [
    { value: 'ROLE_MATRIX', label: 'Matrix (ROLE_MATRIX)' },
    { value: 'ROLE_MASTODON', label: 'Mastodon (ROLE_MASTODON)' },
    { value: 'PROFILE', label: 'Profile (PROFILE)' },
  ];
  /** The SEPARATE closed domain-lock marker vocabulary. */
  readonly domainLockRoles: ReadonlyArray<{ value: DomainLockRole; label: string }> = [
    { value: 'ROLE_MATRIX_DOMAINLOCKED', label: 'Matrix (ROLE_MATRIX_DOMAINLOCKED)' },
    { value: 'ROLE_MASTODON_DOMAINLOCKED', label: 'Mastodon (ROLE_MASTODON_DOMAINLOCKED)' },
  ];

  // ── Suspend / ban form ─────────────────────────────────────────────────
  /** The access role to suspend (closed vocab: ROLE_MATRIX | ROLE_MASTODON | PROFILE). */
  suspendRole: AccessRole = 'ROLE_MATRIX';
  /** The Casdoor user id to suspend (trimmed before submit). */
  suspendUser = '';
  /**
   * Optional TTL in seconds. When blank the suspension is PERMANENT (the BFF
   * stores `null` for `ttlSeconds`, which the reconcile loop treats as indefinite).
   */
  suspendTtl = '';
  /** Optional free-text reason stored on the suspension row for the audit trail. */
  suspendReason = '';
  /** Inline validation error for the suspend form — surfaced in a `role=alert` live region. */
  readonly suspendError = signal('');

  // ── Domain-lock form ────────────────────────────────────────────────────
  /** The domain-lock marker role (ROLE_MATRIX_DOMAINLOCKED | ROLE_MASTODON_DOMAINLOCKED). */
  lockRole: DomainLockRole = 'ROLE_MATRIX_DOMAINLOCKED';
  /** The Casdoor user to domain-lock (the user KEEPS their base role; this only adds the locked marker). */
  lockUser = '';
  /** Optional reason stored on the domain_lock row. */
  lockReason = '';
  /** Inline validation error for the domain-lock form — `role=alert` live region. */
  readonly lockError = signal('');

  // ── Namespace-access form ───────────────────────────────────────────────
  /** The user to grant namespace access to. */
  nsUser = '';
  /** The cluster namespace selected in the dropdown. Pre-selected to the first available namespace. */
  nsNamespace = '';
  /** The available cluster namespaces returned by `GET /bff/admin/namespace-access`. */
  readonly namespaces = signal<string[]>([]);
  /** The existing namespace grants (user → namespaces list). */
  readonly grants = signal<{ user: string; namespaces: string[] }[]>([]);
  /** Inline validation error for the namespace form — `role=alert` live region. */
  readonly nsError = signal('');

  async ngOnInit(): Promise<void> {
    // Load existing suspensions/domain-locks (via the store), then the namespace grants.
    await this.store.refreshAll();
    const a = await this.bff.namespaceAccess();
    this.namespaces.set(a.namespaces);
    this.grants.set(a.grants);
    // Pre-select the first available namespace so the picker is not blank.
    if (!this.nsNamespace && a.namespaces.length) this.nsNamespace = a.namespaces[0];
  }

  /**
   * Switch the active tab.
   *
   * @param tab - The tab id to make active.
   */
  select(tab: Tab): void {
    this.tab.set(tab);
  }

  /**
   * The accessible (announced) name for a Casdoor user id. There is no separate
   * screen-reader-name in the delegation tables, so the id itself is used directly
   * via the shared `accessibleName` helper for consistency with other user-name surfaces.
   *
   * @param user - The Casdoor user identifier.
   * @returns The user id as the accessible announcement text.
   */
  announce(user: string): string {
    return accessibleName(user, null);
  }

  // ── suspend / ban ────────────────────────────────────────────────────────
  /**
   * Submit a suspend/ban for `suspendUser` on `suspendRole`. Validates the user field
   * and the optional TTL before calling `POST /bff/admin/delegation/suspend`. The BFF
   * writes the access_suspension row + queues a pending-reconcile tick; the homeserver
   * enforces it asynchronously. Surfaces TTL parse errors in `suspendError`.
   */
  async suspend(): Promise<void> {
    if (!this.suspendUser.trim()) { this.suspendError.set('Enter a user to suspend.'); return; }
    let ttlSeconds: number | null = null;
    if (this.suspendTtl.trim()) {
      const n = Number(this.suspendTtl.trim());
      // Reject non-integer or non-positive values — a zero TTL would expire immediately.
      if (!Number.isInteger(n) || n <= 0) {
        this.suspendError.set('TTL must be a positive whole number of seconds (leave blank for a permanent ban).');
        return;
      }
      ttlSeconds = n;
    }
    this.suspendError.set('');
    await this.store.suspend(this.suspendRole, this.suspendUser.trim(), {
      ttlSeconds,
      reason: this.suspendReason.trim() || null,
    });
    this.suspendReason = '';
    this.suspendTtl = '';
  }

  /**
   * Lift an existing suspension (`DELETE /bff/admin/delegation/suspend/{role}/{user}`).
   *
   * @param s - The suspension row to clear.
   */
  async clearSuspension(s: AccessSuspension): Promise<void> {
    await this.store.clear(s.role, s.casdoorUser);
  }

  // ── domain-lock ────────────────────────────────────────────────────────
  /**
   * Add a domain-lock marker for `lockUser` on `lockRole` (`POST /bff/admin/delegation/lock`).
   * The user KEEPS their base role; the locked marker restricts them to local-only access
   * on that service (ROLE_MATRIX_DOMAINLOCKED prevents federation, etc.).
   */
  async lock(): Promise<void> {
    if (!this.lockUser.trim()) { this.lockError.set('Enter a user to domain-lock.'); return; }
    this.lockError.set('');
    await this.store.lock(this.lockRole, this.lockUser.trim(), this.lockReason.trim() || null);
    this.lockReason = '';
  }

  /**
   * Remove a domain-lock marker (`DELETE /bff/admin/delegation/lock/{role}/{user}`).
   *
   * @param l - The domain-lock row to remove.
   */
  async unlock(l: DomainLock): Promise<void> {
    await this.store.unlock(l.role, l.casdoorUser);
  }

  // ── namespace-access ────────────────────────────────────────────────────
  /**
   * Grant `nsUser` access to `nsNamespace` (`POST /bff/admin/namespace-access`).
   * The BFF maps this to Casdoor group membership and k8s RBAC (the actual grant
   * is async; the UI reloads the grant list from the BFF response immediately).
   */
  async grantNamespace(): Promise<void> {
    if (!this.nsUser.trim() || !this.nsNamespace) { this.nsError.set('Enter a user and pick a namespace.'); return; }
    this.nsError.set('');
    // Lowercased to match Casdoor's case-insensitive user id convention.
    const a = await this.bff.grantNamespace(this.nsUser.trim().toLowerCase(), this.nsNamespace);
    this.namespaces.set(a.namespaces);
    this.grants.set(a.grants);
    this.nsUser = '';
  }

  /**
   * Revoke a user's access to a namespace (`DELETE /bff/admin/namespace-access/{user}/{namespace}`).
   * The returned list replaces the local `grants` signal.
   *
   * @param user - The Casdoor user whose access is being revoked.
   * @param namespace - The cluster namespace to remove from their grants.
   */
  async revokeNamespace(user: string, namespace: string): Promise<void> {
    const a = await this.bff.revokeNamespace(user, namespace);
    this.namespaces.set(a.namespaces);
    this.grants.set(a.grants);
  }

  /**
   * A human-readable expiry label for a suspension (shown in the table).
   * Returns `'permanent'` when no TTL was set; otherwise a `'until <timestamp>'` string.
   *
   * @param s - The suspension row to describe.
   * @returns A human-readable expiry string.
   */
  expiryLabel(s: AccessSuspension): string {
    return s.expiresAt ? `until ${s.expiresAt}` : 'permanent';
  }
}
