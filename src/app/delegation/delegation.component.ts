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
  selector: 'snap-delegation',
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

  // suspend / ban form
  suspendRole: AccessRole = 'ROLE_MATRIX';
  suspendUser = '';
  /** TTL in seconds; blank = PERMANENT (the endpoint's null-ttl branch). */
  suspendTtl = '';
  suspendReason = '';
  readonly suspendError = signal('');

  // domain-lock form
  lockRole: DomainLockRole = 'ROLE_MATRIX_DOMAINLOCKED';
  lockUser = '';
  lockReason = '';
  readonly lockError = signal('');

  // namespace-access form
  nsUser = '';
  nsNamespace = '';
  readonly namespaces = signal<string[]>([]);
  readonly grants = signal<{ user: string; namespaces: string[] }[]>([]);
  readonly nsError = signal('');

  async ngOnInit(): Promise<void> {
    await this.store.refreshAll();
    const a = await this.bff.namespaceAccess();
    this.namespaces.set(a.namespaces);
    this.grants.set(a.grants);
    if (!this.nsNamespace && a.namespaces.length) this.nsNamespace = a.namespaces[0];
  }

  select(tab: Tab): void {
    this.tab.set(tab);
  }

  /** The accessible (announced) name for a user identifier — there is no separate
   *  screenReaderName in the delegation tables, so the casdoorUser id is both the
   *  visible text and the announced name (via the shared helper for consistency). */
  announce(user: string): string {
    return accessibleName(user, null);
  }

  // ── suspend / ban ────────────────────────────────────────────────────────
  async suspend(): Promise<void> {
    if (!this.suspendUser.trim()) { this.suspendError.set('Enter a user to suspend.'); return; }
    let ttlSeconds: number | null = null;
    if (this.suspendTtl.trim()) {
      const n = Number(this.suspendTtl.trim());
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
  async clearSuspension(s: AccessSuspension): Promise<void> {
    await this.store.clear(s.role, s.casdoorUser);
  }

  // ── domain-lock ────────────────────────────────────────────────────────
  async lock(): Promise<void> {
    if (!this.lockUser.trim()) { this.lockError.set('Enter a user to domain-lock.'); return; }
    this.lockError.set('');
    await this.store.lock(this.lockRole, this.lockUser.trim(), this.lockReason.trim() || null);
    this.lockReason = '';
  }
  async unlock(l: DomainLock): Promise<void> {
    await this.store.unlock(l.role, l.casdoorUser);
  }

  // ── namespace-access ────────────────────────────────────────────────────
  async grantNamespace(): Promise<void> {
    if (!this.nsUser.trim() || !this.nsNamespace) { this.nsError.set('Enter a user and pick a namespace.'); return; }
    this.nsError.set('');
    const a = await this.bff.grantNamespace(this.nsUser.trim().toLowerCase(), this.nsNamespace);
    this.namespaces.set(a.namespaces);
    this.grants.set(a.grants);
    this.nsUser = '';
  }
  async revokeNamespace(user: string, namespace: string): Promise<void> {
    const a = await this.bff.revokeNamespace(user, namespace);
    this.namespaces.set(a.namespaces);
    this.grants.set(a.grants);
  }

  /** A human label for a suspension's expiry (permanent vs the TTL clock). */
  expiryLabel(s: AccessSuspension): string {
    return s.expiresAt ? `until ${s.expiresAt}` : 'permanent';
  }
}
