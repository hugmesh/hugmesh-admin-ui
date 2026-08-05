import { TestBed } from '@angular/core/testing';

import {
  BackupSet,
  CLOUD_BACKUPS_BASE_URL,
  CloudBackupApiError,
  CloudBackupsService,
} from './cloud-backups.service';

/**
 * Service-layer specs for the hand-written cloud-backups client. They assert the
 * EXACT bff paths + bodies + headers the hugmesh-admin-bff-api `cloudbackup`
 * package documents (PR #74), the CROSS-DOMAIN rule (no domain/createdBy/scope is
 * ever sent on a write), the X-Backup-StepUp header on restore, and the graceful
 * mapping of the bff's 401/403/404/400 + 204.
 */
describe('CloudBackupsService', () => {
  let svc: CloudBackupsService;
  let fetchSpy: jasmine.Spy;

  /** A stubbed fetch Response. NOTE: when `headers` is omitted the stub has NO
   *  `headers` property at all — deliberately, so the default shape keeps proving
   *  the service tolerates a header-less Response (old polyfills/stubs) instead of
   *  throwing a TypeError while reading the step-up signal. */
  function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      ...(headers ? { headers: new Headers(headers) } : {}),
      text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
    } as unknown as Response;
  }

  function sampleSet(over: Partial<BackupSet> = {}): BackupSet {
    return {
      id: 'set-1', setKey: 'nightly', version: 3, scope: 'DOMAIN', domain: 'acme.test',
      createdBy: 'google:root', services: ['postgres'], destinationKind: 'object_store',
      destinationRef: 's3://acme/backups', sizeBytes: null, encryptionMeta: null,
      status: 'pending', createdAt: 'T', startedAt: null, completedAt: null, ...over,
    };
  }

  /** The single call args for the most recent fetch. */
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
      providers: [CloudBackupsService, { provide: CLOUD_BACKUPS_BASE_URL, useValue: '' }],
    });
    svc = TestBed.inject(CloudBackupsService);
  });

  it('listSets GETs /bff/admin/cloud-backups with credentials (no bearer) and no domain filter', async () => {
    fetchSpy.and.resolveTo(json([sampleSet()]));
    const out = await svc.listSets();
    expect(lastCall().url).toBe('/bff/admin/cloud-backups');
    expect(lastCall().init.credentials).toBe('include');
    expect((lastCall().init.headers as any)['Authorization']).toBeUndefined();
    expect(out.length).toBe(1);
  });

  it('listSets adds the SUPERADMIN ?domain= filter when given', async () => {
    fetchSpy.and.resolveTo(json([]));
    await svc.listSets('beta.test');
    expect(lastCall().url).toBe('/bff/admin/cloud-backups?domain=beta.test');
  });

  it('createSet POSTs to /bff/admin/cloud-backups and NEVER sends domain/createdBy/scope', async () => {
    fetchSpy.and.resolveTo(json(sampleSet()));
    await svc.createSet({
      services: ['postgres', 'matrix'],
      destinationKind: 'object_store',
      destinationRef: 's3://acme/backups',
      // deliberately attempt to smuggle forbidden fields — the client must drop them
      setKey: '',
      encryptionMeta: '',
    });
    expect(lastCall().url).toBe('/bff/admin/cloud-backups');
    expect(lastCall().init.method).toBe('POST');
    const body = lastBody();
    expect(body.services).toEqual(['postgres', 'matrix']);
    expect(body.destinationKind).toBe('object_store');
    expect(body.destinationRef).toBe('s3://acme/backups');
    // CROSS-DOMAIN: no domain / createdBy / scope leaks to the bff
    expect('domain' in body).toBeFalse();
    expect('createdBy' in body).toBeFalse();
    expect('scope' in body).toBeFalse();
    // empty optionals are omitted (not sent as empty strings)
    expect('setKey' in body).toBeFalse();
    expect('encryptionMeta' in body).toBeFalse();
  });

  it('createSet keeps non-empty optional fields (trimmed)', async () => {
    fetchSpy.and.resolveTo(json(sampleSet()));
    await svc.createSet({
      services: ['postgres'], destinationKind: 'node_storage', destinationRef: 'pool-1',
      setKey: '  nightly  ', encryptionMeta: '  {"repo":"r"}  ',
    });
    const body = lastBody();
    expect(body.setKey).toBe('nightly');
    expect(body.encryptionMeta).toBe('{"repo":"r"}');
  });

  it('versions + artifacts GET the scoped sub-resource paths', async () => {
    fetchSpy.and.resolveTo(json([]));
    await svc.versions('set-1');
    expect(lastCall().url).toBe('/bff/admin/cloud-backups/set-1/versions');
    await svc.artifacts('set-1');
    expect(lastCall().url).toBe('/bff/admin/cloud-backups/set-1/artifacts');
  });

  it('restore POSTs .../restore with the X-Backup-StepUp header carrying the token', async () => {
    fetchSpy.and.resolveTo(json({ id: 'set-1', version: 3, status: 'RESTORE_QUEUED' }));
    const res = await svc.restore('set-1', 'stepup-xyz');
    expect(lastCall().url).toBe('/bff/admin/cloud-backups/set-1/restore');
    expect(lastCall().init.method).toBe('POST');
    expect((lastCall().init.headers as any)['X-Backup-StepUp']).toBe('stepup-xyz');
    expect(res.status).toBe('RESTORE_QUEUED');
  });

  it('services + getDestination GET the documented paths; 204 → undefined', async () => {
    fetchSpy.and.resolveTo(json([{ key: 'postgres', displayName: 'Postgres', defaultKind: 'db_dump', optional: false }]));
    const menu = await svc.services();
    expect(lastCall().url).toBe('/bff/admin/cloud-backups/services');
    expect(menu[0].key).toBe('postgres');

    fetchSpy.and.resolveTo(json(undefined, 204));
    const dest = await svc.getDestination();
    expect(lastCall().url).toBe('/bff/admin/cloud-backups/destinations');
    expect(dest).toBeUndefined();
  });

  it('putDestination PUTs the destination and drops a node_storage secretRef the caller nulled', async () => {
    fetchSpy.and.resolveTo(json({ id: 'd1', kind: 'node_storage', destinationRef: 'pool-1', secretRef: null, domain: 'acme.test', updatedBy: 'x', createdAt: 'T', updatedAt: 'T' }));
    await svc.putDestination({ kind: 'node_storage', destinationRef: 'pool-1', secretRef: null });
    expect(lastCall().url).toBe('/bff/admin/cloud-backups/destinations');
    expect(lastCall().init.method).toBe('PUT');
    const body = lastBody();
    expect(body.kind).toBe('node_storage');
    expect('secretRef' in body).toBeFalse();
    expect('domain' in body).toBeFalse();
  });

  it('createTotal POSTs to the SUPERADMIN /bff/superadmin/cloud-backups/total endpoint', async () => {
    fetchSpy.and.resolveTo(json(sampleSet({ scope: 'TOTAL' })));
    await svc.createTotal({ services: ['etcd'], destinationKind: 'object_store', destinationRef: 's3://x' });
    expect(lastCall().url).toBe('/bff/superadmin/cloud-backups/total');
    expect(lastCall().init.method).toBe('POST');
    expect('scope' in lastBody()).toBeFalse();
  });

  it('maps a 403 to a CloudBackupApiError(isForbidden)', async () => {
    fetchSpy.and.resolveTo(json({ error: 'forbidden' }, 403));
    await expectAsync(svc.listSets()).toBeRejectedWith(jasmine.objectContaining({ status: 403 }));
    try {
      await svc.listSets();
    } catch (e) {
      expect(e instanceof CloudBackupApiError).toBeTrue();
      expect((e as CloudBackupApiError).isForbidden).toBeTrue();
    }
  });

  it('distinguishes a step-up 403 (restore) from a plain role 403', async () => {
    // OLD-BFF direction: no X-Step-Up-Required header (the stub has no headers at
    // all), only the exact legacy contract phrase — must STAY detected (frozen
    // rolling-deploy requirement: new UI + old BFF).
    fetchSpy.and.resolveTo(json({ error: 'restore requires step-up: present a valid step-up token in the X-Backup-StepUp header' }, 403));
    try {
      await svc.restore('set-1', 'bad');
      fail('expected reject');
    } catch (e) {
      const err = e as CloudBackupApiError;
      expect(err.isForbidden).toBeTrue();
      expect(err.isStepUpRequired).toBeTrue();
    }
  });

  it('NEW-BFF direction: the X-Step-Up-Required response header alone marks step-up, message not load-bearing', async () => {
    // The message deliberately contains NO step-up wording at all: only the
    // structured header carries the requirement, exactly as the shared
    // isStepUpRequiredError contract (mfa/step-up-error.ts) reads it. This is the
    // seam the pre-migration service could not reach — req() discarded the
    // Response headers entirely.
    fetchSpy.and.resolveTo(json({ error: 'a second factor is needed before this can run' }, 403,
      { 'X-Step-Up-Required': 'X-Backup-StepUp' }));
    try {
      await svc.restore('set-1');
      fail('expected reject');
    } catch (e) {
      const err = e as CloudBackupApiError;
      expect(err.isForbidden).toBeTrue();
      expect(err.isStepUpRequired).toBeTrue();
      // The raw signal is CAPTURED onto the error (the shared BffHttpError seam),
      // so the retry-header name is available to any future token-carrying caller.
      expect(err.stepUpSignal).toBe('X-Backup-StepUp');
    }
  });

  it('an ordinary 403 whose prose merely MENTIONS step-up is NOT step-up (no header, no contract phrase)', async () => {
    // The old local sniff was /step-up/i on the message — looser than the platform
    // contract (/requires step-up/i). A routine role-denial whose free text
    // happens to say "step-up" must NOT pop the MFA dialog.
    fetchSpy.and.resolveTo(json({ error: 'step-up policy forbids this' }, 403));
    try {
      await svc.restore('set-1');
      fail('expected reject');
    } catch (e) {
      const err = e as CloudBackupApiError;
      expect(err.isForbidden).toBeTrue();
      expect(err.isStepUpRequired).toBeFalse();
    }
  });

  it('maps 401/404/400 to the typed flags', async () => {
    fetchSpy.and.resolveTo(json({ error: 'unauth' }, 401));
    try { await svc.listSets(); fail(); } catch (e) { expect((e as CloudBackupApiError).isUnauthorized).toBeTrue(); }
    fetchSpy.and.resolveTo(json({ error: 'gone' }, 404));
    try { await svc.versions('x'); fail(); } catch (e) { expect((e as CloudBackupApiError).isNotFound).toBeTrue(); }
    fetchSpy.and.resolveTo(json({ message: 'bad kind' }, 400));
    try { await svc.createSet({ services: ['x'], destinationKind: 'object_store', destinationRef: 'r' }); fail(); }
    catch (e) { expect((e as CloudBackupApiError).isBadRequest).toBeTrue(); expect((e as CloudBackupApiError).message).toBe('bad kind'); }
  });
});
