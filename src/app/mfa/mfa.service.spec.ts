import { TestBed } from '@angular/core/testing';
import { MfaService } from './mfa.service';

/** Minimal fetch Response stub (mirrors bff.service.spec). */
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  const status = init?.status ?? 200;
  return {
    ok: init?.ok ?? (status >= 200 && status < 300),
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('MfaService', () => {
  let service: MfaService;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [MfaService] });
    service = TestBed.inject(MfaService);
    fetchSpy = spyOn(globalThis, 'fetch');
  });

  function lastUrl(): string {
    return String(fetchSpy.calls.mostRecent().args[0]);
  }
  function lastInit(): RequestInit {
    return (fetchSpy.calls.mostRecent().args[1] ?? {}) as RequestInit;
  }
  function lastHeaders(): Record<string, string> {
    return (lastInit().headers ?? {}) as Record<string, string>;
  }

  it('enrollTotp POSTs the enroll path and returns the display-once secret', async () => {
    fetchSpy.and.resolveTo(
      jsonResponse({ factorId: 'f1', otpauthUri: 'otpauth://totp/x', secret: 'BASE32SECRET' }),
    );
    const r = await service.enrollTotp();
    expect(lastUrl()).toContain('/bff/mfa/enroll/totp');
    expect(lastInit().method).toBe('POST');
    expect(r.ok).toBeTrue();
    expect(r.data?.secret).toBe('BASE32SECRET');
  });

  it('authenticates via the bff_ cookie: sends credentials:include and NO Bearer header', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ factors: [] }));
    await service.factors();
    const headers = lastHeaders();
    expect(headers['authorization']).toBeUndefined();
    expect(lastInit().credentials).toBe('include');
  });

  it('NEVER puts the subject/owner in the request body (owner == authenticated session)', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ factorId: 'f1', otpauthUri: 'x', secret: 's' }));
    await service.enrollTotp();
    // enroll/totp takes no body at all.
    expect(lastInit().body).toBeUndefined();

    fetchSpy.and.resolveTo(jsonResponse({ enabled: true, recoveryCodes: [] }));
    await service.verifyTotp('123456');
    const body = JSON.parse(String(lastInit().body));
    expect(body).toEqual({ passcode: '123456' });
    expect(body.subject).toBeUndefined();
    expect(body.owner).toBeUndefined();
    expect(body.id).toBeUndefined();
  });

  it('maps a 503 from ANY /bff/mfa/* call to a DARK result (not an error)', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ error: 'ships dark' }, { ok: false, status: 503 }));
    const r = await service.factors();
    expect(r.dark).toBeTrue();
    expect(r.ok).toBeFalse();
    expect(r.error).toBeUndefined();
  });

  it('verifyTotp surfaces a 401 as a non-dark failure with the status', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ error: 'bad code' }, { ok: false, status: 401 }));
    const r = await service.verifyTotp('000000');
    expect(r.dark).toBeFalse();
    expect(r.status).toBe(401);
    expect(r.ok).toBeFalse();
  });

  it('verifyWebauthn POSTs the attestation as a JSON string field', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ factorId: 'w1', enabled: true }));
    await service.verifyWebauthn('{"id":"abc"}');
    expect(lastUrl()).toContain('/bff/mfa/enroll/webauthn/verify');
    expect(JSON.parse(String(lastInit().body))).toEqual({ attestation: '{"id":"abc"}' });
  });

  it('assertWebauthnOptions POSTs the assert-options path with no body', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ challenge: 'c', rpId: 'r', rpName: 'n' }));
    await service.assertWebauthnOptions();
    expect(lastUrl()).toContain('/bff/mfa/assert/webauthn/options');
    expect(lastInit().body).toBeUndefined();
  });

  it('factors() GETs the list path (no secrets relied on by the client)', async () => {
    fetchSpy.and.resolveTo(
      jsonResponse({ factors: [{ id: 'f1', type: 'TOTP', enabled: true, createdAt: '2026-01-01T00:00:00Z' }] }),
    );
    const r = await service.factors();
    expect(lastUrl()).toContain('/bff/mfa/factors');
    expect(lastInit().method).toBe('GET');
    expect(r.data?.factors[0].id).toBe('f1');
  });

  it('removeFactor DELETEs the per-factor path (URL-encoded id)', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ removed: true }));
    await service.removeFactor('a/b');
    expect(lastInit().method).toBe('DELETE');
    expect(lastUrl()).toContain('/bff/mfa/factors/a%2Fb');
  });

  it('removeFactor surfaces a 403 (needs fresh step-up) as a non-dark failure', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ error: 'requires a fresh MFA step-up' }, { ok: false, status: 403 }));
    const r = await service.removeFactor('f1');
    expect(r.status).toBe(403);
    expect(r.dark).toBeFalse();
  });

  it('challenge POSTs factor + credential to the existing challenge endpoint', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ mfaSatisfied: true }));
    const r = await service.challenge('totp', '123456');
    expect(lastUrl()).toContain('/bff/mfa/challenge');
    expect(JSON.parse(String(lastInit().body))).toEqual({ factor: 'totp', credential: '123456' });
    expect(r.data?.mfaSatisfied).toBeTrue();
  });

  it('degrades a network failure to a non-dark error result (never throws)', async () => {
    fetchSpy.and.rejectWith(new Error('network'));
    const r = await service.factors();
    expect(r.ok).toBeFalse();
    expect(r.dark).toBeFalse();
    expect(r.status).toBe(0);
    expect(r.error).toBe('Network error');
  });
});
