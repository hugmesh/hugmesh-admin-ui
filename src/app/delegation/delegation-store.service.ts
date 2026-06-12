import { Injectable, inject, signal } from '@angular/core';
import {
  AccessRole,
  AccessSuspension,
  BffService,
  DomainLock,
  DomainLockRole,
  SuspensionBody,
} from '../bff.service';

/**
 * Datastore for the admin Delegation / access-roles + domain-lock console
 * (ROLE_ADMIN only). A single signal-backed service (the platform datastore
 * standard) over the admin-bff {@code AdminController} delegation surface, which
 * was verified byte-for-byte against the controller + its DTOs:
 *
 * <ul>
 *   <li>ACCESS-ROLE SUSPENSION — ban / timed-suspend a user's platform access role
 *       (closed vocab {@code ROLE_MATRIX|ROLE_MASTODON|PROFILE}) + lift. Writes the
 *       {@code access_suspension} desired-state table; the single-writer reconcile
 *       loop is the sole effector, so the result is HONESTLY pending-reconcile.</li>
 *   <li>DOMAIN-LOCK — add / remove a force-local marker (closed vocab
 *       {@code ROLE_*_DOMAINLOCKED}); ADD-semantics (the user KEEPS the base role).</li>
 * </ul>
 *
 * <p>Each mutation records an HONEST pending-reconcile note (the endpoints only
 * write the desired-state table + trigger a tick; the role + homeserver state
 * converge asynchronously) surfaced in a role=status live region, OR a hard error
 * (the BFF returned {@code {error}}, e.g. a closed-vocabulary reject) in a
 * role=alert region. Defence-in-depth: the admin-bff is the source of truth.
 */
@Injectable({ providedIn: 'root' })
export class DelegationStore {
  private readonly bff = inject(BffService);

  /** All active access-role suspensions (the ban/suspend desired-state table). */
  readonly suspensions = signal<AccessSuspension[]>([]);
  /** All active domain-locks (force local-only markers). */
  readonly domainLocks = signal<DomainLock[]>([]);

  /** Honest result note from the most recent mutating action. Empty = none. */
  readonly note = signal('');
  /** A hard error from a mutating action (the BFF returned {error}). Empty = none. */
  readonly error = signal('');

  // ── loads (GET) ────────────────────────────────────────────────────────
  async refreshSuspensions(): Promise<void> {
    this.suspensions.set((await this.bff.accessRoles()).suspensions ?? []);
  }
  async refreshDomainLocks(): Promise<void> {
    this.domainLocks.set((await this.bff.domainLocks()).domainLocks ?? []);
  }
  async refreshAll(): Promise<void> {
    await Promise.all([this.refreshSuspensions(), this.refreshDomainLocks()]);
  }

  // ── access-role suspend / clear ─────────────────────────────────────────
  async suspend(role: AccessRole, user: string, body: SuspensionBody): Promise<void> {
    await this.mutate(async () => {
      const res = await this.bff.suspendAccessRole(role, user, body);
      this.suspensions.set(res.suspensions ?? []);
    }, body.ttlSeconds != null
      ? `Suspension of ${role} for ${user} written — it applies asynchronously (pending reconcile) and auto-restores at TTL.`
      : `Permanent suspension of ${role} for ${user} written — it applies asynchronously (pending reconcile).`);
  }
  async clear(role: AccessRole, user: string): Promise<void> {
    await this.mutate(async () => {
      const res = await this.bff.clearAccessRole(role, user);
      this.suspensions.set(res.suspensions ?? []);
    }, `Suspension of ${role} for ${user} lifted — the role + homeserver state restore asynchronously (pending reconcile).`);
  }

  // ── domain-lock add / remove ────────────────────────────────────────────
  async lock(role: DomainLockRole, user: string, reason: string | null): Promise<void> {
    await this.mutate(async () => {
      const res = await this.bff.lockDomain(role, user, reason ?? undefined);
      this.domainLocks.set(res.domainLocks ?? []);
    }, `Domain-lock ${role} for ${user} written — force-local applies asynchronously (pending reconcile). The user keeps their base role.`);
  }
  async unlock(role: DomainLockRole, user: string): Promise<void> {
    await this.mutate(async () => {
      const res = await this.bff.unlockDomain(role, user);
      this.domainLocks.set(res.domainLocks ?? []);
    }, `Domain-lock ${role} for ${user} removed — force-local lifts asynchronously (pending reconcile).`);
  }

  /** Run a mutating call, set the honest pending-reconcile note, surface errors. */
  private async mutate(call: () => Promise<void>, okNote: string): Promise<void> {
    this.error.set('');
    this.note.set('');
    try {
      await call();
      this.note.set(okNote);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'The delegation action failed.');
    }
  }
}
