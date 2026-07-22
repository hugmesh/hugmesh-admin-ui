import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BackingServicesComponent } from './backing-services.component';
import {
  BACKING_SERVICES_BASE_URL,
  BackingServiceMode,
  BackingServicesService,
} from './backing-services.service';

/**
 * Gherkin-readable END-TO-END for the managed backing-services headline flow:
 *
 *   FEATURE: A superadmin points a mesh backing service at a managed cloud endpoint (which the
 *            platform requires a step-up to record), while tier-3 services stay read-only.
 *
 * These drive the REAL component through the REAL BackingServicesService, with ONLY `fetch`
 * stubbed at the network edge — so view → service → exact bff path/body/header is exercised
 * against the snapdragon-admin-bff-api `backingservices` contract, not a mocked service.
 *
 * A backing in-memory "bff" holds the recorded modes and enforces the step-up gate exactly like
 * the bff's BackingServiceStepUpGate: a mode change is refused (403 naming step-up) unless the
 * PUT carries a valid X-BackingServices-StepUp header; a tier-3 (docs-only) id is a 409.
 */
describe('FEATURE: Superadmin backing-service managed mode + step-up (e2e)', () => {
  let fetchSpy: jasmine.Spy;
  /** The in-memory recorded state per service id (mode/endpoint/credsRef/generation). */
  let state: Record<string, { mode: BackingServiceMode; endpoint: string | null; credsRef: string | null; generation: number }>;
  let gen: number;

  function json(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
    } as unknown as Response;
  }

  /** The closed catalog the fake bff serves, JOINED with the current recorded state. */
  function catalogBody() {
    const row = (id: string, kind: string, tier: number, docsOnly: boolean, aws: string, az: string) => {
      const s = state[id];
      return {
        id, kind, tier, docsOnly, displayName: id, awsTarget: aws, azureTarget: az, notes: 'note',
        currentMode: (s?.mode ?? 'self-hosted') as BackingServiceMode,
        endpoint: s?.endpoint ?? null, credsRef: s?.credsRef ?? null, generation: s?.generation ?? 0,
      };
    };
    return {
      enabled: true,
      note: 'intent recorded only — self-hosted is the byte-identical default',
      services: [
        row('postgres-admin-bff', 'postgres', 2, false, 'RDS', 'Azure DB'),
        row('vault-pki', 'pki', 3, true, 'ACM Private CA', 'Key Vault certs'),
      ],
    };
  }

  function installFakeBff(): void {
    fetchSpy.and.callFake((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = init?.body ? JSON.parse(init.body as string) : undefined;

      if (method === 'GET' && /\/backing-services$/.test(url)) {
        return Promise.resolve(json(catalogBody()));
      }
      const put = /\/backing-services\/([^/]+)\/mode$/.exec(url);
      if (method === 'PUT' && put) {
        const id = decodeURIComponent(put[1]);
        if (id === 'vault-pki') {
          return Promise.resolve(json({ error: "backing service 'vault-pki' is DOCS-ONLY in v1" }, 409));
        }
        // step-up gate: refuse without the header (naming step-up), exactly like the bff.
        if (!headers['X-BackingServices-StepUp']) {
          return Promise.resolve(json({
            error: 'changing a backing-service mode requires step-up re-authentication (present X-BackingServices-StepUp)',
          }, 403));
        }
        gen += 1;
        state[id] = { mode: body.mode, endpoint: body.endpoint ?? null, credsRef: body.credsRef ?? null, generation: gen };
        return Promise.resolve(json({
          id: 'bsm-' + gen, serviceId: id, mode: body.mode, endpoint: body.endpoint ?? null,
          credsRef: body.credsRef ?? null, requestedBySubject: 'root', createdAt: 'T', generation: gen,
          note: 'intent only',
        }));
      }
      return Promise.resolve(json(undefined));
    });
  }

  function realService(): void {
    TestBed.resetTestingModule().configureTestingModule({
      imports: [BackingServicesComponent],
      providers: [
        BackingServicesService,
        { provide: BACKING_SERVICES_BASE_URL, useValue: '' },
      ],
    });
  }

  function el(fixture: ComponentFixture<unknown>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    state = {};
    gen = 0;
    fetchSpy = spyOn(globalThis, 'fetch');
    installFakeBff();
  });

  it('SCENARIO: tier-3 is read-only, and a tier-1/2 managed change is refused then recorded with a step-up token', async () => {
    realService();
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(BackingServicesComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    await component.ngOnInit();
    fixture.detectChanges();

    // GIVEN the catalog loaded from the real bff path: tier-3 vault-pki is READ-ONLY …
    expect(el(fixture).querySelector('[data-testid="backing-services-docsonly-vault-pki"]')).not.toBeNull();
    expect(el(fixture).querySelector('[data-testid="backing-services-edit-vault-pki"]')).toBeNull();
    // … and postgres-admin-bff starts self-hosted (the byte-identical default).
    expect(el(fixture).querySelector('[data-testid="backing-services-mode-postgres-admin-bff"]')!.textContent)
      .toContain('self-hosted');

    // WHEN the superadmin edits postgres-admin-bff to managed and records WITHOUT a step-up token
    component.startEdit(component.services()[0]);
    component.mode.set('managed');
    component.endpoint.set('db.rds.amazonaws.com:5432');
    fixture.detectChanges();
    await component.save();
    fixture.detectChanges();

    // THEN the bff refused it (step-up gate) and the UI revealed the step-up token field,
    //      keeping the form open — no state changed.
    expect(component.stepUpRequired()).toBeTrue();
    expect(el(fixture).querySelector('[data-testid="backing-services-stepup"]')).not.toBeNull();
    expect(el(fixture).querySelector('[data-testid="backing-services-form"]')).not.toBeNull();
    expect(state['postgres-admin-bff']).toBeUndefined();

    // WHEN the superadmin supplies a step-up token and retries
    component.stepUpToken.set('valid-stepup-token');
    await component.save();
    fixture.detectChanges();

    // THEN the mode change hit the EXACT path carrying the X-BackingServices-StepUp header …
    const putCall = fetchSpy.calls.all().find(
      (c) => (c.args[1]?.method ?? 'GET') === 'PUT'
        && /\/backing-services\/postgres-admin-bff\/mode$/.test(c.args[0] as string)
        && (c.args[1]?.headers as Record<string, string>)?.['X-BackingServices-StepUp'] === 'valid-stepup-token',
    )!;
    expect(putCall).toBeTruthy();
    expect(putCall.args[0]).toBe('/bff/superadmin/backing-services/postgres-admin-bff/mode');
    const sentBody = JSON.parse(putCall.args[1]!.body as string);
    expect(sentBody.mode).toBe('managed');
    expect(sentBody.endpoint).toBe('db.rds.amazonaws.com:5432');

    // AND the bff recorded it; the reloaded table now shows managed + the endpoint.
    expect(state['postgres-admin-bff'].mode).toBe('managed');
    expect(component.editing()).toBeNull();
    expect(el(fixture).querySelector('[data-testid="backing-services-mode-postgres-admin-bff"]')!.textContent)
      .toContain('managed');
    expect(el(fixture).querySelector('[data-testid="backing-services-notice"]')!.textContent).toContain('managed');
  });
});
