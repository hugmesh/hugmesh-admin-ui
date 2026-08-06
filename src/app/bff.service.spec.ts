import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BffService, RouteDefinition, RouteRule } from './bff.service';
import { SessionService, HugSession } from './session.service';

/** Minimal fetch Response stub. */
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

function adminSession(): HugSession {
  return {
    id: 'google:admin@gmail.com',
    label: 'admin@gmail.com',
    provider: 'google',
    roles: ['admin'],
    registrationComplete: true,
  };
}

describe('BffService', () => {
  let service: BffService;
  let fetchSpy: jasmine.Spy;
  const sessionSig = signal<HugSession | null>(null);

  beforeEach(() => {
    sessionSig.set(adminSession());
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

  it('sends credentials (the HttpOnly bff_ cookie) and NO Authorization header', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ emails: [], discord: [] }));
    await service.allowlist();
    expect(lastUrl()).toContain('/bff/admin/allowlist');
    expect(lastInit().credentials).toBe('include');
    expect(authHeader()).toBeUndefined();
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

  it('unwraps the { rules } envelope for routeAccess(), mfa_required riding along untouched', async () => {
    const rules: RouteRule[] = [
      { id: 'r1', gateway: 'snapdragon-be-gateway', url_pattern: '/api/**', role: 'ROLE_ADMIN', allow: true },
      { id: 'r2', gateway: 'snapdragon-be-gateway', url_pattern: '/bff/admin/**', role: 'ROLE_ADMIN', allow: true, mfa_required: true },
    ];
    fetchSpy.and.resolveTo(jsonResponse({ rules }));
    expect(await service.routeAccess()).toEqual(rules);
  });

  it('POSTs a new route rule with the wire spelling mfa_required (admin-bff RouteRuleRequest snake_case)', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ rules: [] }));
    const result = await service.addRouteRule({
      gateway: 'snapdragon-be-gateway', url_pattern: '/bff/admin/**', role: 'ROLE_ADMIN', allow: true, mfa_required: true,
    });
    expect(lastInit().method).toBe('POST');
    expect(JSON.parse(String(lastInit().body))).toEqual({
      gateway: 'snapdragon-be-gateway', url_pattern: '/bff/admin/**', role: 'ROLE_ADMIN', allow: true, mfa_required: true,
    });
    expect(result).toEqual([]);
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

  it('platformCapabilities returns the envelope and hits the admin endpoint with credentials', async () => {
    const env = {
      argocdPresent: true, veleroPresent: false, buildNodePresent: true, imagesGenerated: false,
      anubisEnabled: false, forumEnabled: false, testLaunchEnabled: false,
      casdoorAdminEnabled: false, homeserverAdminEnabled: false, warnings: ['w'],
    };
    fetchSpy.and.resolveTo(jsonResponse(env));
    expect(await service.platformCapabilities()).toEqual(env);
    expect(lastUrl()).toContain('/bff/admin/platform-capabilities');
    expect(lastInit().credentials).toBe('include');
  });

  it('platformCapabilities FAILS SAFE (all absent + warning) on a non-OK response', async () => {
    fetchSpy.and.resolveTo(jsonResponse(null, { ok: false, status: 503 }));
    const caps = await service.platformCapabilities();
    expect(caps.argocdPresent).toBeFalse();
    expect(caps.veleroPresent).toBeFalse();
    expect(caps.buildNodePresent).toBeFalse();
    expect(caps.imagesGenerated).toBeFalse();
    expect(caps.warnings.length).toBeGreaterThan(0);
  });

  it('platformCapabilities FAILS SAFE on a network error (fetch rejects)', async () => {
    fetchSpy.and.rejectWith(new Error('network down'));
    const caps = await service.platformCapabilities();
    expect(caps.veleroPresent).toBeFalse();
    expect(caps.warnings.length).toBeGreaterThan(0);
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
      expect(lastInit().credentials).toBe('include');
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

  // ── ACCOUNT-BAN appeal inbox (ADMIN/SUPERADMIN, DISTINCT from decideModeration) ──
  describe('account appeals', () => {
    it('accountAppeals GETs the inbox with credentials', async () => {
      const row = { id: 'ap-1', userSub: 'google:alice@x.com', handle: 'alice@x.com', domain: 'brand-a', status: 'PENDING' };
      fetchSpy.and.resolveTo(jsonResponse([row]));
      const rows = await service.accountAppeals();
      expect(lastUrl()).toContain('/bff/admin/account-appeals');
      expect(lastInit().credentials).toBe('include');
      expect(rows).toEqual([row] as unknown as typeof rows);
    });

    it('accountAppeals returns [] (not throw) on a failed read', async () => {
      fetchSpy.and.resolveTo(jsonResponse({}, { ok: false, status: 403 }));
      await expectAsync(service.accountAppeals()).toBeResolvedTo([]);
    });

    it('decideAccountAppeal POSTs the id + status and returns the decide result', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ decided: 1, status: 'APPROVED' }));
      const res = await service.decideAccountAppeal('ap-1', 'APPROVED');
      expect(lastUrl()).toContain('/bff/admin/account-appeals/ap-1/decide');
      expect(lastUrl()).toContain('status=APPROVED');
      expect(lastInit().method).toBe('POST');
      expect(lastInit().credentials).toBe('include');
      expect(res).toEqual({ decided: 1, status: 'APPROVED' });
    });

    it('decideAccountAppeal throws the BFF {error} verbatim on a failed restore — never a silent success', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ error: 'suspension clear failed' }, { ok: false, status: 502 }));
      await expectAsync(service.decideAccountAppeal('ap-1', 'APPROVED'))
        .toBeRejectedWithError('suspension clear failed');
    });
  });

  // ── Domain registry (SUPERADMIN: GET/POST /bff/admin/domains) ──
  describe('domain registry', () => {
    it('GETs the bare JSON-array domain list from /bff/admin/domains', async () => {
      fetchSpy.and.resolveTo(jsonResponse([{ clusterDomain: 'brand-a.example.com', enabled: true }]));
      const domains = await service.listDomains();
      expect(lastUrl()).toContain('/bff/admin/domains');
      expect(lastInit().credentials).toBe('include');
      expect(domains.length).toBe(1);
      expect(domains[0].clusterDomain).toBe('brand-a.example.com');
    });

    it('returns the empty fallback (not throw) when the list GET fails', async () => {
      fetchSpy.and.resolveTo(jsonResponse(null, { ok: false, status: 500 }));
      expect(await service.listDomains()).toEqual([]);
    });

    it('POSTs the CreateDomainRequest body and returns the persisted DomainResponse', async () => {
      const created = { id: 'dom-9', clusterDomain: 'brand-c.example.com', enabled: true };
      fetchSpy.and.resolveTo(jsonResponse(created, { status: 201 }));
      const row = await service.createDomain({ clusterDomain: 'brand-c.example.com', brand: 'brand-c' });
      expect(lastUrl()).toContain('/bff/admin/domains');
      expect(lastInit().method).toBe('POST');
      expect((lastInit().headers as Record<string, string>)['content-type']).toBe('application/json');
      expect(JSON.parse(String(lastInit().body))).toEqual({ clusterDomain: 'brand-c.example.com', brand: 'brand-c' });
      expect(row.clusterDomain).toBe('brand-c.example.com');
    });

    it('throws the BFF {error} message on a 409 duplicate cluster_domain', async () => {
      fetchSpy.and.resolveTo(jsonResponse(
        { error: "domain 'brand-a.example.com' is already registered" }, { ok: false, status: 409 }));
      await expectAsync(service.createDomain({ clusterDomain: 'brand-a.example.com' }))
        .toBeRejectedWithError("domain 'brand-a.example.com' is already registered");
    });
  });

  // ── DESKTOP APP GOVERNANCE (step-up / remote-install header / dials) ──
  describe('desktop governance', () => {
    function textResponse(body: string, init?: { ok?: boolean; status?: number }): Response {
      return {
        ok: init?.ok ?? true,
        status: init?.status ?? 200,
        text: async () => body,
        json: async () => ({}),
      } as unknown as Response;
    }
    function header(name: string): string | undefined {
      return (lastInit().headers as Record<string, string>)?.[name];
    }

    it('desktopStepUp POSTs /bff/admin/desktop/step-up (ADMIN-reachable, NOT the superadmin mint) and returns the token', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ stepUpToken: 'TK', ttlMinutes: 5 }));
      const r = await service.desktopStepUp();
      expect(r).toEqual({ stepUpToken: 'TK', ttlMinutes: 5 });
      expect(lastUrl()).toContain('/bff/admin/desktop/step-up');
      expect(lastUrl()).not.toContain('/superadmin/');
      expect(lastInit().method).toBe('POST');
      // operator defaults to the lowercased session id.
      expect(lastUrl()).toContain('operatorId=google%3Aadmin%40gmail.com');
    });

    it('desktopStepUp surfaces a 403 (no active license) via errorOf', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ error: 'no active ssh-license' }, { ok: false, status: 403 }));
      await expectAsync(service.desktopStepUp()).toBeRejectedWithError('no active ssh-license');
    });

    it('desktopRemoteInstall sends the step-up via X-Device-Terminal-StepUp when a token is given', async () => {
      fetchSpy.and.resolveTo(textResponse('queued'));
      const out = await service.desktopRemoteInstall('dev-1', 'org.x.App', 'STEPUP-TOK');
      expect(out).toBe('queued');
      expect(lastUrl()).toContain('/bff/admin/desktop/remote-install');
      expect(header('X-Device-Terminal-StepUp')).toBe('STEPUP-TOK');
      expect(JSON.parse(String(lastInit().body))).toEqual({ deviceId: 'dev-1', appRef: 'org.x.App' });
    });

    it('desktopRemoteInstall omits the step-up header when no token is given (BFF then 403s)', async () => {
      fetchSpy.and.resolveTo(textResponse('queued'));
      await service.desktopRemoteInstall('dev-1', 'org.x.App');
      expect(header('X-Device-Terminal-StepUp')).toBeUndefined();
    });

    it('desktopRemoteInstall surfaces a 403 (missing step-up) verbatim', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ error: 'step-up required' }, { ok: false, status: 403 }));
      await expectAsync(service.desktopRemoteInstall('dev-1', 'org.x.App'))
        .toBeRejectedWithError('step-up required');
    });

    it('desktopDialCapability returns true ONLY on a 200 (403/404/503/network → false, no leak)', async () => {
      fetchSpy.and.resolveTo(jsonResponse([]));
      await expectAsync(service.desktopDialCapability()).toBeResolvedTo(true);
      fetchSpy.and.resolveTo(jsonResponse(null, { ok: false, status: 503 }));
      await expectAsync(service.desktopDialCapability()).toBeResolvedTo(false);
      fetchSpy.and.rejectWith(new Error('down'));
      await expectAsync(service.desktopDialCapability()).toBeResolvedTo(false);
    });

    it('desktopDials swallows 403/404 to [] (no existence leak)', async () => {
      fetchSpy.and.resolveTo(jsonResponse(null, { ok: false, status: 403 }));
      await expectAsync(service.desktopDials()).toBeResolvedTo([]);
    });

    it('desktopDialActivate POSTs the activate path carrying the step-up header', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ deviceId: 'dev-1', dialUser: 'u', status: 'ACTIVE', generation: 2 }));
      const d = await service.desktopDialActivate('dev-1', 'STEPUP-TOK');
      expect(d.status).toBe('ACTIVE');
      expect(lastUrl()).toContain('/bff/superadmin/desktop/dials/dev-1/activate');
      expect(header('X-Device-Terminal-StepUp')).toBe('STEPUP-TOK');
    });

    it('desktopDialActivate surfaces a 422 (unpinned) verbatim', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ error: 'dial has no host-key pin' }, { ok: false, status: 422 }));
      await expectAsync(service.desktopDialActivate('dev-1', 'TK'))
        .toBeRejectedWithError('dial has no host-key pin');
    });

    it('desktopDialRevoke POSTs the revoke path carrying the step-up header', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ deviceId: 'dev-1', dialUser: 'u', status: 'REVOKED', generation: 3 }));
      const d = await service.desktopDialRevoke('dev-1', 'STEPUP-TOK');
      expect(d.status).toBe('REVOKED');
      expect(lastUrl()).toContain('/bff/superadmin/desktop/dials/dev-1/revoke');
      expect(header('X-Device-Terminal-StepUp')).toBe('STEPUP-TOK');
    });

    it('desktopOpenSshSession returns the descriptor (wsPath + stepUpRequired + dark)', async () => {
      fetchSpy.and.resolveTo(jsonResponse({
        deviceId: 'dev-1', dark: true, stepUpRequired: true, wsPath: '/bff/admin/device-terminal/dev-1',
      }));
      const s = await service.desktopOpenSshSession('dev-1');
      expect(s.wsPath).toBe('/bff/admin/device-terminal/dev-1');
      expect(s.stepUpRequired).toBeTrue();
      expect(lastUrl()).toContain('/bff/admin/desktop/ssh-terminal/sessions?deviceId=dev-1');
    });
  });

  describe('phone fleet', () => {
    it('phones() unwraps the { phones } envelope from the superadmin registry with credentials', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ phones: [{ id: 'row-1', deviceId: 'phone-1', enterpriseProfilePresent: false, ingestCount: 3 }] }));
      const phones = await service.phones();
      expect(phones.length).toBe(1);
      expect(phones[0].deviceId).toBe('phone-1');
      expect(lastUrl()).toContain('/bff/superadmin/phone-devices');
      expect(lastInit().credentials).toBe('include');
    });

    it('phones() returns [] (not throw) on a failed read', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ error: 'forbidden' }, { ok: false, status: 403 }));
      await expectAsync(service.phones()).toBeResolvedTo([]);
    });

    it('phone() GETs the url-encoded deviceId path and returns the row', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ id: 'row-1', deviceId: 'phone/1', enterpriseProfilePresent: true, ingestCount: 9 }));
      const p = await service.phone('phone/1');
      expect(p!.ingestCount).toBe(9);
      expect(lastUrl()).toContain('/bff/superadmin/phone-devices/phone%2F1');
    });

    it('phone() returns null (not throw) on a 404 unknown device', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ error: 'unknown device' }, { ok: false, status: 404 }));
      await expectAsync(service.phone('nope')).toBeResolvedTo(null);
    });

    // ── Device-management + lockout mutations (SUPERADMIN + X-PhoneLock-StepUp) ──
    function phoneHeader(name: string): string | undefined {
      return (lastInit().headers as Record<string, string>)?.[name];
    }

    it('setPhoneManagement PUTs the management path with {mode} body + credentials, and sends X-PhoneLock-StepUp when a token is given', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ deviceId: 'phone-1', managementMode: 'mesh_owned' }));
      const updated = await service.setPhoneManagement('phone/1', 'mesh_owned', 'TK-1');
      expect(updated.managementMode).toBe('mesh_owned');
      expect(lastUrl()).toContain('/bff/superadmin/phone-devices/phone%2F1/management');
      expect(lastInit().method).toBe('PUT');
      expect(lastInit().credentials).toBe('include');
      expect(JSON.parse(String(lastInit().body))).toEqual({ mode: 'mesh_owned' });
      expect(phoneHeader('X-PhoneLock-StepUp')).toBe('TK-1');
    });

    it('setPhoneManagement omits the step-up header when no token is given (the BFF then 403s)', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ deviceId: 'phone-1', managementMode: 'unmanaged' }));
      await service.setPhoneManagement('phone-1', 'unmanaged');
      expect(phoneHeader('X-PhoneLock-StepUp')).toBeUndefined();
    });

    it('lockPhone POSTs .../lock with the {reason} body and sends the step-up header', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ deviceId: 'phone-1', lockState: 'locked' }));
      const updated = await service.lockPhone('phone-1', 'stolen', 'TK-2');
      expect(updated.lockState).toBe('locked');
      expect(lastUrl()).toContain('/bff/superadmin/phone-devices/phone-1/lock');
      expect(lastInit().method).toBe('POST');
      expect(JSON.parse(String(lastInit().body))).toEqual({ reason: 'stolen' });
      expect(phoneHeader('X-PhoneLock-StepUp')).toBe('TK-2');
    });

    it('unlockPhone POSTs .../unlock with NO body and the step-up header when a token is given', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ deviceId: 'phone-1', lockState: 'unlocked' }));
      const updated = await service.unlockPhone('phone-1', 'TK-3');
      expect(updated.lockState).toBe('unlocked');
      expect(lastUrl()).toContain('/bff/superadmin/phone-devices/phone-1/unlock');
      expect(lastInit().method).toBe('POST');
      expect(lastInit().body).toBeUndefined();
      expect(phoneHeader('X-PhoneLock-StepUp')).toBe('TK-3');
      // No JSON body means no content-type header on the request.
      expect(phoneHeader('content-type')).toBeUndefined();
    });

    it('a phone-lock mutation THROWS the BFF {error} on a non-OK — so a step-up 403 surfaces for isStepUpRequiredError', async () => {
      fetchSpy.and.resolveTo(jsonResponse(
        { error: 'phone lock requires step-up re-authentication (present X-PhoneLock-StepUp)' },
        { ok: false, status: 403 }));
      await expectAsync(service.lockPhone('phone-1', 'stolen'))
        .toBeRejectedWithError(/requires step-up/);
    });

    it('lockPhone surfaces the BFF 409 for a BYOD device verbatim', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ error: 'not a managed device' }, { ok: false, status: 409 }));
      await expectAsync(service.lockPhone('phone-byod', 'x')).toBeRejectedWithError('not a managed device');
    });
  });

  // ── Fleet-owner surface + owner assignment + entitlement admin (fleet-entitlement wave) ──
  describe('fleet owner + entitlements', () => {
    function header(name: string): string | undefined {
      return (lastInit().headers as Record<string, string>)?.[name];
    }

    // ── Fleet-OWNER surface (PUBLIC /bff/admin/phone-fleet) ──
    it('ownedPhones() unwraps the { phones } envelope from the PUBLIC owner surface with credentials', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ phones: [
        { id: 'row-9', deviceId: 'owned-1', enterpriseProfilePresent: false, ingestCount: 2,
          physicalOwner: 'casdoor:alice', ownerDomain: 'brand-a' },
      ] }));
      const phones = await service.ownedPhones();
      expect(phones.length).toBe(1);
      expect(phones[0].deviceId).toBe('owned-1');
      expect(phones[0].physicalOwner).toBe('casdoor:alice');
      expect(phones[0].ownerDomain).toBe('brand-a');
      // The FLEET-OWNER path is the PUBLIC one, distinct from the superadmin registry read.
      expect(lastUrl()).toContain('/bff/admin/phone-fleet');
      expect(lastUrl()).not.toContain('/bff/superadmin/');
      expect(lastInit().credentials).toBe('include');
    });

    it('ownedPhones() returns [] (not throw) on a denied/failed read — an un-entitled fleet-admin shows an honest empty fleet', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ error: 'fleet entitlement required' }, { ok: false, status: 403 }));
      await expectAsync(service.ownedPhones()).toBeResolvedTo([]);
    });

    it('lockOwnedPhone POSTs the fleet-owner .../lock path with {reason} and the X-PhoneLock-StepUp header', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ deviceId: 'owned-1', lockState: 'locked' }));
      const updated = await service.lockOwnedPhone('owned/1', 'stolen', 'TK-9');
      expect(updated.lockState).toBe('locked');
      expect(lastUrl()).toContain('/bff/admin/phone-fleet/owned%2F1/lock');
      expect(lastInit().method).toBe('POST');
      expect(JSON.parse(String(lastInit().body))).toEqual({ reason: 'stolen' });
      expect(header('X-PhoneLock-StepUp')).toBe('TK-9');
    });

    it('unlockOwnedPhone POSTs the fleet-owner .../unlock path with NO body and the step-up header', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ deviceId: 'owned-1', lockState: 'unlocked' }));
      const updated = await service.unlockOwnedPhone('owned-1', 'TK-10');
      expect(updated.lockState).toBe('unlocked');
      expect(lastUrl()).toContain('/bff/admin/phone-fleet/owned-1/unlock');
      expect(lastInit().method).toBe('POST');
      expect(lastInit().body).toBeUndefined();
      expect(header('X-PhoneLock-StepUp')).toBe('TK-10');
      expect(header('content-type')).toBeUndefined();
    });

    it('a fleet-owner lock THROWS the BFF {error} on a non-OK — so a step-up 403 surfaces for isStepUpRequiredError', async () => {
      fetchSpy.and.resolveTo(jsonResponse(
        { error: 'lock requires step-up re-authentication (present X-PhoneLock-StepUp)' },
        { ok: false, status: 403 }));
      await expectAsync(service.lockOwnedPhone('owned-1', 'stolen'))
        .toBeRejectedWithError(/requires step-up/);
    });

    it('a fleet-owner lock on a cross-owner device surfaces the BFF 404 verbatim (no enumeration)', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ error: "phone 'other' not found" }, { ok: false, status: 404 }));
      await expectAsync(service.lockOwnedPhone('other', 'x')).toBeRejectedWithError(/not found/);
    });

    // ── SUPERADMIN owner assignment (changeset 305) ──
    it('setPhoneOwner PUTs the superadmin .../owner path with {physicalOwner, ownerDomain} + the step-up header', async () => {
      fetchSpy.and.resolveTo(jsonResponse(
        { deviceId: 'phone-1', physicalOwner: 'casdoor:bob', ownerDomain: 'brand-b' }));
      const updated = await service.setPhoneOwner('phone/1',
        { physicalOwner: 'casdoor:bob', ownerDomain: 'brand-b' }, 'TK-11');
      expect(updated.physicalOwner).toBe('casdoor:bob');
      expect(updated.ownerDomain).toBe('brand-b');
      expect(lastUrl()).toContain('/bff/superadmin/phone-devices/phone%2F1/owner');
      expect(lastInit().method).toBe('PUT');
      expect(JSON.parse(String(lastInit().body)))
        .toEqual({ physicalOwner: 'casdoor:bob', ownerDomain: 'brand-b' });
      expect(header('X-PhoneLock-StepUp')).toBe('TK-11');
    });

    it('setPhoneOwner THROWS the BFF {error} on a non-OK (400 blank field / 403 step-up)', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ error: 'physicalOwner is required' }, { ok: false, status: 400 }));
      await expectAsync(service.setPhoneOwner('phone-1', { physicalOwner: '', ownerDomain: 'b' }))
        .toBeRejectedWithError('physicalOwner is required');
    });

    // ── SUPERADMIN entitlement admin (changeset 306) ──
    it('listFleetEntitlements() unwraps the { entitlements } envelope with credentials', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ entitlements: [
        { subject: 'casdoor:alice', active: true, seats: 25, expiresAt: null, updatedAt: '2026-07-20T09:00:00Z' },
      ] }));
      const list = await service.listFleetEntitlements();
      expect(list.length).toBe(1);
      expect(list[0].subject).toBe('casdoor:alice');
      expect(list[0].seats).toBe(25);
      expect(lastUrl()).toContain('/bff/superadmin/fleet-entitlements');
      expect(lastInit().credentials).toBe('include');
    });

    it('listFleetEntitlements() returns [] (not throw) on a failed read', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ error: 'forbidden' }, { ok: false, status: 403 }));
      await expectAsync(service.listFleetEntitlements()).toBeResolvedTo([]);
    });

    it('upsertFleetEntitlement PUTs .../{subject} with the {active, seats, expiresAt} body + the step-up header', async () => {
      fetchSpy.and.resolveTo(jsonResponse(
        { subject: 'casdoor:alice', active: true, seats: 25, expiresAt: '2026-12-31T00:00:00Z', updatedAt: '2026-07-21T00:00:00Z' }));
      const saved = await service.upsertFleetEntitlement('casdoor:alice',
        { active: true, seats: 25, expiresAt: '2026-12-31T00:00:00Z' }, 'TK-12');
      expect(saved.subject).toBe('casdoor:alice');
      expect(lastUrl()).toContain('/bff/superadmin/fleet-entitlements/casdoor%3Aalice');
      expect(lastInit().method).toBe('PUT');
      expect(JSON.parse(String(lastInit().body)))
        .toEqual({ active: true, seats: 25, expiresAt: '2026-12-31T00:00:00Z' });
      expect(header('X-PhoneLock-StepUp')).toBe('TK-12');
    });

    it('upsertFleetEntitlement THROWS the BFF {error} on a non-OK — so a step-up 403 surfaces', async () => {
      fetchSpy.and.resolveTo(jsonResponse(
        { error: 'entitlement upsert requires step-up re-authentication (present X-PhoneLock-StepUp)' },
        { ok: false, status: 403 }));
      await expectAsync(service.upsertFleetEntitlement('casdoor:alice', { active: true }))
        .toBeRejectedWithError(/requires step-up/);
    });

    it('removeFleetEntitlement DELETEs .../{subject} with the step-up header and returns { deleted }', async () => {
      fetchSpy.and.resolveTo(jsonResponse({ deleted: 1 }));
      const result = await service.removeFleetEntitlement('casdoor:alice', 'TK-13');
      expect(result.deleted).toBe(1);
      expect(lastUrl()).toContain('/bff/superadmin/fleet-entitlements/casdoor%3Aalice');
      expect(lastInit().method).toBe('DELETE');
      expect(header('X-PhoneLock-StepUp')).toBe('TK-13');
    });

    it('removeFleetEntitlement THROWS the BFF {error} on a non-OK', async () => {
      fetchSpy.and.resolveTo(jsonResponse(
        { error: 'entitlement delete requires step-up re-authentication (present X-PhoneLock-StepUp)' },
        { ok: false, status: 403 }));
      await expectAsync(service.removeFleetEntitlement('casdoor:alice'))
        .toBeRejectedWithError(/requires step-up/);
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
