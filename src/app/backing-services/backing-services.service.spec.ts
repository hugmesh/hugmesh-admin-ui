import { TestBed } from '@angular/core/testing';

import {
  BACKING_SERVICES_BASE_URL,
  BackingServiceApiError,
  BackingServicesCatalog,
  BackingServicesService,
} from './backing-services.service';

/**
 * Service-layer specs for the hand-written backing-services client. They assert the EXACT bff
 * paths + bodies + headers the snapdragon-admin-bff-api `backingservices` package documents
 * (cloud-deploy DESIGN I8-DESIGN Lane M3), the empty-optional omission, the
 * X-BackingServices-StepUp header on the mode change, and the graceful mapping of the bff's
 * 401/403/409/503/400. Cloned from cloud-backups.service.spec.ts.
 */
describe('BackingServicesService', () => {
  let svc: BackingServicesService;
  let fetchSpy: jasmine.Spy;

  function json(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
    } as unknown as Response;
  }

  function sampleCatalog(): BackingServicesCatalog {
    return {
      enabled: true,
      note: 'intent recorded only — self-hosted is the byte-identical default',
      services: [
        {
          id: 'postgres-admin-bff', kind: 'postgres', tier: 2, docsOnly: false,
          displayName: 'admin-bff database', awsTarget: 'RDS', azureTarget: 'Azure DB',
          notes: 'dual URLs', currentMode: 'self-hosted', endpoint: null, credsRef: null, generation: 0,
        },
        {
          id: 'vault-pki', kind: 'pki', tier: 3, docsOnly: true,
          displayName: 'Vault PKI', awsTarget: 'ACM Private CA', azureTarget: 'Key Vault certs',
          notes: 'docs only', currentMode: 'self-hosted', endpoint: null, credsRef: null, generation: 0,
        },
      ],
    };
  }

  function lastCall(): { url: string; init: RequestInit } {
    const args = fetchSpy.calls.mostRecent().args;
    return { url: args[0] as string, init: (args[1] ?? {}) as RequestInit };
  }
  function lastBody(): any {
    const b = lastCall().init.body;
    return b ? JSON.parse(b as string) : undefined;
  }

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, 'fetch');
    TestBed.configureTestingModule({
      providers: [BackingServicesService, { provide: BACKING_SERVICES_BASE_URL, useValue: '' }],
    });
    svc = TestBed.inject(BackingServicesService);
  });

  it('getCatalog GETs /bff/superadmin/backing-services with credentials (no bearer)', async () => {
    fetchSpy.and.resolveTo(json(sampleCatalog()));
    const out = await svc.getCatalog();
    expect(lastCall().url).toBe('/bff/superadmin/backing-services');
    expect(lastCall().init.method).toBe('GET');
    expect(lastCall().init.credentials).toBe('include');
    expect((lastCall().init.headers as any)['Authorization']).toBeUndefined();
    expect(out.services.length).toBe(2);
    expect(out.services[1].docsOnly).toBeTrue();
  });

  it('setMode PUTs the exact /{id}/mode path; managed sends endpoint+credsRef trimmed', async () => {
    fetchSpy.and.resolveTo(json({ id: 'bsm-1', serviceId: 'postgres-admin-bff', mode: 'managed',
      endpoint: 'db.rds:5432', credsRef: 'snapdragon/pg', requestedBySubject: 'root',
      createdAt: 'T', generation: 1 }));
    await svc.setMode('postgres-admin-bff',
      { mode: 'managed', endpoint: '  db.rds:5432  ', credsRef: '  snapdragon/pg  ' }, '  tok-1  ');
    expect(lastCall().url).toBe('/bff/superadmin/backing-services/postgres-admin-bff/mode');
    expect(lastCall().init.method).toBe('PUT');
    const body = lastBody();
    expect(body.mode).toBe('managed');
    expect(body.endpoint).toBe('db.rds:5432');
    expect(body.credsRef).toBe('snapdragon/pg');
    // step-up token rides the header, trimmed.
    expect((lastCall().init.headers as any)['X-BackingServices-StepUp']).toBe('tok-1');
  });

  it('setMode self-hosted omits endpoint/credsRef and the step-up header when no token', async () => {
    fetchSpy.and.resolveTo(json({ id: 'bsm-2', serviceId: 'object-store', mode: 'self-hosted',
      endpoint: null, credsRef: null, requestedBySubject: 'root', createdAt: 'T', generation: 2 }));
    await svc.setMode('object-store', { mode: 'self-hosted', endpoint: '', credsRef: '' });
    const body = lastBody();
    expect(body.mode).toBe('self-hosted');
    expect('endpoint' in body).toBeFalse();
    expect('credsRef' in body).toBeFalse();
    expect((lastCall().init.headers as any)['X-BackingServices-StepUp']).toBeUndefined();
  });

  it('maps a plain 403 to isForbidden and a step-up 403 to isStepUpRequired', async () => {
    fetchSpy.and.resolveTo(json({ error: 'forbidden' }, 403));
    try { await svc.getCatalog(); fail(); } catch (e) {
      expect(e instanceof BackingServiceApiError).toBeTrue();
      expect((e as BackingServiceApiError).isForbidden).toBeTrue();
      expect((e as BackingServiceApiError).isStepUpRequired).toBeFalse();
    }
    fetchSpy.and.resolveTo(json({ error: 'changing a backing-service mode requires step-up re-authentication (present X-BackingServices-StepUp)' }, 403));
    try { await svc.setMode('object-store', { mode: 'managed', endpoint: 's3://b' }); fail(); }
    catch (e) { expect((e as BackingServiceApiError).isStepUpRequired).toBeTrue(); }
  });

  // ── the STRUCTURED step-up signal (X-Step-Up-Required), shared with mfa/step-up-error ──
  // This console is the one production consumer of the retry-header half of the contract: it takes
  // an operator-pasted TOKEN, so it must put it on the header the SERVER named rather than on a
  // client-side guess. The other consumers retry blindly after the MFA dialog and need only
  // isStepUpRequiredError.

  function jsonWithHeaders(body: unknown, status: number, headers: Record<string, string>): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
  }

  it('lifts X-Step-Up-Required onto the error and exposes it as stepUpRetryHeader', async () => {
    fetchSpy.and.resolveTo(jsonWithHeaders(
      { error: 'changing a backing-service mode requires step-up re-authentication (present X-BackingServices-StepUp)' },
      403, { 'X-Step-Up-Required': 'X-BackingServices-StepUp' }));

    try { await svc.setMode('object-store', { mode: 'managed', endpoint: 's3://b' }); fail(); }
    catch (e) {
      const err = e as BackingServiceApiError;
      expect(err.isStepUpRequired).toBeTrue();
      expect(err.stepUpRetryHeader).toBe('X-BackingServices-StepUp');
    }
  });

  it('detects step-up from the SIGNAL even when the message says nothing about step-up', async () => {
    // The whole point: a backend reword can no longer disable the operator's token prompt. Before
    // this, detection was a private /step-up/i sniff on the message and this 403 read as a plain
    // role denial ("you lack the role"), with no token field ever revealed.
    fetchSpy.and.resolveTo(jsonWithHeaders(
      { error: 'this change needs a second factor before it can be recorded' },
      403, { 'X-Step-Up-Required': 'X-BackingServices-StepUp' }));

    try { await svc.setMode('object-store', { mode: 'managed', endpoint: 's3://b' }); fail(); }
    catch (e) {
      expect((e as BackingServiceApiError).isStepUpRequired).toBeTrue();
      expect((e as BackingServiceApiError).stepUpRetryHeader).toBe('X-BackingServices-StepUp');
    }
  });

  it('no longer mistakes a step-up MINT DENIAL for "paste a token"', async () => {
    // The old /step-up/i sniff matched this. It is an ordinary authz failure — the operator holds
    // no licence, so no token they could paste would ever help. The shared detector requires the
    // signal or the narrower "requires step-up" phrase, so this stays a plain 403.
    fetchSpy.and.resolveTo(json({ error: 'step-up denied: operator holds no active SSH license' }, 403));

    try { await svc.setMode('object-store', { mode: 'managed', endpoint: 's3://b' }); fail(); }
    catch (e) {
      expect((e as BackingServiceApiError).isStepUpRequired).toBeFalse();
      expect((e as BackingServiceApiError).isForbidden).toBeTrue();
      expect((e as BackingServiceApiError).stepUpRetryHeader).toBeNull();
    }
  });

  it('an OLD bff (no signal header) still detects step-up and advertises no flavour', async () => {
    fetchSpy.and.resolveTo(json(
      { error: 'changing a backing-service mode requires step-up re-authentication (present X-BackingServices-StepUp)' },
      403));

    try { await svc.setMode('object-store', { mode: 'managed', endpoint: 's3://b' }); fail(); }
    catch (e) {
      expect((e as BackingServiceApiError).isStepUpRequired).toBeTrue();
      expect((e as BackingServiceApiError).stepUpRetryHeader).toBeNull();
    }
  });

  it('setMode sends the token on the SERVER-NAMED retry header, not a hard-coded one', async () => {
    fetchSpy.and.resolveTo(json({ id: 'bsm-3', serviceId: 'object-store', mode: 'managed',
      endpoint: 's3://b', credsRef: null, requestedBySubject: 'root', createdAt: 'T', generation: 3 }));

    await svc.setMode('object-store', { mode: 'managed', endpoint: 's3://b' }, 'tok-9',
      'X-Renamed-StepUp');

    const headers = lastCall().init.headers as any;
    expect(headers['X-Renamed-StepUp']).toBe('tok-9');
    expect(headers['X-BackingServices-StepUp']).toBeUndefined();
  });

  it('setMode falls back to the gate constant when no retry header was advertised', async () => {
    fetchSpy.and.resolveTo(json({ id: 'bsm-4', serviceId: 'object-store', mode: 'managed',
      endpoint: 's3://b', credsRef: null, requestedBySubject: 'root', createdAt: 'T', generation: 4 }));

    await svc.setMode('object-store', { mode: 'managed', endpoint: 's3://b' }, 'tok-9', null);

    expect((lastCall().init.headers as any)['X-BackingServices-StepUp']).toBe('tok-9');
  });

  it('maps 409 (tier-3 docs-only) to isDocsOnly and 503 (dark) to isDark', async () => {
    fetchSpy.and.resolveTo(json({ error: "backing service 'vault-pki' is DOCS-ONLY in v1" }, 409));
    try { await svc.setMode('vault-pki', { mode: 'managed', endpoint: 'x' }); fail(); }
    catch (e) {
      expect((e as BackingServiceApiError).isDocsOnly).toBeTrue();
      expect((e as BackingServiceApiError).message).toContain('DOCS-ONLY');
    }
    fetchSpy.and.resolveTo(json({ dark: true, note: 'ships dark' }, 503));
    try { await svc.setMode('object-store', { mode: 'managed', endpoint: 's3://b' }); fail(); }
    catch (e) { expect((e as BackingServiceApiError).isDark).toBeTrue(); }
  });

  it('maps 401/400 to the typed flags', async () => {
    fetchSpy.and.resolveTo(json({ error: 'unauth' }, 401));
    try { await svc.getCatalog(); fail(); } catch (e) { expect((e as BackingServiceApiError).isUnauthorized).toBeTrue(); }
    fetchSpy.and.resolveTo(json({ error: 'a managed mode requires an endpoint' }, 400));
    try { await svc.setMode('kafka', { mode: 'managed' }); fail(); }
    catch (e) {
      expect((e as BackingServiceApiError).isBadRequest).toBeTrue();
      expect((e as BackingServiceApiError).message).toBe('a managed mode requires an endpoint');
    }
  });
});
