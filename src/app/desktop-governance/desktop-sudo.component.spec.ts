import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DesktopSudoComponent } from './desktop-sudo.component';
import { BffService, DeviceRegistration, DesktopSudoGrant } from '../bff.service';
import { SessionService } from '../session.service';

/** A device with an OPTIONAL active per-device ssh-license for `operator`. */
function device(over: Partial<DeviceRegistration> = {}, licensedOperator?: string): DeviceRegistration {
  const id = over.id ?? 'dev-1';
  return {
    id,
    machine_key_fp: 'mkey:' + id,
    hostname: 'pi-' + id,
    tailnet_id: null,
    image_type: 'primary',
    owner_type: 'ADMIN',
    physical_owner: 'admin@brand-a',
    domain: 'brand-a',
    mesh_id: null,
    last_seen_at: null,
    licenses: licensedOperator
      ? [{
          id: 'lic-' + id, operator: licensedOperator, scope_type: 'DEVICE', device_id: id,
          target_domain: null, key_fingerprints: ['SHA256:x'], state: 'active',
          granted_by: 'root', granted_at: null,
        }]
      : [],
    ...over,
  };
}

const grant = (over: Partial<DesktopSudoGrant> = {}): DesktopSudoGrant => ({
  id: 'g-1', subject: 'google:alice', deviceId: 'dev-1', state: 'active',
  grantedBy: 'admin@brand-a', grantedAt: null, revokedAt: null, revokedBy: null,
  domain: 'brand-a', propagationState: 'pending', generation: 1, ...over,
});

describe('DesktopSudoComponent (sudo toggle + license gating)', () => {
  let fixture: ComponentFixture<DesktopSudoComponent>;
  let component: DesktopSudoComponent;
  let bff: jasmine.SpyObj<BffService>;
  let session: jasmine.SpyObj<SessionService>;

  function setup(opts: {
    me: string; superadmin?: boolean; devices: DeviceRegistration[]; grants?: DesktopSudoGrant[];
  }) {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'desktopSudoGrants', 'desktopSudoGrant', 'desktopSudoRevoke', 'devices',
    ]);
    bff.desktopSudoGrants.and.resolveTo(opts.grants ?? []);
    bff.devices.and.resolveTo(opts.devices);

    session = jasmine.createSpyObj<SessionService>('SessionService', ['isSuperadmin']);
    (session as unknown as { session: () => unknown }).session = () => ({ id: opts.me, roles: [] });
    (session as unknown as { isSuperadmin: () => boolean }).isSuperadmin = () => !!opts.superadmin;

    TestBed.configureTestingModule({
      imports: [DesktopSudoComponent],
      providers: [
        { provide: BffService, useValue: bff },
        { provide: SessionService, useValue: session },
      ],
    });
    fixture = TestBed.createComponent(DesktopSudoComponent);
    component = fixture.componentInstance;
  }

  async function init() {
    // Await ngOnInit explicitly (the workload-console spec pattern) so the async device/grant
    // load + the deviceId default are settled before we assert, independent of CD timing.
    await component.ngOnInit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  // ── user-situational: a licensed admin grants on their own-domain device ─────
  describe('user-situational (ALLOW)', () => {
    it('GRANTs when the admin holds an active license for the selected own-domain device', async () => {
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      bff.desktopSudoGrant.and.resolveTo(grant());

      expect(component.canGrant()).toBeTrue();
      component.subject = 'google:alice';
      await component.grant();

      expect(bff.desktopSudoGrant).toHaveBeenCalledWith('google:alice', 'dev-1');
      expect(component.subject).toBe(''); // cleared on success
    });

    it('matches the license operator CASE-INSENSITIVELY (session id vs license operator)', async () => {
      setup({ me: 'Admin@Brand-A', devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      expect(component.hasLicense()).toBeTrue();
      expect(component.canGrant()).toBeTrue();
    });

    it('REVOKEs a grant (CAS audit) and reloads', async () => {
      setup({
        me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'admin@brand-a')],
        grants: [grant({ id: 'g-1' })],
      });
      await init();
      bff.desktopSudoRevoke.and.resolveTo({ revoked: 1 });
      const before = bff.desktopSudoGrants.calls.count();
      await component.revoke('g-1');
      expect(bff.desktopSudoRevoke).toHaveBeenCalledWith('g-1');
      // revoke triggers exactly one reload of the grants list.
      expect(bff.desktopSudoGrants.calls.count()).toBe(before + 1);
    });
  });

  // ── cross-user / DENY isolation: the gate blocks before any BFF call ─────────
  describe('gating (DENY isolation — defence-in-depth presentation)', () => {
    it('DENY: no active license for the device → canGrant=false + helptext + NO BFF call', async () => {
      // The device is licensed to a DIFFERENT operator, not me.
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'someone-else@brand-a')] });
      await init();

      expect(component.hasLicense()).toBeFalse();
      expect(component.canGrant()).toBeFalse();
      expect(component.gateReason()).toContain('device-SSH license');

      component.subject = 'google:alice';
      await component.grant();
      expect(bff.desktopSudoGrant).not.toHaveBeenCalled();
      expect(component.grantError()).toContain('device-SSH license');
    });

    it('DENY: a SUPERADMIN-owned device is blocked (clean 422 territory) with NO BFF call', async () => {
      setup({
        me: 'super@root', superadmin: true,
        devices: [device({ id: 'dev-sa', owner_type: 'SUPERADMIN' }, 'super@root')],
      });
      await init();
      expect(component.superadminOwned()).toBeTrue();
      expect(component.canGrant()).toBeFalse();
      expect(component.gateReason()).toContain('superadmin-owned');
      component.subject = 'google:bob';
      await component.grant();
      expect(bff.desktopSudoGrant).not.toHaveBeenCalled();
    });

    it('DENY: blank subject is rejected locally even when the device gate passes', async () => {
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      component.subject = '   ';
      await component.grant();
      expect(bff.desktopSudoGrant).not.toHaveBeenCalled();
      expect(component.grantError()).not.toBe('');
    });

    it('DENY: surfaces a server 403 (no license) verbatim when the presentation gate was bypassed', async () => {
      // Simulate the device looking licensed client-side but the BFF rejecting (the BFF is the truth).
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      bff.desktopSudoGrant.and.rejectWith(new Error('no active ssh-license for device'));
      component.subject = 'google:alice';
      await component.grant();
      expect(component.grantError()).toBe('no active ssh-license for device');
    });

    it('DENY: surfaces a server 422 (superadmin-owned / cross-domain) verbatim', async () => {
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      bff.desktopSudoGrant.and.rejectWith(new Error('device is superadmin-owned'));
      component.subject = 'google:alice';
      await component.grant();
      expect(component.grantError()).toBe('device is superadmin-owned');
    });
  });

  // ── per-domain license scope ────────────────────────────────────────────────
  describe('per-domain license scope', () => {
    it('ALLOWs when the admin holds a per-DOMAIN license covering the device domain', async () => {
      const dev = device({ id: 'dev-1', domain: 'brand-a' });
      dev.licenses = [{
        id: 'lic-d', operator: 'admin@brand-a', scope_type: 'DOMAIN', device_id: null,
        target_domain: 'brand-a', key_fingerprints: ['SHA256:y'], state: 'active',
        granted_by: 'root', granted_at: null,
      }];
      setup({ me: 'admin@brand-a', devices: [dev] });
      await init();
      expect(component.hasLicense()).toBeTrue();
      expect(component.canGrant()).toBeTrue();
    });

    it('does NOT match a REVOKED license', async () => {
      const dev = device({ id: 'dev-1' });
      dev.licenses = [{
        id: 'lic-r', operator: 'admin@brand-a', scope_type: 'DEVICE', device_id: 'dev-1',
        target_domain: null, key_fingerprints: [], state: 'revoked', granted_by: 'root', granted_at: null,
      }];
      setup({ me: 'admin@brand-a', devices: [dev] });
      await init();
      expect(component.hasLicense()).toBeFalse();
    });
  });

  // ── accessibility ─────────────────────────────────────────────────────────
  describe('accessibility', () => {
    it('the Grant button is disabled + aria-describedby points at the gate helptext when blocked', async () => {
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'other@brand-a')] });
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const btn = el.querySelector<HTMLButtonElement>('[data-testid="ds-grant"]')!;
      expect(btn.disabled).toBeTrue();
      expect(btn.getAttribute('aria-describedby')).toBe('ds-gate-help');
      const help = el.querySelector('[data-testid="ds-gate-help"]')!;
      expect(help.getAttribute('role')).toBe('status');
      expect(help.textContent!.trim().length).toBeGreaterThan(0);
    });

    it('the Grant button is ENABLED with no helptext when the gate passes', async () => {
      setup({ me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const btn = el.querySelector<HTMLButtonElement>('[data-testid="ds-grant"]')!;
      expect(btn.disabled).toBeFalse();
      expect(el.querySelector('[data-testid="ds-gate-help"]')).toBeNull();
    });

    it('labels the section + grants table and the revoke button by subject + device', async () => {
      setup({
        me: 'admin@brand-a', devices: [device({ id: 'dev-1' }, 'admin@brand-a')],
        grants: [grant({ id: 'g-1', subject: 'google:alice' })],
      });
      await init();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="desktop-sudo-view"]')!.getAttribute('aria-labelledby'))
        .toBe('ds-heading');
      const revoke = el.querySelector('[data-revoke="g-1"]')!;
      expect(revoke.getAttribute('aria-label')).toContain('google:alice');
    });
  });
});
