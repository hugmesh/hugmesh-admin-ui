import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MeshTokensComponent } from './mesh-tokens.component';
import {
  BffService,
  MeshTokenIssueResult,
  MeshTokenIssued,
  MeshTokenIssuer,
  MeshTokenIssuerState,
} from './bff.service';
import { SessionService } from './session.service';
import { BffHttpError } from './mfa/step-up-error';

/** A token-shaped value; the assertions below hunt for this prefix everywhere it must not be. */
const TOKEN = 'hugmesh-token-v1.eyJhdXRoX2tleSI6ImZha2UifQ.LS0tLS1CRUdJTiBTU0ggU0lHTkFUVVJFLS0tLS0K';
const FP = 'SHA256:3m0lQ5jZ1o0pL9Xh2pN3oVq4RjK8T2t9Gm7u6YbWcXk';

const issuer = (over: Partial<MeshTokenIssuer> = {}): MeshTokenIssuer => ({
  enabled: true,
  publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleExampleExampleExampleExampleExample',
  fingerprint: FP,
  mesh: 'hugmesh-local',
  domains: [
    { domain: 'hugmesh.net', loginServer: 'https://hs.hugmesh.net:8488' },
    { domain: 'example.org', loginServer: 'https://hs.example.org' },
  ],
  maxLifetimeSeconds: 90 * 86400,
  ...over,
});

const issued = (over: Partial<MeshTokenIssueResult> = {}): MeshTokenIssueResult => ({
  token: TOKEN,
  id: '0123456789abcdef',
  expires: 1_800_000_000,
  fingerprint: FP,
  describe: 'join mesh hugmesh-local in hugmesh.net as admin, with shell',
  ...over,
});

const auditRow = (): MeshTokenIssued => ({
  id: '0123456789abcdef',
  mesh: 'hugmesh-local',
  domain: 'hugmesh.net',
  role: 'admin',
  shell: true,
  loginServer: 'https://hs.hugmesh.net:8488',
  issuerFingerprint: FP,
  preauthKeyId: '7',
  nodeName: 'laptop-ana',
  issuedBy: 'ana@example.org',
  issuedAt: '2026-11-04T20:00:00Z',
  expiresAt: '2026-11-11T20:00:00Z',
});

describe('MeshTokensComponent', () => {
  let fixture: ComponentFixture<MeshTokensComponent>;
  let component: MeshTokensComponent;
  let bff: jasmine.SpyObj<BffService>;
  let superadmin: boolean;

  async function render(state: MeshTokenIssuerState = { kind: 'ok', issuer: issuer() }): Promise<HTMLElement> {
    bff.meshTokenIssuer.and.resolveTo(state);
    fixture = TestBed.createComponent(MeshTokensComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.ngOnInit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  beforeEach(async () => {
    superadmin = false;
    bff = jasmine.createSpyObj<BffService>('BffService', ['meshTokenIssuer', 'issueMeshToken', 'meshTokensIssued']);
    bff.meshTokensIssued.and.resolveTo([]);
    await TestBed.configureTestingModule({
      imports: [MeshTokensComponent],
      providers: [
        provideRouter([]),
        { provide: BffService, useValue: bff },
        { provide: SessionService, useValue: { isSuperadmin: () => superadmin, isAdmin: () => true } },
      ],
    }).compileComponents();
  });

  // ── issuer fingerprint ──
  it('leads with the issuer fingerprint and tells the admin to hand it over out of band', async () => {
    const el = await render();
    expect(q(el, 'mt-fingerprint')!.textContent!.trim()).toBe(FP);
    expect(q(el, 'mt-fingerprint-help')!.textContent).toMatch(/out of band/i);
    expect(q(el, 'mt-mesh')!.textContent!.trim()).toBe('hugmesh-local');
  });

  it('copies the fingerprint to the clipboard and confirms inline', async () => {
    const el = await render();
    const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    q(el, 'mt-copy-fingerprint')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(write).toHaveBeenCalledWith(FP);
    expect(q(el, 'mt-copy-fingerprint-note')!.textContent).toContain('Copied');
  });

  // ── ships dark ──
  it('renders the BFF dark sentence and no form while the feature is off', async () => {
    const el = await render({ kind: 'dark', reason: 'mesh tokens are disabled: start the local stack with HEADSCALE=1' });
    expect(q(el, 'mt-dark')!.textContent).toContain('HEADSCALE=1');
    expect(q(el, 'mt-form')).toBeNull();
    expect(q(el, 'mt-fingerprint')).toBeNull();
    expect(bff.meshTokensIssued).not.toHaveBeenCalled();
  });

  it('falls back to a sentence naming HEADSCALE=1 when the dark 503 carried none', async () => {
    const el = await render({ kind: 'dark', reason: '' });
    expect(q(el, 'mt-dark')!.textContent).toContain('make stack-up HEADSCALE=1');
  });

  it('shows a denied/failed issuer read as an inline alert, not a form', async () => {
    const el = await render({ kind: 'error', status: 403, reason: 'Forbidden' });
    expect(q(el, 'mt-error')!.getAttribute('role')).toBe('alert');
    expect(q(el, 'mt-form')).toBeNull();
  });

  // ── role gating ──
  it('offers user/mod/admin to an admin and never superadmin', async () => {
    const el = await render();
    const opts = Array.from(el.querySelectorAll('[data-testid="mt-role"] option')).map((o) => (o as HTMLOptionElement).value);
    expect(opts).toEqual(['user', 'mod', 'admin']);
  });

  it('offers superadmin only to a superadmin', async () => {
    superadmin = true;
    const el = await render();
    const opts = Array.from(el.querySelectorAll('[data-testid="mt-role"] option')).map((o) => (o as HTMLOptionElement).value);
    expect(opts).toEqual(['user', 'mod', 'admin', 'superadmin']);
  });

  it('refuses a superadmin role forced into the model by a non-superadmin, without calling the BFF', async () => {
    const el = await render();
    component.role = 'superadmin';
    await component.issue();
    fixture.detectChanges();
    expect(bff.issueMeshToken).not.toHaveBeenCalled();
    expect(q(el, 'mt-form-error')!.textContent).toMatch(/role/i);
  });

  // ── shell gating ──
  it('disables the shell checkbox for user and mod, enables it for admin, and clears it when the role drops (driven through the DOM)', async () => {
    const el = await render();
    const shell = () => q(el, 'mt-shell') as HTMLInputElement;
    const pickRole = async (r: string) => {
      const sel = q(el, 'mt-role') as HTMLSelectElement;
      sel.value = r;
      sel.dispatchEvent(new Event('change'));
      fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    };
    expect(shell().disabled).toBeTrue();
    await pickRole('mod');
    expect(component.role).toBe('mod');
    expect(shell().disabled).toBeTrue();
    await pickRole('admin');
    expect(shell().disabled).toBeFalse();
    shell().click();
    fixture.detectChanges();
    expect(component.shell).toBeTrue();
    expect(shell().checked).toBeTrue();
    await pickRole('user');
    expect(component.shell).toBeFalse();
    expect(shell().checked).toBeFalse();
    expect(shell().disabled).toBeTrue();
  });

  it('never sends shell=true for a role that cannot carry it, even if the model was forced', async () => {
    await render();
    bff.issueMeshToken.and.resolveTo(issued());
    component.role = 'mod';
    component.shell = true;
    await component.issue();
    expect(bff.issueMeshToken.calls.mostRecent().args[0].shell).toBeFalse();
  });

  it('sends exactly domain/role/shell/lifetimeSeconds/nodeName — no tags field', async () => {
    await render();
    bff.issueMeshToken.and.resolveTo(issued());
    component.domain = 'example.org';
    component.onRoleChange('admin');
    component.shell = true;
    component.lifetimeDays = 7;
    component.nodeName = 'laptop-ana';
    await component.issue();
    expect(bff.issueMeshToken).toHaveBeenCalledOnceWith(
      { domain: 'example.org', role: 'admin', shell: true, lifetimeSeconds: 7 * 86400, nodeName: 'laptop-ana' });
  });

  // ── lifetime / node name ──
  it('defaults the lifetime to 7 days and refuses 0 or more than 90', async () => {
    const el = await render();
    expect(component.lifetimeDays).toBe(7);
    expect(component.maxDays()).toBe(90);
    for (const bad of [0, 91, 2.5]) {
      component.lifetimeDays = bad;
      await component.issue();
    }
    fixture.detectChanges();
    expect(bff.issueMeshToken).not.toHaveBeenCalled();
    expect(q(el, 'mt-form-error')!.textContent).toMatch(/1 to 90/);
  });

  it('never lets the lifetime exceed 90 days, even if the issuer advertises more', async () => {
    await render({ kind: 'ok', issuer: issuer({ maxLifetimeSeconds: 365 * 86400 }) });
    expect(component.maxDays()).toBe(90);
    component.lifetimeDays = 91;
    await component.issue();
    expect(bff.issueMeshToken).not.toHaveBeenCalled();
  });

  it('starts the lifetime at the BFF defaultLifetimeSeconds when given', async () => {
    await render({ kind: 'ok', issuer: issuer({ defaultLifetimeSeconds: 3 * 86400 }) });
    expect(component.lifetimeDays).toBe(3);
  });

  it('prefers the BFF roles list over the session mirror (a stale mirror cannot add or hide superadmin)', async () => {
    superadmin = true;
    const el = await render({ kind: 'ok', issuer: issuer({ roles: ['user', 'mod', 'admin'] }) });
    let opts = Array.from(el.querySelectorAll('[data-testid="mt-role"] option')).map((o) => (o as HTMLOptionElement).value);
    expect(opts).toEqual(['user', 'mod', 'admin']);
    fixture.destroy();
    superadmin = false;
    const el2 = await render({ kind: 'ok', issuer: issuer({ roles: ['user', 'mod', 'admin', 'superadmin'] }) });
    opts = Array.from(el2.querySelectorAll('[data-testid="mt-role"] option')).map((o) => (o as HTMLOptionElement).value);
    expect(opts).toEqual(['user', 'mod', 'admin', 'superadmin']);
  });

  it('maps a 200 {enabled:false, note} issuer to the dark sentence', async () => {
    // (service-level mapping is pinned below; this pins the page side of a dark state)
    const el = await render({ kind: 'dark', reason: 'Mesh token issuing is off on this mesh' });
    expect(q(el, 'mt-dark')!.textContent).toContain('off on this mesh');
  });

  it('caps the lifetime at the issuer maxLifetimeSeconds when it is under 90 days', async () => {
    await render({ kind: 'ok', issuer: issuer({ maxLifetimeSeconds: 30 * 86400 }) });
    expect(component.maxDays()).toBe(30);
  });

  it('refuses a node name that is not a DNS label', async () => {
    await render();
    component.nodeName = 'Bad_Name';
    await component.issue();
    expect(bff.issueMeshToken).not.toHaveBeenCalled();
  });

  // ── single reveal ──
  it('reveals the token once with its grant description, and copies it', async () => {
    const el = await render();
    bff.issueMeshToken.and.resolveTo(issued());
    await component.issue();
    fixture.detectChanges();
    expect(q(el, 'mt-token')!.textContent!.trim()).toBe(TOKEN);
    expect(q(el, 'mt-describe')!.textContent).toContain('as admin');
    const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    q(el, 'mt-copy-token')!.click();
    await fixture.whenStable();
    expect(write).toHaveBeenCalledWith(TOKEN);
  });

  it('hides the token for good on "I have copied it" — it cannot be shown again', async () => {
    const el = await render();
    bff.issueMeshToken.and.resolveTo(issued());
    await component.issue();
    fixture.detectChanges();
    q(el, 'mt-hide-token')!.click();
    fixture.detectChanges();
    expect(q(el, 'mt-token-box')).toBeNull();
    expect(component.revealed()).toBeNull();
    expect(el.textContent).not.toContain('hugmesh-token-v1.');
  });

  it('drops the token when the page is destroyed (navigation)', async () => {
    await render();
    bff.issueMeshToken.and.resolveTo(issued());
    await component.issue();
    expect(component.revealed()).not.toBeNull();
    fixture.destroy();
    expect(component.revealed()).toBeNull();
  });

  it('hides the previous token while a new issue is in flight and on its failure', async () => {
    const el = await render();
    bff.issueMeshToken.and.resolveTo(issued());
    await component.issue();
    bff.issueMeshToken.and.rejectWith(new BffHttpError('own-domain wall: not your domain', 403, null));
    await component.issue();
    fixture.detectChanges();
    expect(q(el, 'mt-token-box')).toBeNull();
    expect(q(el, 'mt-note')!.textContent).toContain('not your domain');
    expect(q(el, 'mt-note')!.getAttribute('role')).toBe('alert');
  });

  // ── the token never reaches storage or the URL ──
  it('never writes the token to localStorage, sessionStorage, the URL or history state', async () => {
    const setLocal = spyOn(Storage.prototype, 'setItem').and.callThrough();
    const pushState = spyOn(history, 'pushState').and.callThrough();
    const replaceState = spyOn(history, 'replaceState').and.callThrough();
    await render();
    bff.issueMeshToken.and.resolveTo(issued());
    await component.issue();
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    for (const call of setLocal.calls.allArgs()) expect(JSON.stringify(call)).not.toContain('hugmesh-token-v1.');
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        expect(store.getItem(store.key(i)!) ?? '').not.toContain('hugmesh-token-v1.');
      }
    }
    expect(router.url).not.toContain('hugmesh-token-v1.');
    expect(location.href).not.toContain('hugmesh-token-v1.');
    for (const call of [...pushState.calls.allArgs(), ...replaceState.calls.allArgs()]) {
      expect(JSON.stringify(call)).not.toContain('hugmesh-token-v1.');
    }
    expect(JSON.stringify(history.state ?? null)).not.toContain('hugmesh-token-v1.');
  });

  it('never logs the token to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => spyOn(console, m).and.callThrough());
    await render();
    bff.issueMeshToken.and.resolveTo(issued());
    await component.issue();
    fixture.detectChanges();
    expect(component.revealed()?.token).toBe(TOKEN);
    for (const s of spies) for (const call of s.calls.allArgs()) expect(JSON.stringify(call)).not.toContain('hugmesh-token-v1.');
  });

  it('renders the token outside any form control (no browser form-state restore)', async () => {
    const el = await render();
    bff.issueMeshToken.and.resolveTo(issued());
    await component.issue();
    fixture.detectChanges();
    for (const c of Array.from(el.querySelectorAll('input, textarea, select'))) {
      expect((c as HTMLInputElement).value ?? '').not.toContain('hugmesh-token-v1.');
    }
  });

  // ── step-up ──
  it('opens the inline step-up section on a step-up 403 and retries the SAME issue on success', async () => {
    const el = await render();
    bff.issueMeshToken.and.returnValues(
      Promise.reject(new BffHttpError('mesh token issue requires step-up re-authentication', 403, 'X-MeshToken-StepUp')),
      Promise.resolve(issued()),
    );
    await component.issue();
    fixture.detectChanges();
    expect(q(el, 'mfa-stepup-dialog')).not.toBeNull();
    expect(q(el, 'mt-token-box')).toBeNull();
    await component.onStepUpSatisfied();
    fixture.detectChanges();
    expect(bff.issueMeshToken).toHaveBeenCalledTimes(2);
    expect(bff.issueMeshToken.calls.argsFor(1)).toEqual(bff.issueMeshToken.calls.argsFor(0));
    expect(q(el, 'mt-token')!.textContent!.trim()).toBe(TOKEN);
  });

  it('drops the retry when the step-up is dismissed', async () => {
    const el = await render();
    bff.issueMeshToken.and.rejectWith(new BffHttpError('requires step-up', 403, 'X-MeshToken-StepUp'));
    await component.issue();
    component.onStepUpDismissed();
    fixture.detectChanges();
    expect(q(el, 'mfa-stepup-dialog')).toBeNull();
    expect(bff.issueMeshToken).toHaveBeenCalledTimes(1);
  });

  it('uses no native dialog (alert/confirm/prompt) anywhere in the issue flow', async () => {
    const a = spyOn(window, 'alert'); const c = spyOn(window, 'confirm'); const p = spyOn(window, 'prompt');
    const el = await render();
    bff.issueMeshToken.and.resolveTo(issued());
    await component.issue();
    q(el, 'mt-hide-token')?.click();
    expect(a).not.toHaveBeenCalled(); expect(c).not.toHaveBeenCalled(); expect(p).not.toHaveBeenCalled();
  });

  // ── audit ──
  it('shows the audit table without any token column, even if a row smuggled one in', async () => {
    bff.meshTokensIssued.and.resolveTo([{ ...auditRow(), token: TOKEN, authKey: 'deadbeef' } as unknown as MeshTokenIssued]);
    const el = await render();
    const table = q(el, 'mt-audit')!;
    const headers = Array.from(table.querySelectorAll('th')).map((th) => th.textContent!.trim().toLowerCase());
    expect(headers).not.toContain('token');
    expect(headers.some((h) => /token|key/.test(h))).toBeFalse();
    expect(table.textContent).not.toContain('hugmesh-token-v1.');
    expect(table.textContent).not.toContain('deadbeef');
    expect(table.querySelector('tr[data-token-id="0123456789abcdef"]')).not.toBeNull();
  });

  it('refreshes the audit after a successful issue', async () => {
    await render();
    bff.issueMeshToken.and.resolveTo(issued());
    bff.meshTokensIssued.calls.reset();
    await component.issue();
    expect(bff.meshTokensIssued).toHaveBeenCalledTimes(1);
  });
});

describe('BffService mesh-token calls', () => {
  let service: BffService;
  let fetchSpy: jasmine.Spy;

  const res = (body: unknown, status = 200, headers: Record<string, string> = {}): Response => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    json: async () => body,
  } as unknown as Response);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [BffService, { provide: SessionService, useValue: { session: () => null } }],
    });
    service = TestBed.inject(BffService);
    fetchSpy = spyOn(globalThis, 'fetch');
  });

  it('maps a 200 issuer to ok', async () => {
    fetchSpy.and.resolveTo(res(issuer()));
    const s = await service.meshTokenIssuer();
    expect(s.kind).toBe('ok');
    expect(fetchSpy.calls.mostRecent().args[0]).toMatch(/\/bff\/admin\/mesh-tokens\/issuer$/);
  });

  it('maps the POST-style dark 503 {dark, note} to dark, carrying the note', async () => {
    fetchSpy.and.resolveTo(res({ dark: true, note: 'Mesh token issuing is off on this mesh' }, 503));
    expect(await service.meshTokenIssuer()).toEqual({ kind: 'dark', reason: 'Mesh token issuing is off on this mesh' });
  });

  it('maps the dark 503 descriptor to dark, carrying the server sentence', async () => {
    fetchSpy.and.resolveTo(res({ error: 'mesh tokens are off: make stack-up HEADSCALE=1' }, 503));
    expect(await service.meshTokenIssuer()).toEqual({ kind: 'dark', reason: 'mesh tokens are off: make stack-up HEADSCALE=1' });
  });

  it('maps a body-less 503 to dark with an empty reason (the page supplies its fallback)', async () => {
    fetchSpy.and.resolveTo(res({}, 503));
    expect(await service.meshTokenIssuer()).toEqual({ kind: 'dark', reason: '' });
  });

  it('maps a 200 enabled:false to dark', async () => {
    fetchSpy.and.resolveTo(res({ ...issuer(), enabled: false, note: 'Mesh token issuing is off on this mesh' }));
    expect(await service.meshTokenIssuer()).toEqual({ kind: 'dark', reason: 'Mesh token issuing is off on this mesh' });
  });

  it('maps a 403 to error, never throwing', async () => {
    fetchSpy.and.resolveTo(res({ error: 'Forbidden' }, 403));
    expect(await service.meshTokenIssuer()).toEqual({ kind: 'error', status: 403, reason: 'Forbidden' });
  });

  it('POSTs the issue body as JSON, uncached, with the step-up header only when given', async () => {
    fetchSpy.and.resolveTo(res(issued()));
    const body = { domain: 'hugmesh.net', role: 'user' as const, shell: false, lifetimeSeconds: 604800, nodeName: '' };
    await service.issueMeshToken(body);
    let [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toMatch(/\/bff\/admin\/mesh-tokens$/);
    expect(url).not.toContain('hugmesh-token-v1.');
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect((init.headers as Record<string, string>)['X-MeshToken-StepUp']).toBeUndefined();
    await service.issueMeshToken(body, 'su-123');
    [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-MeshToken-StepUp']).toBe('su-123');
  });

  it('throws a BffHttpError carrying the step-up signal on a step-up 403', async () => {
    fetchSpy.and.resolveTo(res({ error: 'requires step-up' }, 403, { 'X-Step-Up-Required': 'X-MeshToken-StepUp' }));
    await expectAsync(service.issueMeshToken({ domain: 'a.b', role: 'user', shell: false, lifetimeSeconds: 86400, nodeName: '' }))
      .toBeRejectedWith(jasmine.objectContaining({ status: 403, stepUpSignal: 'X-MeshToken-StepUp' }));
  });

  it('reads the audit as an array or {issued:[]}, and degrades to [] on a deny', async () => {
    fetchSpy.and.resolveTo(res([auditRow()]));
    expect((await service.meshTokensIssued()).length).toBe(1);
    fetchSpy.and.resolveTo(res({ enabled: true, issued: [auditRow()] }));
    expect((await service.meshTokensIssued()).length).toBe(1);
    fetchSpy.and.resolveTo(res({ error: 'Forbidden' }, 403));
    expect(await service.meshTokensIssued()).toEqual([]);
  });
});
