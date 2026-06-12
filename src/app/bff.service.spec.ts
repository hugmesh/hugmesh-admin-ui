import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BffService, RouteDefinition, RouteRule } from './bff.service';
import { SessionService, SnapSession } from './session.service';

/** Minimal fetch Response stub. */
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

function sessionWith(bffToken: string | undefined): SnapSession | null {
  if (bffToken === undefined) return null;
  return {
    id: 'google:admin@gmail.com',
    label: 'admin@gmail.com',
    provider: 'google',
    roles: ['admin'],
    bffToken,
    registrationComplete: true,
    matrix: null,
    mastodon: null,
  };
}

describe('BffService', () => {
  let service: BffService;
  let fetchSpy: jasmine.Spy;
  const sessionSig = signal<SnapSession | null>(null);

  beforeEach(() => {
    sessionSig.set(sessionWith('bff-tok-1'));
    TestBed.configureTestingModule({
      providers: [
        BffService,
        { provide: SessionService, useValue: { session: sessionSig } },
      ],
    });
    service = TestBed.inject(BffService);
    fetchSpy = spyOn(globalThis, 'fetch');
  });

  function lastUrl(): string {
    return String(fetchSpy.calls.mostRecent().args[0]);
  }
  function lastInit(): RequestInit {
    return (fetchSpy.calls.mostRecent().args[1] ?? {}) as RequestInit;
  }
  function authHeader(): string | undefined {
    return (lastInit().headers as Record<string, string>)?.['authorization'];
  }

  it('sends the bffToken from the shared session as a Bearer Authorization header', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ emails: [], discord: [] }));
    await service.allowlist();
    expect(lastUrl()).toContain('/bff/admin/allowlist');
    expect(authHeader()).toBe('Bearer bff-tok-1');
  });

  it('sends an empty Bearer token when there is no session', async () => {
    sessionSig.set(null);
    fetchSpy.and.resolveTo(jsonResponse({ emails: [], discord: [] }));
    await service.allowlist();
    expect(authHeader()).toBe('Bearer undefined');
  });

  it('returns the empty fallback (not throw) when the allowlist GET fails', async () => {
    fetchSpy.and.resolveTo(jsonResponse(null, { ok: false, status: 500 }));
    const result = await service.allowlist();
    expect(result).toEqual({ emails: [], discord: [] });
  });

  it('POSTs an {email} body for a Gmail invite and returns the refreshed allowlist', async () => {
    const refreshed = { emails: ['x@gmail.com'], discord: [] };
    fetchSpy.and.resolveTo(jsonResponse(refreshed));
    const result = await service.invite('email', 'x@gmail.com');
    const init = lastInit();
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'x@gmail.com' });
    expect(result).toEqual(refreshed);
  });

  it('POSTs a {discord} body (not {email}) for a Discord invite', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ emails: [], discord: ['bob'] }));
    await service.invite('discord', 'bob');
    expect(JSON.parse(String(lastInit().body))).toEqual({ discord: 'bob' });
  });

  it('usage() falls back to a zeroed summary when the GET fails', async () => {
    fetchSpy.and.resolveTo(jsonResponse(null, { ok: false, status: 503 }));
    const usage = await service.usage();
    expect(usage).toEqual({ byModule: [], byAction: [], activeUsers: 0, totalEvents: 0 });
  });

  it('unwraps the { rules } envelope for routeAccess()', async () => {
    const rules: RouteRule[] = [
      { id: 'r1', gateway: 'snapdragon-be-gateway', url_pattern: '/api/**', role: 'ROLE_ADMIN', allow: true },
    ];
    fetchSpy.and.resolveTo(jsonResponse({ rules }));
    expect(await service.routeAccess()).toEqual(rules);
  });

  it('returns [] when the routeAccess GET fails (no envelope to unwrap)', async () => {
    fetchSpy.and.resolveTo(jsonResponse(null, { ok: false, status: 500 }));
    expect(await service.routeAccess()).toEqual([]);
  });

  it('DELETEs a route rule by id and unwraps the refreshed { rules }', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ rules: [] }));
    const result = await service.removeRouteRule('r1');
    expect(lastInit().method).toBe('DELETE');
    expect(JSON.parse(String(lastInit().body))).toEqual({ id: 'r1' });
    expect(result).toEqual([]);
  });

  it('unwraps the { routes } envelope for routeDefinitions()', async () => {
    const defs: RouteDefinition[] = [
      { pathPrefix: '/api/games/', downstreamUri: 'http://svc:8080', serviceName: null, requiredRole: null },
    ];
    fetchSpy.and.resolveTo(jsonResponse({ routes: defs }));
    expect(await service.routeDefinitions()).toEqual(defs);
  });

  it('url-encodes the path prefix when DELETEing a route definition', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ routes: [] }));
    await service.removeRouteDefinition('/api/games/');
    expect(lastInit().method).toBe('DELETE');
    expect(lastUrl()).toContain('/bff/admin/routes/%2Fapi%2Fgames%2F');
  });

  it('unwraps the { isos } envelope and falls back to [] on failure', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ isos: [{ name: 'a.iso', url: 'u' }] }));
    expect(await service.isos()).toEqual([{ name: 'a.iso', url: 'u' }]);
    fetchSpy.and.resolveTo(jsonResponse(null, { ok: false, status: 500 }));
    expect(await service.isos()).toEqual([]);
  });

  it('unwraps the { namespaces } list for the signed-in user', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ namespaces: ['team-a', 'team-b'] }));
    expect(await service.myNamespaces()).toEqual(['team-a', 'team-b']);
  });

  it('exposes the configured Uptrace URL', () => {
    expect(service.uptraceUrl()).toContain('uptrace');
  });

  // ── Backup & Recovery ────────────────────────────────────────────────
  it('POSTs the start-backup body and returns the {id,status}', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ id: 'job-1', status: 'QUEUED' }));
    const res = await service.startBackup({ scope: ['etcd'], target: 'CLUSTER', encrypt: false });
    expect(lastUrl()).toContain('/bff/admin/backups');
    expect(lastInit().method).toBe('POST');
    expect(JSON.parse(String(lastInit().body))).toEqual({ scope: ['etcd'], target: 'CLUSTER', encrypt: false });
    expect(res).toEqual({ id: 'job-1', status: 'QUEUED' });
  });

  it('throws the BFF {error} message when a start fails (e.g. wrong password 403)', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ error: 'incorrect decryption password' }, { ok: false, status: 403 }));
    await expectAsync(
      service.startRestore({ backupId: '11111111-2222-3333-4444-555555555555', password: 'nope' }),
    ).toBeRejectedWithError('incorrect decryption password');
  });

  it('unwraps the { backups } history list', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ backups: [{ id: 'a1', status: 'COMPLETED' }] }));
    const h = await service.backupHistory();
    expect(lastUrl()).toContain('/bff/admin/backups');
    expect(h.length).toBe(1);
  });

  it('unwraps the { devices } USB list', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ devices: [{ id: 'usb-1', writable: true }] }));
    const d = await service.usbDevices();
    expect(lastUrl()).toContain('/bff/admin/usb-devices');
    expect(d[0].id).toBe('usb-1');
  });

  it('parses SSE data: frames into JobEvents via streamJobEvents', async () => {
    const frames =
      'event: progress\ndata: {"jobId":"j","phase":"etcd","percent":40,"message":"x","done":false}\n\n' +
      'event: complete\ndata: {"jobId":"j","phase":"complete","percent":100,"message":"done","done":true}\n\n';
    const body = readableFrom(frames);
    fetchSpy.and.resolveTo({ ok: true, status: 200, body } as unknown as Response);

    const got: unknown[] = [];
    await service.streamJobEvents('j', (e) => got.push(e));
    expect(got.length).toBe(2);
    expect((got[1] as { percent: number }).percent).toBe(100);
  });

  // ── Appeals decide-proxy (POST /bff/admin/moderation/{id}/decide?approve=) ──
  describe('decideModeration', () => {
    it('POSTs to the decide-proxy with the id in the path + approve in the query', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ id: 7, status: 'approved' }));
      const row = await service.decideModeration(7, true);
      expect(lastUrl()).toContain('/bff/admin/moderation/7/decide');
      expect(lastUrl()).toContain('approve=true');
      expect(lastInit().method).toBe('POST');
      expect(authHeader()).toBe('Bearer bff-tok-1');
      expect(row.status).toBe('approved');
    });

    it('sends approve=false for a deny', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ id: 7, status: 'denied' }));
      await service.decideModeration(7, false);
      expect(lastUrl()).toContain('approve=false');
    });

    it('throws the BFF {error} message on a reject (e.g. a 404 cross-domain row)', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ error: 'not found' }, { ok: false, status: 404 }));
      await expectAsync(service.decideModeration(99, true)).toBeRejectedWithError('not found');
    });

    it('falls back to HTTP <status> when the error body has no {error}', async () => {
      fetchSpy.and.resolveTo(jsonResponse({}, { ok: false, status: 502 }));
      await expectAsync(service.decideModeration(7, true)).toBeRejectedWithError('HTTP 502');
    });
  });
});

/** A minimal ReadableStream whose single chunk is the given SSE text. */
function readableFrom(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
