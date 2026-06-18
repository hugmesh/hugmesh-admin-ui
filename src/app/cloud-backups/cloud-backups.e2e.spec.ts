import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CloudBackupCreateComponent } from './cloud-backup-create.component';
import { CloudBackupSetsComponent } from './cloud-backup-sets.component';
import { BackupSet, CLOUD_BACKUPS_BASE_URL, CloudBackupsService } from './cloud-backups.service';
import { SessionService } from '../session.service';

/**
 * Gherkin-readable END-TO-END for the Cloud Backups headline flows:
 *
 *   FEATURE: An admin backs up their brand's services, then restores a version
 *            (which the platform requires a step-up to do).
 *
 * These drive the REAL components through the REAL CloudBackupsService, with ONLY
 * `fetch` stubbed at the network edge — so the whole stack below the view
 * (view → service → exact bff path/body/header) is exercised against the
 * snapdragon-admin-bff-api `cloudbackup` PR #74 contract, not a mocked service.
 *
 * A backing in-memory "bff" stores created sets and enforces the restore step-up
 * exactly like the bff's BackupStepUpGate: a restore WITHOUT the X-Backup-StepUp
 * header is a 403 naming step-up; WITH a valid token it queues. So "needs a
 * step-up" and "step-up satisfied" are real observable effects, end to end.
 */
describe('FEATURE: Admin cloud-backup + step-up restore (e2e)', () => {
  let fetchSpy: jasmine.Spy;
  let bffSets: BackupSet[];
  const VALID_STEPUP = 'stepup-OK';

  function json(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
    } as unknown as Response;
  }

  /** The running-services menu the fake bff serves (mirrors StubRunningServiceProvider). */
  const MENU = [
    { key: 'postgres', displayName: 'Postgres', defaultKind: 'db_dump', optional: false },
    { key: 'config', displayName: 'Config', defaultKind: 'config', optional: false },
  ];

  /** Wire the fake bff. Stamps domain + createdBy server-side (proving the UI never
   *  sends them). Enforces the restore step-up gate. */
  function installFakeBff(): void {
    fetchSpy.and.callFake((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = init?.body ? JSON.parse(init.body as string) : undefined;

      if (method === 'GET' && /\/cloud-backups\/services$/.test(url)) {
        return Promise.resolve(json(MENU));
      }
      if (method === 'GET' && /\/cloud-backups\/destinations/.test(url)) {
        return Promise.resolve(json(undefined, 204));
      }
      if (method === 'GET' && /\/cloud-backups(\?|$)/.test(url)) {
        return Promise.resolve(json(bffSets));
      }
      if (method === 'POST' && /\/cloud-backups$/.test(url)) {
        // server-side stamping: the UI body must NOT carry these
        const created: BackupSet = {
          id: 'set-' + (bffSets.length + 1),
          setKey: body.setKey ?? 'derived',
          version: 1,
          scope: 'DOMAIN',
          domain: 'acme.test', // stamped from the validated issuer
          createdBy: 'google:root', // stamped from the JWT subject
          services: body.services,
          destinationKind: body.destinationKind,
          destinationRef: body.destinationRef,
          sizeBytes: null,
          encryptionMeta: body.encryptionMeta ?? null,
          status: 'pending',
          createdAt: '2026-06-17T01:00:00Z',
          startedAt: null,
          completedAt: null,
        };
        bffSets.push(created);
        return Promise.resolve(json(created));
      }
      const restore = /\/cloud-backups\/([^/]+)\/restore$/.exec(url);
      if (method === 'POST' && restore) {
        const token = headers['X-Backup-StepUp'];
        if (!token) {
          return Promise.resolve(
            json({ error: 'restore requires step-up: present a valid step-up token in the X-Backup-StepUp header' }, 403),
          );
        }
        if (token !== VALID_STEPUP) {
          return Promise.resolve(json({ error: 'invalid step-up' }, 403));
        }
        const id = decodeURIComponent(restore[1]);
        const target = bffSets.find((s) => s.id === id);
        if (!target) return Promise.resolve(json({ error: 'not found' }, 404));
        return Promise.resolve(json({ id, version: target.version, status: 'RESTORE_QUEUED' }));
      }
      const versions = /\/cloud-backups\/([^/]+)\/versions$/.exec(url);
      if (method === 'GET' && versions) {
        const id = decodeURIComponent(versions[1]);
        return Promise.resolve(json(bffSets.filter((s) => s.id === id)));
      }
      if (method === 'GET' && /\/artifacts$/.test(url)) {
        return Promise.resolve(json([]));
      }
      return Promise.resolve(json(undefined));
    });
  }

  function realService(): void {
    TestBed.resetTestingModule().configureTestingModule({
      providers: [
        CloudBackupsService,
        { provide: CLOUD_BACKUPS_BASE_URL, useValue: '' },
        { provide: SessionService, useValue: { isSuperadmin: () => false } }, // an ADMIN
      ],
    });
  }

  function el(fixture: ComponentFixture<unknown>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('snap.session', JSON.stringify({ bffToken: 'tok' }));
    bffSets = [];
    fetchSpy = spyOn(globalThis, 'fetch');
    installFakeBff();
  });
  afterEach(() => localStorage.clear());

  it('SCENARIO: an admin picks services + destination and the backup appears in the catalog (no domain field sent)', async () => {
    realService();
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(CloudBackupCreateComponent);
    const component = fixture.componentInstance;
    // Initialise the view bindings, then drive ngOnInit explicitly + await it so the
    // real (raw-promise) fetch resolves before we render (mirrors the service-catalog e2e's
    // explicit-await approach).
    fixture.detectChanges();
    await component.ngOnInit();
    fixture.detectChanges();

    // GIVEN the running-services menu is loaded from the real bff path
    expect(el(fixture).querySelector('[data-testid="cloud-backup-service-postgres"]')).not.toBeNull();

    // WHEN the admin selects postgres + a destination and creates the backup
    component.toggle(MENU[0]);
    component.destinationRef.set('s3://acme/backups');
    fixture.detectChanges();
    await component.create();
    fixture.detectChanges();

    // THEN the create POST hit the EXACT per-domain path with the bearer …
    const post = fetchSpy.calls.all().find(
      (c) => (c.args[1]?.method ?? 'GET') === 'POST' && /\/cloud-backups$/.test(c.args[0] as string),
    )!;
    expect(post.args[0]).toBe('/bff/admin/cloud-backups');
    const sentBody = JSON.parse(post.args[1]!.body as string);
    // CROSS-DOMAIN: the UI never sent domain / createdBy / scope — the bff stamped them
    expect('domain' in sentBody).toBeFalse();
    expect('createdBy' in sentBody).toBeFalse();
    expect('scope' in sentBody).toBeFalse();
    // AND the backup is now in the bff catalog, DOMAIN-scoped + stamped
    expect(bffSets.length).toBe(1);
    expect(bffSets[0].scope).toBe('DOMAIN');
    expect(bffSets[0].domain).toBe('acme.test');
    // AND the admin sees the success notice
    expect(el(fixture).querySelector('[data-testid="cloud-backup-create-notice"]')!.textContent).toContain('Created backup');
  });

  it('SCENARIO: restore is REFUSED without a step-up, then SUCCEEDS once a valid step-up token is presented', async () => {
    // GIVEN the bff already holds a completed backup
    bffSets = [{
      id: 'set-1', setKey: 'nightly', version: 1, scope: 'DOMAIN', domain: 'acme.test',
      createdBy: 'google:root', services: ['postgres'], destinationKind: 'object_store',
      destinationRef: 's3://x', sizeBytes: 10, encryptionMeta: null, status: 'complete',
      createdAt: '2026-06-17T00:00:00Z', startedAt: null, completedAt: '2026-06-17T00:05:00Z',
    }];
    realService();
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(CloudBackupSetsComponent);
    const component = fixture.componentInstance;
    // Initialise the view bindings, then drive ngOnInit explicitly + await it so the
    // real (raw-promise) list fetch resolves.
    fixture.detectChanges();
    await component.ngOnInit();
    fixture.detectChanges();

    expect(el(fixture).querySelector('[data-testid="cloud-backup-sets-list"]')!.textContent).toContain('nightly');

    // WHEN the admin opens the restore confirm and submits a STALE/empty step-up
    component.askRestore(bffSets[0]);
    component.stepUpToken = 'stale-token';
    fixture.detectChanges();
    await component.confirmRestore();
    fixture.detectChanges();

    // THEN the bff denied it (step-up gate) and the UI prompts for a fresh step-up,
    //      keeping the confirm panel open (restore-needs-step-up)
    expect(component.restoreStepUpNeeded()).toBeTrue();
    expect(el(fixture).querySelector('[data-testid="cloud-backup-restore-confirm"]')).not.toBeNull();
    expect(el(fixture).querySelector('[data-testid="cloud-backup-restore-error"]')!.textContent).toContain('step-up');

    // WHEN the admin presents a VALID step-up token and confirms again
    component.stepUpToken = VALID_STEPUP;
    fixture.detectChanges();
    await component.confirmRestore();
    fixture.detectChanges();

    // THEN the restore POST carried the X-Backup-StepUp header and the bff queued it
    const restoreCall = fetchSpy.calls.all().find(
      (c) => /\/restore$/.test(c.args[0] as string) && (c.args[1]?.headers as any)?.['X-Backup-StepUp'] === VALID_STEPUP,
    )!;
    expect(restoreCall.args[0]).toBe('/bff/admin/cloud-backups/set-1/restore');
    // AND the confirm panel is dismissed and a queued notice is shown
    expect(el(fixture).querySelector('[data-testid="cloud-backup-restore-confirm"]')).toBeNull();
    expect(el(fixture).querySelector('[data-testid="cloud-backup-sets-notice"]')!.textContent).toContain('Restore queued');
  });
});
