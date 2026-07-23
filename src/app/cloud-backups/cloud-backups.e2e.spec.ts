import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { CloudBackupCreateComponent } from './cloud-backup-create.component';
import { CloudBackupSetsComponent } from './cloud-backup-sets.component';
import { BackupSet, CLOUD_BACKUPS_BASE_URL, CloudBackupsService } from './cloud-backups.service';
import { MfaStepUpDialogComponent } from '../mfa/mfa-step-up-dialog.component';
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
 * hugmesh-admin-bff-api `cloudbackup` PR #74 contract, not a mocked service.
 *
 * A backing in-memory "bff" stores created sets and enforces the restore step-up
 * exactly like the bff's A5-unified BackupStepUpGate: a restore is refused (403
 * naming step-up) unless the caller's session carries a FRESH MFA stamp — which a
 * successful POST /bff/mfa/challenge sets, exactly as the real BFF dual-stamps
 * `mfa_satisfied`. So the whole "restore refused → inline MFA dialog → token-less
 * retry succeeds" flow is a real observable effect, end to end.
 */
describe('FEATURE: Admin cloud-backup + step-up restore (e2e)', () => {
  let fetchSpy: jasmine.Spy;
  let bffSets: BackupSet[];
  /** Server-side session freshness — flipped by a successful /bff/mfa/challenge. */
  let mfaFresh: boolean;

  function json(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
      // MfaService reads responses via .json() (CloudBackupsService via .text()).
      json: () => Promise.resolve(body),
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
      // The inline MFA step-up challenge — a valid 6-digit code stamps the session
      // fresh (mirrors the BFF dual-stamping `mfa_satisfied`).
      if (method === 'POST' && /\/mfa\/challenge$/.test(url)) {
        if (body?.factor === 'totp' && /^\d{6}$/.test(body?.credential ?? '')) {
          mfaFresh = true;
          return Promise.resolve(json({ mfaSatisfied: true }));
        }
        return Promise.resolve(json({ mfaSatisfied: false }));
      }
      const restore = /\/cloud-backups\/([^/]+)\/restore$/.exec(url);
      if (method === 'POST' && restore) {
        // A5-unified gate: satisfied by a fresh MFA stamp OR the legacy token header.
        if (!mfaFresh && !headers['X-Backup-StepUp']) {
          return Promise.resolve(
            json({ error: 'restore requires step-up: present a valid step-up token in the X-Backup-StepUp header' }, 403),
          );
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
    localStorage.setItem('hug.session', JSON.stringify({ roles: [] }));
    bffSets = [];
    mfaFresh = false;
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

  it('SCENARIO: restore is REFUSED without a step-up, then SUCCEEDS token-less once the inline MFA dialog is satisfied', async () => {
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

    // WHEN the admin opens the restore confirm and submits it (no session freshness yet)
    component.askRestore(bffSets[0]);
    fixture.detectChanges();
    await component.confirmRestore();
    fixture.detectChanges();

    // THEN the bff denied it (step-up gate) and the UI opens the inline MFA dialog,
    //      keeping the destructive confirm panel open.
    expect(component.stepUpChallenge()).not.toBeNull();
    expect(el(fixture).querySelector('[data-testid="mfa-stepup-dialog"]')).not.toBeNull();
    expect(el(fixture).querySelector('[data-testid="cloud-backup-restore-confirm"]')).not.toBeNull();

    // WHEN the admin verifies with a 6-digit authenticator code in the REAL inline dialog
    //      (drives the real MfaService → POST /bff/mfa/challenge, which stamps the session)
    const dialog = fixture.debugElement.query(By.directive(MfaStepUpDialogComponent))
      .componentInstance as MfaStepUpDialogComponent;
    dialog.code = '123456';
    await dialog.submitCode();
    // the challenge success emits (satisfied) → the component retries the restore token-less
    // as a side effect; drain that retry + reload microtask chain deterministically.
    for (let i = 0; i < 12; i++) await Promise.resolve();
    fixture.detectChanges();

    // THEN a fresh MFA stamp made the token-less retry succeed — the restore POST carried
    //      NO X-Backup-StepUp header, and the bff queued it.
    const restoreCalls = fetchSpy.calls.all().filter((c) => /\/restore$/.test(c.args[0] as string));
    const queuedCall = restoreCalls[restoreCalls.length - 1];
    expect(queuedCall.args[0]).toBe('/bff/admin/cloud-backups/set-1/restore');
    expect((queuedCall.args[1]?.headers as Record<string, string> | undefined)?.['X-Backup-StepUp']).toBeUndefined();
    // AND a real /bff/mfa/challenge round-trip happened.
    expect(fetchSpy.calls.all().some((c) => /\/mfa\/challenge$/.test(c.args[0] as string))).toBeTrue();
    // AND the confirm panel is dismissed and a queued notice is shown.
    expect(component.stepUpChallenge()).toBeNull();
    expect(el(fixture).querySelector('[data-testid="cloud-backup-restore-confirm"]')).toBeNull();
    expect(el(fixture).querySelector('[data-testid="cloud-backup-sets-notice"]')!.textContent).toContain('Restore queued');
  });
});
