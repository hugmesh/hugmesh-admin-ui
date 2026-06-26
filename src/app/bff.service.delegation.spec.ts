import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  AccessSuspension,
  BffService,
  DomainLock,
} from './bff.service';
import { SessionService, SnapSession } from './session.service';

/**
 * Delegation BFF transport tests — the wired AdminController access-roles +
 * domain-lock surface. Verified contracts:
 *   GET/POST/DELETE /bff/admin/access-roles[/{role}/{user}]
 *   GET/POST/DELETE /bff/admin/domain-lock[/{role}/{user}]
 * Delineated USER-SITUATIONAL / MULTIUSER / CROSS-USER / CONCURRENT.
 */

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

function adminSession(): SnapSession {
  return {
    id: 'google:admin@gmail.com',
    label: 'admin@gmail.com',
    provider: 'google',
    roles: ['admin'],
    registrationComplete: true,
    matrix: null,
    mastodon: null,
  };
}

const suspension: AccessSuspension = {
  id: 's1',
  casdoorUser: 'google:bob@gmail.com',
  localpart: 'bob',
  role: 'ROLE_MATRIX',
  state: 'active',
  suspendedAt: '2026-06-12T00:00:00Z',
  expiresAt: null,
  restoreRole: false,
  propagationState: 'pending',
  reason: 'spam',
  setBy: 'admin',
};
const lock: DomainLock = {
  id: 'l1',
  casdoorUser: 'google:carol@gmail.com',
  localpart: 'carol',
  role: 'ROLE_MASTODON_DOMAINLOCKED',
  state: 'active',
  createdAt: '2026-06-12T00:00:00Z',
  propagationState: 'pending',
  reason: null,
  setBy: 'admin',
};

describe('BffService delegation transport', () => {
  let service: BffService;
  let fetchSpy: jasmine.Spy;
  const sessionSig = signal<SnapSession | null>(null);

  beforeEach(() => {
    sessionSig.set(adminSession());
    TestBed.configureTestingModule({
      providers: [BffService, { provide: SessionService, useValue: { session: sessionSig } }],
    });
    service = TestBed.inject(BffService);
    fetchSpy = spyOn(globalThis, 'fetch');
  });

  function lastUrl(): string { return String(fetchSpy.calls.mostRecent().args[0]); }
  function lastInit(): RequestInit { return (fetchSpy.calls.mostRecent().args[1] ?? {}) as RequestInit; }
  function authHeader(): string | undefined {
    return (lastInit().headers as Record<string, string>)?.['authorization'];
  }
  function credentials(): RequestCredentials | undefined { return lastInit().credentials; }
  function bodyOf(): any { const b = lastInit().body; return b ? JSON.parse(b as string) : undefined; }

  // ── USER-SITUATIONAL (the admin's own delegation actions) ──────────────
  describe('USER-SITUATIONAL', () => {
    it('GET access-roles returns the suspensions envelope (credentials attached)', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ suspensions: [suspension] }));
      const out = await service.accessRoles();
      expect(lastUrl()).toContain('/bff/admin/access-roles');
      expect(credentials()).toBe('include');
      expect(authHeader()).toBeUndefined();
      expect(out.suspensions[0].id).toBe('s1');
    });

    it('a PERMANENT suspension sends NO body (the endpoint optional-body branch)', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ suspended: suspension, suspensions: [suspension] }));
      await service.suspendAccessRole('ROLE_MATRIX', 'google:bob@gmail.com', {});
      expect(lastInit().method).toBe('POST');
      expect(lastUrl()).toContain('/bff/admin/access-roles/ROLE_MATRIX/google%3Abob%40gmail.com');
      expect(lastInit().body).toBeUndefined();
    });

    it('a TIMED suspension sends ttlSeconds + reason as the JSON body', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ suspended: suspension, suspensions: [suspension] }));
      await service.suspendAccessRole('ROLE_MASTODON', 'bob', { ttlSeconds: 3600, reason: 'cooldown' });
      expect(bodyOf()).toEqual({ ttlSeconds: 3600, reason: 'cooldown' });
    });

    it('CLEAR sends a DELETE with no body', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ suspensions: [] }));
      await service.clearAccessRole('PROFILE', 'bob');
      expect(lastInit().method).toBe('DELETE');
      expect(lastInit().body).toBeUndefined();
      expect(lastUrl()).toContain('/bff/admin/access-roles/PROFILE/bob');
    });

    it('domain-lock ADD posts the reason to the {role}/{user} path', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ locked: lock, domainLocks: [lock] }));
      await service.lockDomain('ROLE_MATRIX_DOMAINLOCKED', 'carol', 'mod call');
      expect(lastInit().method).toBe('POST');
      expect(lastUrl()).toContain('/bff/admin/domain-lock/ROLE_MATRIX_DOMAINLOCKED/carol');
      expect(bodyOf()).toEqual({ reason: 'mod call' });
    });

    it('domain-lock REMOVE sends a DELETE with no body', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ domainLocks: [] }));
      await service.unlockDomain('ROLE_MASTODON_DOMAINLOCKED', 'carol');
      expect(lastInit().method).toBe('DELETE');
      expect(lastUrl()).toContain('/bff/admin/domain-lock/ROLE_MASTODON_DOMAINLOCKED/carol');
    });
  });

  // ── MULTIUSER-SITUATIONAL (admin acting over OTHER users; error surfacing) ──
  describe('MULTIUSER-SITUATIONAL', () => {
    it('surfaces a closed-vocabulary / validation reject as a thrown {error}', async () => {
      fetchSpy.and.resolveTo(
        jsonResponse({ error: 'role must be one of ROLE_MATRIX, ROLE_MASTODON, PROFILE' }, { ok: false, status: 400 }),
      );
      await expectAsync(service.suspendAccessRole('ROLE_MATRIX', 'mallory'))
        .toBeRejectedWithError(/role must be one of/);
    });

    it('serialises a structured (object) 422 error body into the thrown message', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ error: { reason: 'reserved' } }, { ok: false, status: 422 }));
      await expectAsync(service.lockDomain('ROLE_MATRIX_DOMAINLOCKED', 'sys'))
        .toBeRejectedWithError(/reserved/);
    });

    it('GET falls back to an empty list (not throw) when access-roles is denied', async () => {
      fetchSpy.and.resolveTo(jsonResponse({}, { ok: false, status: 403 }));
      expect(await service.accessRoles()).toEqual({ suspensions: [] });
      expect((await service.domainLocks())).toBeDefined();
    });
  });

  // ── CROSS-USER (isolation: auth rides the acting admin's HttpOnly bff_ cookie) ──
  describe('CROSS-USER', () => {
    it('every delegation call sends credentials and NEVER a browser-held bearer', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ suspensions: [] }));
      await service.suspendAccessRole('ROLE_MATRIX', 'victimB', {});
      expect(credentials()).toBe('include');
      expect(authHeader()).toBeUndefined();
    });

    it('a delegation read still sends credentials (the cookie auths the call; the API 401s if absent)', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ domainLocks: [] }));
      await service.domainLocks();
      expect(credentials()).toBe('include');
      expect(authHeader()).toBeUndefined();
    });
  });

  // ── CONCURRENT (two delegation mutations in flight at once) ─────────────
  describe('CONCURRENT', () => {
    it('two simultaneous suspends each resolve to their own server snapshot', async () => {
      fetchSpy.and.callFake(async (url: string) =>
        jsonResponse({ suspensions: [{ ...suspension, casdoorUser: String(url).includes('alice') ? 'alice' : 'bob' }] }));
      const [a, b] = await Promise.all([
        service.suspendAccessRole('ROLE_MATRIX', 'alice', {}),
        service.suspendAccessRole('ROLE_MATRIX', 'bob', {}),
      ]);
      expect(a.suspensions[0].casdoorUser).toBe('alice');
      expect(b.suspensions[0].casdoorUser).toBe('bob');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });
});
