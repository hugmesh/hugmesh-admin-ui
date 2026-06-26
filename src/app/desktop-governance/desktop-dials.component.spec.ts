import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DesktopDialsComponent } from './desktop-dials.component';
import { BffService, DeviceSshDial } from '../bff.service';
import { SessionService } from '../session.service';

const dial = (over: Partial<DeviceSshDial> = {}): DeviceSshDial => ({
  deviceId: 'dev-1', dialUser: 'snap-dial', hostKeyFp: 'SHA256:host', dialPubFp: 'SHA256:pub',
  vaultRef: 'vault://dial/dev-1', k8sSecretName: 'dial-dev-1', status: 'PENDING', generation: 1, ...over,
});

describe('DesktopDialsComponent (SUPERADMIN dial management)', () => {
  let fixture: ComponentFixture<DesktopDialsComponent>;
  let component: DesktopDialsComponent;
  let bff: jasmine.SpyObj<BffService>;
  let session: jasmine.SpyObj<SessionService>;

  function setup(opts: { superadmin: boolean; dials: DeviceSshDial[] }) {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'desktopDials', 'desktopDialActivate', 'desktopDialRevoke', 'desktopStepUp',
    ]);
    bff.desktopDials.and.resolveTo(opts.dials);
    bff.desktopStepUp.and.resolveTo({ stepUpToken: 'STEPUP-TOK', ttlMinutes: 5 });

    session = jasmine.createSpyObj<SessionService>('SessionService', ['isSuperadmin']);
    (session as unknown as { session: () => unknown }).session = () => ({ id: 'root@super', roles: [] });
    (session as unknown as { isSuperadmin: () => boolean }).isSuperadmin = () => opts.superadmin;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DesktopDialsComponent],
      providers: [
        { provide: BffService, useValue: bff },
        { provide: SessionService, useValue: session },
      ],
    });
    fixture = TestBed.createComponent(DesktopDialsComponent);
    component = fixture.componentInstance;
  }

  async function init() {
    await component.ngOnInit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  // ── visibility / DENY isolation ──────────────────────────────────────────────
  describe('visibility', () => {
    it('a non-superadmin (defence-in-depth) never fetches the SUPERADMIN dial list', async () => {
      setup({ superadmin: false, dials: [dial()] });
      await init();
      expect(bff.desktopDials).not.toHaveBeenCalled();
      expect(component.dials()).toEqual([]);
    });

    it('SUPERADMIN lists dial rows', async () => {
      setup({ superadmin: true, dials: [dial({ deviceId: 'dev-a' }), dial({ deviceId: 'dev-b', status: 'ACTIVE' })] });
      await init();
      expect(bff.desktopDials).toHaveBeenCalled();
      expect(component.dials().map((d) => d.deviceId)).toEqual(['dev-a', 'dev-b']);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-dial-id="dev-a"]')).not.toBeNull();
      expect(el.querySelector('[data-dial-id="dev-b"]')).not.toBeNull();
    });

    it('an empty list (403/404 swallowed to [] at the BFF, no leak) renders the empty row', async () => {
      setup({ superadmin: true, dials: [] });
      await init();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="dd-empty"]')).not.toBeNull();
    });
  });

  // ── activate (deliberate; 422 unpinned guard) ─────────────────────────────────
  describe('activate', () => {
    it('ALLOW: a PENDING + pinned dial activates — mints a step-up FIRST, then activates with the token', async () => {
      setup({ superadmin: true, dials: [dial({ deviceId: 'dev-1', status: 'PENDING', hostKeyFp: 'SHA256:host' })] });
      await init();
      bff.desktopDialActivate.and.resolveTo(dial({ status: 'ACTIVE', generation: 2 }));
      expect(component.canActivate(dial())).toBeTrue();

      await component.activate(dial());

      expect(bff.desktopStepUp).toHaveBeenCalled();
      expect(bff.desktopDialActivate).toHaveBeenCalledWith('dev-1', 'STEPUP-TOK');
      expect(component.noteFor('dev-1')?.kind).toBe('ok');
    });

    it('DENY: an UNPINNED dial cannot be activated (presentation 422 guard) — NO BFF call, helptext rendered', async () => {
      setup({ superadmin: true, dials: [dial({ deviceId: 'dev-1', status: 'PENDING', hostKeyFp: null })] });
      await init();
      const d = dial({ hostKeyFp: null });
      expect(component.canActivate(d)).toBeFalse();
      expect(component.activateGate(d)).toContain('No host-key pin');

      await component.activate(d);
      expect(bff.desktopStepUp).not.toHaveBeenCalled();
      expect(bff.desktopDialActivate).not.toHaveBeenCalled();

      const el: HTMLElement = fixture.nativeElement;
      const btn = el.querySelector<HTMLButtonElement>('[data-dial-activate="dev-1"]')!;
      expect(btn.disabled).toBeTrue();
      expect(btn.getAttribute('aria-describedby')).toBe('dd-act-help-dev-1');
      expect(el.querySelector('[data-dial-act-help="dev-1"]')).not.toBeNull();
    });

    it('DENY: an ALREADY-ACTIVE dial is not re-activatable', async () => {
      setup({ superadmin: true, dials: [dial({ status: 'ACTIVE' })] });
      await init();
      expect(component.canActivate(dial({ status: 'ACTIVE' }))).toBeFalse();
    });

    it('surfaces a server 422 (unpinned) verbatim when the presentation guard was bypassed', async () => {
      setup({ superadmin: true, dials: [dial({ status: 'PENDING', hostKeyFp: 'SHA256:host' })] });
      await init();
      bff.desktopDialActivate.and.rejectWith(new Error('dial has no host-key pin'));
      await component.activate(dial());
      expect(component.noteFor('dev-1')?.kind).toBe('err');
      expect(component.noteFor('dev-1')?.text).toContain('host-key pin');
    });

    it('a step-up mint failure aborts activation WITHOUT calling activate', async () => {
      setup({ superadmin: true, dials: [dial({ status: 'PENDING', hostKeyFp: 'SHA256:host' })] });
      await init();
      bff.desktopStepUp.and.rejectWith(new Error('no active ssh-license'));
      await component.activate(dial());
      expect(bff.desktopDialActivate).not.toHaveBeenCalled();
      expect(component.noteFor('dev-1')?.text).toContain('Step-up required');
    });
  });

  // ── revoke (CAS; confirm) ─────────────────────────────────────────────────────
  describe('revoke', () => {
    it('revokes (with confirm) — mints a step-up then revokes with the token', async () => {
      setup({ superadmin: true, dials: [dial({ status: 'ACTIVE' })] });
      await init();
      spyOn(window, 'confirm').and.returnValue(true);
      bff.desktopDialRevoke.and.resolveTo(dial({ status: 'REVOKED', generation: 3 }));
      await component.revoke(dial({ status: 'ACTIVE' }));
      expect(bff.desktopStepUp).toHaveBeenCalled();
      expect(bff.desktopDialRevoke).toHaveBeenCalledWith('dev-1', 'STEPUP-TOK');
    });

    it('cancelling the confirm does NOT revoke', async () => {
      setup({ superadmin: true, dials: [dial({ status: 'ACTIVE' })] });
      await init();
      spyOn(window, 'confirm').and.returnValue(false);
      await component.revoke(dial({ status: 'ACTIVE' }));
      expect(bff.desktopDialRevoke).not.toHaveBeenCalled();
    });

    it('a REVOKED dial is not re-revocable', async () => {
      setup({ superadmin: true, dials: [dial({ status: 'REVOKED' })] });
      await init();
      expect(component.canRevoke(dial({ status: 'REVOKED' }))).toBeFalse();
    });
  });

  // ── accessibility ─────────────────────────────────────────────────────────
  describe('accessibility', () => {
    it('labels the view + gives activate/revoke device-specific accessible names', async () => {
      setup({ superadmin: true, dials: [dial({ deviceId: 'dev-1' })] });
      await init();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="desktop-dials-view"]')!.getAttribute('aria-labelledby')).toBe('dd-heading');
      expect(el.querySelector('[data-dial-activate="dev-1"]')!.getAttribute('aria-label')).toContain('dev-1');
      expect(el.querySelector('[data-dial-revoke="dev-1"]')!.getAttribute('aria-label')).toContain('dev-1');
    });

    it('never renders the dial private key (only non-secret fingerprints/refs)', async () => {
      setup({ superadmin: true, dials: [dial()] });
      await init();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('PRIVATE KEY');
      expect(text).toContain('SHA256:host');
    });
  });
});
