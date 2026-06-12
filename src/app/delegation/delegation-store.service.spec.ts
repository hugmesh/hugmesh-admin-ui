import { TestBed } from '@angular/core/testing';
import { DelegationStore } from './delegation-store.service';
import {
  AccessRolesResult,
  AccessSuspension,
  BffService,
  DomainLock,
  DomainLockResult,
} from '../bff.service';

/**
 * DelegationStore datastore tests — the signal-store over the wired access-roles
 * + domain-lock surface. Asserts the HONEST pending-reconcile messaging (the
 * endpoints only write the desired-state table) + error surfacing.
 * Delineated USER-SITUATIONAL / MULTIUSER / CROSS-USER / CONCURRENT.
 */

const suspension: AccessSuspension = {
  id: 's1', casdoorUser: 'bob', localpart: 'bob', role: 'ROLE_MATRIX', state: 'active',
  suspendedAt: '2026-06-12T00:00:00Z', expiresAt: null, restoreRole: false,
  propagationState: 'pending', reason: null, setBy: 'admin',
};
const lock: DomainLock = {
  id: 'l1', casdoorUser: 'carol', localpart: 'carol', role: 'ROLE_MATRIX_DOMAINLOCKED',
  state: 'active', createdAt: '2026-06-12T00:00:00Z', propagationState: 'pending',
  reason: null, setBy: 'admin',
};

describe('DelegationStore', () => {
  let store: DelegationStore;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(() => {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'accessRoles', 'suspendAccessRole', 'clearAccessRole',
      'domainLocks', 'lockDomain', 'unlockDomain',
    ]);
    bff.accessRoles.and.resolveTo({ suspensions: [suspension] });
    bff.domainLocks.and.resolveTo({ domainLocks: [lock] });
    TestBed.configureTestingModule({
      providers: [DelegationStore, { provide: BffService, useValue: bff }],
    });
    store = TestBed.inject(DelegationStore);
  });

  // ── USER-SITUATIONAL (the admin's own delegation actions) ──────────────
  describe('USER-SITUATIONAL', () => {
    it('refreshAll loads both desired-state tables into signals', async () => {
      await store.refreshAll();
      expect(store.suspensions().length).toBe(1);
      expect(store.domainLocks().length).toBe(1);
    });

    it('a PERMANENT suspension sets an honest pending-reconcile note (no instant-effect claim)', async () => {
      const res: AccessRolesResult = { suspended: suspension, suspensions: [suspension] };
      bff.suspendAccessRole.and.resolveTo(res);
      await store.suspend('ROLE_MATRIX', 'bob', { ttlSeconds: null });
      expect(bff.suspendAccessRole).toHaveBeenCalledWith('ROLE_MATRIX', 'bob', { ttlSeconds: null });
      expect(store.note()).toContain('Permanent');
      expect(store.note()).toContain('pending reconcile');
      expect(store.suspensions().length).toBe(1);
      expect(store.error()).toBe('');
    });

    it('a TIMED suspension note mentions the auto-restore at TTL', async () => {
      bff.suspendAccessRole.and.resolveTo({ suspensions: [suspension] });
      await store.suspend('ROLE_MASTODON', 'bob', { ttlSeconds: 60 });
      expect(store.note()).toContain('auto-restores at TTL');
    });

    it('clearing a suspension reports it lifts asynchronously', async () => {
      bff.clearAccessRole.and.resolveTo({ suspensions: [] });
      await store.clear('ROLE_MATRIX', 'bob');
      expect(store.note()).toContain('lifted');
      expect(store.suspensions().length).toBe(0);
    });

    it('domain-lock note states the user KEEPS the base role + pending reconcile', async () => {
      const res: DomainLockResult = { locked: lock, domainLocks: [lock] };
      bff.lockDomain.and.resolveTo(res);
      await store.lock('ROLE_MATRIX_DOMAINLOCKED', 'carol', 'reason');
      expect(bff.lockDomain).toHaveBeenCalledWith('ROLE_MATRIX_DOMAINLOCKED', 'carol', 'reason');
      expect(store.note()).toContain('keeps their base role');
      expect(store.note()).toContain('pending reconcile');
    });

    it('passes undefined reason through (not the empty string) when none given', async () => {
      bff.lockDomain.and.resolveTo({ domainLocks: [lock] });
      await store.lock('ROLE_MASTODON_DOMAINLOCKED', 'carol', null);
      expect(bff.lockDomain).toHaveBeenCalledWith('ROLE_MASTODON_DOMAINLOCKED', 'carol', undefined);
    });
  });

  // ── MULTIUSER-SITUATIONAL (error from acting over another user) ─────────
  describe('MULTIUSER-SITUATIONAL', () => {
    it('surfaces a thrown BFF error in the error signal and clears the note', async () => {
      bff.suspendAccessRole.and.rejectWith(new Error('role must be one of ROLE_MATRIX, ROLE_MASTODON, PROFILE'));
      await store.suspend('ROLE_MATRIX', 'mallory', { ttlSeconds: null });
      expect(store.error()).toContain('role must be one of');
      expect(store.note()).toBe('');
    });

    it('a failed unlock leaves the prior domain-lock list intact (no silent wipe)', async () => {
      await store.refreshDomainLocks();
      bff.unlockDomain.and.rejectWith(new Error('HTTP 500'));
      await store.unlock('ROLE_MATRIX_DOMAINLOCKED', 'carol');
      expect(store.error()).toContain('HTTP 500');
      expect(store.domainLocks().length).toBe(1);
    });
  });

  // ── CROSS-USER (the store reflects the SERVER snapshot, not local guesses) ──
  describe('CROSS-USER', () => {
    it('after a suspend, the table is replaced by the server-returned set (B is now visible to the admin)', async () => {
      const other: AccessSuspension = { ...suspension, id: 's2', casdoorUser: 'dave', role: 'ROLE_MASTODON' };
      bff.suspendAccessRole.and.resolveTo({ suspended: other, suspensions: [suspension, other] });
      await store.suspend('ROLE_MASTODON', 'dave', { ttlSeconds: null });
      expect(store.suspensions().map((s) => s.casdoorUser)).toEqual(['bob', 'dave']);
    });
  });

  // ── CONCURRENT (last-writer server snapshot wins deterministically) ─────
  describe('CONCURRENT', () => {
    it('two awaited mutations each apply their own server snapshot in order', async () => {
      bff.suspendAccessRole.and.resolveTo({ suspensions: [suspension] });
      bff.clearAccessRole.and.resolveTo({ suspensions: [] });
      await store.suspend('ROLE_MATRIX', 'bob', { ttlSeconds: null });
      expect(store.suspensions().length).toBe(1);
      await store.clear('ROLE_MATRIX', 'bob');
      expect(store.suspensions().length).toBe(0);
      expect(store.error()).toBe('');
    });
  });
});
