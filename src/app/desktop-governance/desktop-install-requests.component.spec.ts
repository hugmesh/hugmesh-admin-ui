import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DesktopInstallRequestsComponent } from './desktop-install-requests.component';
import {
  BffService, DeviceRegistration, DesktopCatalogEntry, DesktopInstallRequest,
} from '../bff.service';
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

const req = (over: Partial<DesktopInstallRequest> = {}): DesktopInstallRequest => ({
  id: 'r-1', requester: 'google:carol', appRef: 'org.inkscape.Inkscape', deviceId: 'dev-1',
  status: 'pending', decidedBy: null, decidedAt: null, domain: 'brand-a', createdAt: null, ...over,
});

const catalogEntry = (id = 'cat-new'): DesktopCatalogEntry => ({
  id, appRef: 'org.inkscape.Inkscape', displayName: 'Inkscape', source: 'FLATPAK',
  enabled: false, addedBy: 'admin@brand-a', domain: 'brand-a', createdAt: null, updatedAt: null,
});

describe('DesktopInstallRequestsComponent (inbox + remote-install)', () => {
  let fixture: ComponentFixture<DesktopInstallRequestsComponent>;
  let component: DesktopInstallRequestsComponent;
  let bff: jasmine.SpyObj<BffService>;
  let session: jasmine.SpyObj<SessionService>;

  function setup(opts: {
    me: string; requests: DesktopInstallRequest[]; devices: DeviceRegistration[];
  }) {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'desktopInstallRequests', 'desktopDecideRequest', 'desktopRemoteInstall',
      'desktopCatalogAdd', 'desktopCatalogEnable', 'devices',
    ]);
    bff.desktopInstallRequests.and.resolveTo(opts.requests);
    bff.devices.and.resolveTo(opts.devices);

    session = jasmine.createSpyObj<SessionService>('SessionService', ['isSuperadmin']);
    (session as unknown as { session: () => unknown }).session = () => ({ id: opts.me, roles: [] });
    (session as unknown as { isSuperadmin: () => boolean }).isSuperadmin = () => false;

    TestBed.configureTestingModule({
      imports: [DesktopInstallRequestsComponent],
      providers: [
        { provide: BffService, useValue: bff },
        { provide: SessionService, useValue: session },
      ],
    });
    fixture = TestBed.createComponent(DesktopInstallRequestsComponent);
    component = fixture.componentInstance;
  }

  async function init() {
    await component.ngOnInit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  // ── user-situational: splits pending vs decided ──────────────────────────────
  describe('user-situational', () => {
    it('lists pending requests in the inbox and decided rows in history', async () => {
      setup({
        me: 'admin@brand-a',
        requests: [req({ id: 'r-1', status: 'pending' }), req({ id: 'r-2', status: 'approved', decidedBy: 'admin@brand-a' })],
        devices: [device({ id: 'dev-1' }, 'admin@brand-a')],
      });
      await init();
      expect(component.pending().map((r) => r.id)).toEqual(['r-1']);
      expect(component.decided().map((r) => r.id)).toEqual(['r-2']);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-request-id="r-1"]')).not.toBeNull();
      expect(el.querySelector('[data-decided-id="r-2"]')).not.toBeNull();
    });

    it('DENY decision CASes pending -> denied', async () => {
      setup({ me: 'admin@brand-a', requests: [req()], devices: [device({}, 'admin@brand-a')] });
      await init();
      bff.desktopDecideRequest.and.resolveTo({ decided: 1, status: 'denied' });
      await component.deny(req());
      expect(bff.desktopDecideRequest).toHaveBeenCalledWith('r-1', 'denied');
    });

    it('decided:0 (already decided / out of scope) surfaces a no-change note', async () => {
      setup({ me: 'admin@brand-a', requests: [req()], devices: [device({}, 'admin@brand-a')] });
      await init();
      bff.desktopDecideRequest.and.resolveTo({ decided: 0, status: 'denied' });
      await component.deny(req());
      expect(component.noteFor('r-1')?.kind).toBe('err');
      expect(component.noteFor('r-1')?.text).toContain('already decided');
    });
  });

  // ── approve flow: optional add-to-catalog (enables) + optional remote-install ─
  describe('approve flow', () => {
    it('plain APPROVE just CASes pending -> approved (no catalog, no install)', async () => {
      setup({ me: 'admin@brand-a', requests: [req()], devices: [device({}, 'admin@brand-a')] });
      await init();
      bff.desktopDecideRequest.and.resolveTo({ decided: 1, status: 'approved' });
      await component.approve(req());
      expect(bff.desktopDecideRequest).toHaveBeenCalledWith('r-1', 'approved');
      expect(bff.desktopCatalogAdd).not.toHaveBeenCalled();
      expect(bff.desktopRemoteInstall).not.toHaveBeenCalled();
    });

    it('APPROVE + add-to-catalog ADDS then ENABLES (add != enable made one action)', async () => {
      setup({ me: 'admin@brand-a', requests: [req()], devices: [device({}, 'admin@brand-a')] });
      await init();
      bff.desktopCatalogAdd.and.resolveTo(catalogEntry('cat-new'));
      bff.desktopCatalogEnable.and.resolveTo({ updated: 1, enabled: true });
      bff.desktopDecideRequest.and.resolveTo({ decided: 1, status: 'approved' });

      component.setAddToCatalog('r-1', true);
      component.setDisplayName('r-1', 'Inkscape');
      await component.approve(req());

      expect(bff.desktopCatalogAdd).toHaveBeenCalledWith('org.inkscape.Inkscape', 'Inkscape', 'FLATPAK');
      expect(bff.desktopCatalogEnable).toHaveBeenCalledWith('cat-new');
      expect(bff.desktopDecideRequest).toHaveBeenCalledWith('r-1', 'approved');
    });

    it('APPROVE + remote-install triggers the install onto the device when licensed', async () => {
      setup({ me: 'admin@brand-a', requests: [req()], devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      bff.desktopDecideRequest.and.resolveTo({ decided: 1, status: 'approved' });
      bff.desktopRemoteInstall.and.resolveTo('install queued');

      component.setRemoteInstall('r-1', true);
      await component.approve(req());

      expect(bff.desktopDecideRequest).toHaveBeenCalledWith('r-1', 'approved');
      expect(bff.desktopRemoteInstall).toHaveBeenCalledWith('dev-1', 'org.inkscape.Inkscape');
      expect(component.noteFor('r-1')?.kind).toBe('ok');
    });

    it('if the decide does NOT stick, the remote-install leg is SKIPPED', async () => {
      setup({ me: 'admin@brand-a', requests: [req()], devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      bff.desktopDecideRequest.and.resolveTo({ decided: 0, status: 'approved' });
      component.setRemoteInstall('r-1', true);
      await component.approve(req());
      expect(bff.desktopRemoteInstall).not.toHaveBeenCalled();
    });
  });

  // ── remote-install gating (ALLOW + DENY isolation) ───────────────────────────
  describe('remote-install gating', () => {
    it('ALLOW: licensed own-domain ADMIN device → canRemoteInstall + the BFF is called', async () => {
      setup({ me: 'admin@brand-a', requests: [req()], devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      bff.desktopRemoteInstall.and.resolveTo('queued');
      expect(component.canRemoteInstall(req())).toBeTrue();
      await component.remoteInstall(req());
      expect(bff.desktopRemoteInstall).toHaveBeenCalledWith('dev-1', 'org.inkscape.Inkscape');
    });

    it('DENY: unlicensed device → gated, NO BFF call, helptext rendered + button disabled', async () => {
      setup({ me: 'admin@brand-a', requests: [req()], devices: [device({ id: 'dev-1' }, 'other@brand-a')] });
      await init();
      expect(component.canRemoteInstall(req())).toBeFalse();
      await component.remoteInstall(req());
      expect(bff.desktopRemoteInstall).not.toHaveBeenCalled();
      expect(component.noteFor('r-1')?.text).toContain('device-SSH license');

      const el: HTMLElement = fixture.nativeElement;
      const btn = el.querySelector<HTMLButtonElement>('[data-remote-install="r-1"]')!;
      expect(btn.disabled).toBeTrue();
      expect(el.querySelector('[data-ri-help="r-1"]')).not.toBeNull();
    });

    it('DENY: superadmin-owned device → gated with NO BFF call', async () => {
      setup({
        me: 'admin@brand-a', requests: [req({ deviceId: 'dev-sa' })],
        devices: [device({ id: 'dev-sa', owner_type: 'SUPERADMIN' }, 'admin@brand-a')],
      });
      await init();
      expect(component.canRemoteInstall(req({ deviceId: 'dev-sa' }))).toBeFalse();
      await component.remoteInstall(req({ deviceId: 'dev-sa' }));
      expect(bff.desktopRemoteInstall).not.toHaveBeenCalled();
    });

    it('DENY: surfaces a server 403 verbatim when the presentation gate was bypassed', async () => {
      setup({ me: 'admin@brand-a', requests: [req()], devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
      bff.desktopRemoteInstall.and.rejectWith(new Error('ref not in the enabled allowlist'));
      await component.remoteInstall(req());
      expect(component.noteFor('r-1')?.kind).toBe('err');
      expect(component.noteFor('r-1')?.text).toContain('ref not in the enabled allowlist');
    });
  });

  // ── accessibility ─────────────────────────────────────────────────────────
  describe('accessibility', () => {
    beforeEach(async () => {
      setup({ me: 'admin@brand-a', requests: [req()], devices: [device({ id: 'dev-1' }, 'admin@brand-a')] });
      await init();
    });

    it('labels the view + each section list via aria', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="desktop-install-requests-view"]')!.getAttribute('aria-labelledby'))
        .toBe('dir-heading');
      expect(el.querySelector('[data-testid="dir-pending"]')!.getAttribute('aria-labelledby'))
        .toBe('dir-pending-heading');
    });

    it('gives the deny / approve / remote-install buttons request-specific accessible names', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-deny="r-1"]')!.getAttribute('aria-label')).toContain('Inkscape');
      expect(el.querySelector('[data-remote-install="r-1"]')!.getAttribute('aria-label')).toContain('google:carol');
    });
  });
});
