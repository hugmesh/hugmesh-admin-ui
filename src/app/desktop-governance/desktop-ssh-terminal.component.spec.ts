import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DesktopSshTerminalComponent } from './desktop-ssh-terminal.component';
import { BffService, DeviceRegistration, DesktopSshSession } from '../bff.service';
import { SessionService } from '../session.service';

function device(over: Partial<DeviceRegistration> = {}, licensedOperator?: string): DeviceRegistration {
  const id = over.id ?? 'dev-1';
  return {
    id, machine_key_fp: 'mkey:' + id, hostname: 'pi-' + id, tailnet_id: null,
    image_type: 'primary', owner_type: 'ADMIN', physical_owner: 'admin@brand-a', domain: 'brand-a',
    mesh_id: null, last_seen_at: null,
    licenses: licensedOperator
      ? [{
          id: 'lic-' + id, operator: licensedOperator, scope_type: 'DEVICE', device_id: id,
          target_domain: null, key_fingerprints: ['SHA256:x'], state: 'active', granted_by: 'root', granted_at: null,
        }]
      : [],
    ...over,
  };
}

describe('DesktopSshTerminalComponent (in-UI SSH, ships dark)', () => {
  let fixture: ComponentFixture<DesktopSshTerminalComponent>;
  let component: DesktopSshTerminalComponent;
  let bff: jasmine.SpyObj<BffService>;
  let session: jasmine.SpyObj<SessionService>;

  function setup(opts: { me: string; devices: DeviceRegistration[] }) {
    bff = jasmine.createSpyObj<BffService>('BffService', ['devices', 'desktopOpenSshSession', 'desktopStepUp']);
    bff.devices.and.resolveTo(opts.devices);
    bff.desktopStepUp.and.resolveTo({ stepUpToken: 'STEPUP-TOK', ttlMinutes: 5 });

    session = jasmine.createSpyObj<SessionService>('SessionService', ['isSuperadmin']);
    (session as unknown as { session: () => unknown }).session = () => ({ id: opts.me, roles: [] });
    (session as unknown as { isSuperadmin: () => boolean }).isSuperadmin = () => false;

    TestBed.configureTestingModule({
      imports: [DesktopSshTerminalComponent],
      providers: [
        { provide: BffService, useValue: bff },
        { provide: SessionService, useValue: session },
      ],
    });
    fixture = TestBed.createComponent(DesktopSshTerminalComponent);
    component = fixture.componentInstance;
  }

  async function init() {
    await component.ngOnInit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  // ── ships-dark: the authorized-but-dark path (the current admin-bff posture) ──
  describe('ships dark (authorization REAL, no live TTY)', () => {
    it('OPEN authorizes the session and, while dark, surfaces the dark state WITHOUT opening a WS', async () => {
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      const darkSession: DesktopSshSession = { deviceId: 'dev-1', dark: true, note: 'ships dark — increment' };
      bff.desktopOpenSshSession.and.resolveTo(darkSession);

      await component.open();

      expect(bff.desktopOpenSshSession).toHaveBeenCalledWith('dev-1');
      expect(component.dark()).toBeTrue();
      expect(component.connected()).toBeFalse(); // no live socket
      expect(component.darkNote()).toContain('ships dark');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="dst-dark"]')).not.toBeNull();
      // the term pane is greyed while dark / disconnected.
      expect(el.querySelector('[data-testid="dst-term"]')!.classList).toContain('dg-term-dark');
    });

    it('falls back to a default dark note when the descriptor carries none', async () => {
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      bff.desktopOpenSshSession.and.resolveTo({ deviceId: 'dev-1', dark: true, note: null });
      await component.open();
      expect(component.darkNote().length).toBeGreaterThan(0);
    });

    it('opens NO step-up + NO socket while the descriptor is dark', async () => {
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      bff.desktopOpenSshSession.and.resolveTo({ deviceId: 'dev-1', dark: true, note: null });
      await component.open();
      expect(bff.desktopStepUp).not.toHaveBeenCalled();
      expect(component.lastSocketArgs).toBeNull();
    });
  });

  // ── UI-TERMINAL: the corrected live handshake (testable while held-until-live) ──
  describe('live descriptor (contract fix; held-until-live round-trip)', () => {
    function fakeSocket() {
      // A stub the component records into lastSocketArgs but never actually dials.
      return { onopen: null, onmessage: null, onerror: null, onclose: null,
        send: () => undefined, close: () => undefined } as unknown as WebSocket;
    }

    it('mints a step-up FIRST, then opens the WS to /bff/admin/device-terminal/<id> (deviceId in PATH, NO access_token query) with the step-up subprotocol', async () => {
      setup({ me: 'Admin@Brand-A', devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      bff.desktopOpenSshSession.and.resolveTo({
        deviceId: 'dev-1', dark: false, stepUpRequired: true,
        wsPath: '/bff/admin/device-terminal/dev-1',
      });
      // Don't dial a real socket in headless Karma.
      spyOn(component as unknown as { createSocket: (u: string, p: string[]) => WebSocket }, 'createSocket')
        .and.callFake((url: string, protocols: string[]) => {
          (component as unknown as { lastSocketArgs: unknown }).lastSocketArgs = { url, protocols };
          return fakeSocket();
        });

      await component.open();

      // operator passed to the mint is the lowercased session id.
      expect(bff.desktopStepUp).toHaveBeenCalledWith('admin@brand-a');
      const args = component.lastSocketArgs!;
      expect(args).not.toBeNull();
      expect(args.url).toContain('/bff/admin/device-terminal/dev-1');
      expect(args.url).not.toContain('access_token');
      expect(args.url).not.toContain('stepUp=');
      // step-up rides the subprotocol, never the URL.
      expect(args.protocols).toContain('snapdragon.device-terminal');
      expect(args.protocols).toContain('snapdragon.device-terminal.stepup.STEPUP-TOK');
    });

    it('falls back to the canonical device-terminal path when the descriptor omits wsPath', async () => {
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-9' }, 'admin@brand-a')] });
      await init();
      component.deviceId = 'dev-9';
      bff.desktopOpenSshSession.and.resolveTo({ deviceId: 'dev-9', dark: false, stepUpRequired: true, wsPath: null });
      spyOn(component as unknown as { createSocket: (u: string, p: string[]) => WebSocket }, 'createSocket')
        .and.callFake((url: string, protocols: string[]) => {
          (component as unknown as { lastSocketArgs: unknown }).lastSocketArgs = { url, protocols };
          return fakeSocket();
        });
      await component.open();
      expect(component.lastSocketArgs!.url).toContain('/bff/admin/device-terminal/dev-9');
    });

    it('surfaces a step-up mint failure WITHOUT opening a socket', async () => {
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      bff.desktopOpenSshSession.and.resolveTo({ deviceId: 'dev-1', dark: false, wsPath: '/bff/admin/device-terminal/dev-1' });
      bff.desktopStepUp.and.rejectWith(new Error('no active ssh-license'));
      const spy = spyOn(component as unknown as { createSocket: () => WebSocket }, 'createSocket');
      await component.open();
      expect(spy).not.toHaveBeenCalled();
      expect(component.error()).toContain('Step-up required');
    });

    it('a step-up mint that NAMES step-up offers the inline dialog (NO socket), then satisfied re-opens the terminal', async () => {
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      bff.desktopOpenSshSession.and.resolveTo({ deviceId: 'dev-1', dark: false, wsPath: '/bff/admin/device-terminal/dev-1' });
      bff.desktopStepUp.and.rejectWith(new Error('device terminal requires step-up re-authentication'));
      const spy = spyOn(component as unknown as { createSocket: (u: string, p: string[]) => WebSocket }, 'createSocket')
        .and.callFake((url: string, protocols: string[]) => {
          (component as unknown as { lastSocketArgs: unknown }).lastSocketArgs = { url, protocols };
          return fakeSocket();
        });

      await component.open();
      // the dialog is offered rather than a bare error, and NO socket is opened.
      expect(component.stepUpChallenge()).not.toBeNull();
      expect(spy).not.toHaveBeenCalled();
      expect(component.error()).toBe('');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="mfa-stepup-dialog"]')).not.toBeNull();

      // the dialog reports success → the live terminal is re-opened (mint now succeeds).
      bff.desktopStepUp.and.resolveTo({ stepUpToken: 'STEPUP-TOK', ttlMinutes: 5 });
      await component.onStepUpSatisfied();
      expect(component.stepUpChallenge()).toBeNull();
      expect(spy).toHaveBeenCalled();
      expect(component.lastSocketArgs!.protocols).toContain('snapdragon.device-terminal.stepup.STEPUP-TOK');
    });
  });

  // ── gating (ALLOW + DENY isolation) ──────────────────────────────────────────
  describe('gating', () => {
    it('ALLOW: licensed own-domain device → canOpen', async () => {
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      expect(component.canOpen()).toBeTrue();
    });

    it('DENY: unlicensed device → canOpen=false, OPEN does NOT call the BFF, helptext + disabled button', async () => {
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'other@brand-a')] });
      await init();
      expect(component.canOpen()).toBeFalse();
      await component.open();
      expect(bff.desktopOpenSshSession).not.toHaveBeenCalled();
      expect(component.error()).toContain('device-SSH license');

      const el: HTMLElement = fixture.nativeElement;
      const btn = el.querySelector<HTMLButtonElement>('[data-testid="dst-open"]')!;
      expect(btn.disabled).toBeTrue();
      expect(btn.getAttribute('aria-describedby')).toBe('dst-gate-help');
      expect(el.querySelector('[data-testid="dst-gate-help"]')).not.toBeNull();
    });

    it('DENY: superadmin-owned device → gated with NO BFF call', async () => {
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-sa', owner_type: 'SUPERADMIN' }, 'admin@brand-a')] });
      await init();
      expect(component.canOpen()).toBeFalse();
      expect(component.gateReason()).toContain('superadmin-owned');
      await component.open();
      expect(bff.desktopOpenSshSession).not.toHaveBeenCalled();
    });

    it('DENY: surfaces a server 403 verbatim when the presentation gate was bypassed', async () => {
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      bff.desktopOpenSshSession.and.rejectWith(new Error('no active ssh-license'));
      await component.open();
      expect(component.error()).toContain('no active ssh-license');
      expect(component.dark()).toBeFalse();
    });
  });

  // ── accessibility ─────────────────────────────────────────────────────────
  describe('accessibility', () => {
    it('labels the section + the terminal region', async () => {
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="desktop-ssh-terminal-view"]')!.getAttribute('aria-labelledby'))
        .toBe('dst-heading');
      const term = el.querySelector('[data-testid="dst-term"]')!;
      expect(term.getAttribute('role')).toBe('application');
      expect(term.getAttribute('aria-label')!.length).toBeGreaterThan(0);
    });
  });
});
