import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AccessRole,
  AccessSuspension,
  BffService,
  DomainCapability,
  DomainLock,
  DomainLockRole, GrantableRole } from '../bff.service';
import { DelegationStore } from './delegation-store.service';
import { accessibleName } from '../accessible-name';
import { RovingFocusDirective } from '../a11y/roving-focus.directive';
import { UserTypeaheadComponent } from '../a11y/user-typeahead.component';
import { GLOBAL_DOMAIN } from '../domain-capabilities.component';

type Tab = 'suspensions' | 'domain-lock' | 'namespaces' | 'external-client';

/** The two external-client roles, keyed by the platform an admin actually picks. */
// Typed as GrantableRole, not string, so this map cannot drift out of the CLOSED
// vocabulary the server enforces — a typo here becomes a compile error rather than a
// 400 at grant time.
const EXTERNAL_CLIENT_ROLE: Record<'matrix' | 'mastodon', GrantableRole> = {
  matrix: 'ROLE_MATRIX_EXTERNAL_CLIENT',
  mastodon: 'ROLE_MASTODON_EXTERNAL_CLIENT',
};

/**
 * Admin "Delegation / access roles" console (ROLE_ADMIN only, route-guarded).
 * The single seam onto the narrow, contract-verified AdminController delegation
 * surface — FOUR wired capabilities:
 *
 * <ol>
 *   <li>SUSPEND / BAN a user's platform access role (timed via ttlSeconds OR
 *       permanent when blank) + LIFT — the access_suspension ban/suspend table
 *       (closed vocab ROLE_MATRIX|ROLE_MASTODON|PROFILE).</li>
 *   <li>DOMAIN-LOCK add / remove (force local-only marker; ROLE_*_DOMAINLOCKED)
 *       — ADD-semantics; the user KEEPS their base role.</li>
 *   <li>NAMESPACE-ACCESS grant / revoke — cluster-namespace access grants.</li>
 *   <li>EXTERNAL-CLIENT grant / revoke — the per-user
 *       ROLE_MATRIX_EXTERNAL_CLIENT / ROLE_MASTODON_EXTERNAL_CLIENT capability,
 *       via POST/DELETE /bff/admin/roles/{roleName}/{user}. Gated on the
 *       `external-client-grant` DOMAIN CAPABILITY (superadmin grants the brand,
 *       the brand's admin enables it); the server enforces the same gate, so the
 *       greyed state here mirrors a real 403 rather than inventing one.</li>
 * </ol>
 *
 * <p>Every access-suspension / domain-lock effect is HONESTLY pending-reconcile:
 * the endpoints only write the desired-state table + trigger a tick; the
 * single-writer reconcile loop drives Casdoor + the homeserver asynchronously.
 * The console surfaces that in a role=status live region (never claims an instant
 * effect). The external-client grant is the exception and says so — it is a DIRECT
 * Casdoor role write with no reconcile loop behind it.
 *
 * <h3>User pickers</h3>
 * Every field naming a user is a {@link UserTypeaheadComponent} — a type-to-filter
 * combobox whose suggestions come from GET /bff/admin/users/search, scoped
 * SERVER-SIDE to this admin's own brand. Free text is still accepted (the directory
 * is built from the allowlist, so an identity that has no invite row must remain
 * targetable, and a search outage must not block the form).
 *
 * <p>The controls that genuinely have NO admin-bff endpoint (appeals adjudication,
 * instance federation) stay rendered DISABLED with aria-describedby helptext
 * (defence-in-depth: the admin-bff is the source of truth) — NEVER wired to a
 * non-existent endpoint.
 */
@Component({
  selector: 'hug-delegation',
  standalone: true,
  imports: [CommonModule, FormsModule, RovingFocusDirective, UserTypeaheadComponent],
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
    { id: 'external-client', label: 'External clients' },
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

  // ── External-client grant form ──────────────────────────────────────────
  /** The two platforms an external client can be authorised for. */
  readonly externalPlatforms: ReadonlyArray<{ value: 'matrix' | 'mastodon'; label: string }> = [
    { value: 'matrix', label: 'Matrix (ROLE_MATRIX_EXTERNAL_CLIENT)' },
    { value: 'mastodon', label: 'Mastodon (ROLE_MASTODON_EXTERNAL_CLIENT)' },
  ];
  /** The platform whose external-client role is being granted/revoked. */
  externalPlatform: 'matrix' | 'mastodon' = 'matrix';
  /** The user to grant/revoke external-client access for. */
  externalUser = '';
  /** Inline error for the external-client form — `role=alert` live region. */
  readonly externalError = signal('');
  /** Success/outcome note for the external-client form — `role=status` live region. */
  readonly externalNote = signal('');
  /**
   * This domain's `external-client-grant` capability row, or null when no row exists
   * (never granted). Read from GET /bff/admin/domain-capabilities, which the BFF already
   * scopes to the caller's own domain for a plain ADMIN — so the first non-global row IS
   * this admin's own. Drives the greyed state; the SERVER independently enforces the same
   * gate on grant, so a stale read here can only ever be too pessimistic, never too
   * permissive.
   */
  readonly externalCapability = signal<DomainCapability | null>(null);

  async ngOnInit(): Promise<void> {
    // Load existing suspensions/domain-locks (via the store), then the namespace grants.
    await this.store.refreshAll();
    const a = await this.bff.namespaceAccess();
    this.namespaces.set(a.namespaces);
    this.grants.set(a.grants);
    // Pre-select the first available namespace so the picker is not blank.
    if (!this.nsNamespace && a.namespaces.length) this.nsNamespace = a.namespaces[0];
    await this.loadExternalCapability();
  }

  /** Load this domain's external-client capability row (absent row = never granted). */
  private async loadExternalCapability(): Promise<void> {
    const rows = await this.bff.domainCapabilities();
    this.externalCapability.set(
      rows.find(r => r.capability === BffService.EXTERNAL_CLIENT_GRANT
        && r.domain !== GLOBAL_DOMAIN) ?? null,
    );
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

  // ── external-client grant ───────────────────────────────────────────────
  /**
   * Whether an external-client grant will actually be accepted for this domain: the
   * capability row must exist AND carry BOTH keys (superadmin `granted`, domain-admin
   * `enabled`).
   *
   * <p>This deliberately cannot see the `' global'` platform-wide kill — the BFF does not
   * return that row to a plain ADMIN. So a kill-switched platform still renders the
   * control live here and the SERVER returns 403, which {@link grantExternalClient}
   * surfaces verbatim. That is the honest failure mode: the UI never claims a grant
   * succeeded, and the one authority on the gate is the one enforcing it.
   */
  readonly externalGrantActive = computed(() => {
    const row = this.externalCapability();
    return !!row && row.granted && row.enabled;
  });

  /** Why the external-client controls are greyed, or '' when they are live. */
  readonly externalGrantBlockedReason = computed(() => {
    const row = this.externalCapability();
    if (!row) {
      return 'A superadmin has not granted the external-client capability to this domain yet.';
    }
    if (!row.granted) {
      return 'A superadmin has withdrawn the external-client capability for this domain.';
    }
    if (!row.enabled) {
      return 'This domain has not opted in to external-client grants — enable it in Domain capabilities.';
    }
    return '';
  });

  /** The Casdoor role the current platform selection maps to. */
  /** Narrowed to GrantableRole, not string: BffService.grantRole takes the CLOSED
   *  vocabulary the server enforces (AdminController.GRANTABLE_ROLE_PATTERN), so the
   *  compiler refuses anything the BFF would reject. EXTERNAL_CLIENT_ROLE only ever
   *  holds the two ROLE_*_EXTERNAL_CLIENT members, which are in that union. */
  private externalRole(): GrantableRole {
    return EXTERNAL_CLIENT_ROLE[this.externalPlatform];
  }

  /**
   * Grant the selected platform's external-client role to {@link externalUser}
   * (`POST /bff/admin/roles/{roleName}/{user}`). Unlike suspend/domain-lock this is a
   * DIRECT Casdoor write — there is no reconcile loop, so the note says "granted", not
   * "pending".
   */
  async grantExternalClient(): Promise<void> {
    await this.externalMutation(
      () => this.bff.grantRole(this.externalRole(), this.externalUser.trim()),
      'granted to');
  }

  /** Revoke the selected platform's external-client role (`DELETE /bff/admin/roles/...`). */
  async revokeExternalClient(): Promise<void> {
    await this.externalMutation(
      () => this.bff.revokeRole(this.externalRole(), this.externalUser.trim()),
      'revoked from');
  }

  /** Shared validate → call → announce path for both external-client actions. */
  private async externalMutation(fn: () => Promise<unknown>, verb: string): Promise<void> {
    if (!this.externalUser.trim()) {
      this.externalError.set('Pick or enter a user.');
      return;
    }
    this.externalError.set('');
    this.externalNote.set('');
    try {
      await fn();
      this.externalNote.set(`${this.externalRole()} ${verb} ${this.externalUser.trim()}.`);
    } catch (e) {
      // Surfaced verbatim: a capability 403 explains itself, and a 503 says the Casdoor
      // admin client is not enabled in this deployment. Neither is worth paraphrasing.
      this.externalError.set(e instanceof Error ? e.message : String(e));
      // The denial may be the gate having moved since page load — re-read it so the
      // greyed state catches up instead of staying wrong until a reload.
      await this.loadExternalCapability();
    }
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
