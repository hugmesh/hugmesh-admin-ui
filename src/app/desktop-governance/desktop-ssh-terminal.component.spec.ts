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
    bff = jasmine.createSpyObj<BffService>('BffService', ['devices', 'desktopOpenSshSession']);
    bff.devices.and.resolveTo(opts.devices);

    session = jasmine.createSpyObj<SessionService>('SessionService', ['isSuperadmin']);
    (session as unknown as { session: () => unknown }).session = () => ({ id: opts.me, bffToken: 'tok', roles: [] });
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
