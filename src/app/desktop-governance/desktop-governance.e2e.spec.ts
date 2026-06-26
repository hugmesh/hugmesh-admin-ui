import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DesktopCatalogComponent } from './desktop-catalog.component';
import { DesktopInstallRequestsComponent } from './desktop-install-requests.component';
import { DesktopSshTerminalComponent } from './desktop-ssh-terminal.component';
import {
  BffService, DeviceRegistration, DesktopCatalogEntry, DesktopInstallRequest, DesktopSshSession,
} from '../bff.service';
import { SessionService } from '../session.service';

/**
 * GHERKIN-READABLE end-to-end FLOW specs for the desktop-governance headline journeys. The repo
 * carries no browser e2e runner (no Playwright/Cypress/Cucumber), so — consistent with the rest
 * of the suite — these drive the REAL components through the UI (button clicks via the rendered
 * DOM where it matters) against a single in-memory BffService fake that mutates server-side state,
 * framed as Feature / Scenario / Given-When-Then. They assert the cross-surface outcomes the unit
 * specs don't: curate -> enable changes what the store serves; request -> approve -> remote-install
 * threads the catalog + decide + install legs together; open-ssh-terminal exercises the ships-dark
 * authorize path through the DOM.
 */

/** A tiny in-memory desktop-governance "server" the BffService fake mutates. */
class FakeDesktopServer {
  catalog: DesktopCatalogEntry[] = [];
  requests: DesktopInstallRequest[] = [];
  installs: { deviceId: string; appRef: string }[] = [];
  devices: DeviceRegistration[] = [];
  private seq = 0;

  /** The refs the on-device Discover store WOULD serve = the enabled allowlist. */
  servedByDiscover(): string[] {
    return this.catalog.filter((e) => e.enabled).map((e) => e.appRef);
  }

  addCatalog(appRef: string, displayName: string, source?: string): DesktopCatalogEntry {
    const e: DesktopCatalogEntry = {
      id: 'cat-' + ++this.seq, appRef, displayName, source: source ?? 'FLATPAK',
      enabled: false, addedBy: 'admin@brand-a', domain: 'brand-a', createdAt: null, updatedAt: null,
    };
    this.catalog = [...this.catalog, e];
    return e;
  }
  setEnabled(id: string, enabled: boolean) {
    this.catalog = this.catalog.map((e) => (e.id === id ? { ...e, enabled } : e));
  }
  decide(id: string, status: string): number {
    let n = 0;
    this.requests = this.requests.map((r) => {
      if (r.id === id && r.status === 'pending') { n = 1; return { ...r, status, decidedBy: 'admin@brand-a' }; }
      return r;
    });
    return n;
  }
}

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

/** A BffService fake wired to the FakeDesktopServer (the desktop surface only). */
function fakeBff(server: FakeDesktopServer): BffService {
  const bff: Partial<BffService> = {
    desktopCatalog: () => Promise.resolve([...server.catalog]),
    desktopCatalogAdd: (appRef, displayName, source) =>
      Promise.resolve(server.addCatalog(appRef, displayName, source)),
    desktopCatalogEnable: (id) => { server.setEnabled(id, true); return Promise.resolve({ updated: 1, enabled: true }); },
    desktopCatalogDisable: (id) => { server.setEnabled(id, false); return Promise.resolve({ updated: 1, enabled: false }); },
    desktopCatalogRemove: (id) => {
      server.catalog = server.catalog.filter((e) => e.id !== id); return Promise.resolve({ removed: 1 });
    },
    desktopInstallRequests: () => Promise.resolve([...server.requests]),
    desktopDecideRequest: (id, status) => Promise.resolve({ decided: server.decide(id, status), status }),
    // The license-gated step-up mint (ADMIN-reachable). The install below requires the minted
    // token (the BFF fail-closed tightening).
    desktopStepUp: () => Promise.resolve({ stepUpToken: 'STEPUP-TOK', ttlMinutes: 5 }),
    desktopRemoteInstall: (deviceId, appRef, stepUpToken) => {
      const d = server.devices.find((x) => x.id === deviceId);
      // Mirror the BFF: 403 unless a step-up token is presented AND licensed + own-domain + ref
      // in the ENABLED allowlist.
      if (!stepUpToken) return Promise.reject(new Error('step-up required'));
      const licensed = !!d && d.owner_type !== 'SUPERADMIN'
        && d.licenses.some((l) => l.state === 'active');
      const enabled = server.servedByDiscover().includes(appRef);
      if (!licensed) return Promise.reject(new Error('no active ssh-license for device'));
      if (!enabled) return Promise.reject(new Error('ref not in the enabled allowlist'));
      server.installs.push({ deviceId, appRef });
      return Promise.resolve('install queued');
    },
    desktopOpenSshSession: (deviceId): Promise<DesktopSshSession> => {
      const d = server.devices.find((x) => x.id === deviceId);
      const licensed = !!d && d.owner_type !== 'SUPERADMIN' && d.licenses.some((l) => l.state === 'active');
      if (!licensed) return Promise.reject(new Error('no active ssh-license'));
      // The admin-bff SCAFFOLD ships dark: authorization is real, the session descriptor is dark.
      return Promise.resolve({ deviceId, dark: true, note: 'ships dark — increment' });
    },
    devices: () => Promise.resolve([...server.devices]),
  };
  return bff as BffService;
}

function fakeSession(id = 'admin@brand-a'): SessionService {
  const s: Partial<SessionService> = {
    session: (() => ({ id, roles: ['admin'] })) as unknown as SessionService['session'],
    isSuperadmin: (() => false) as unknown as SessionService['isSuperadmin'],
  };
  return s as SessionService;
}

describe('FEATURE: Desktop governance (Gherkin-readable e2e flows)', () => {

  // ── SCENARIO 1: curate -> enable ──────────────────────────────────────────────
  describe('SCENARIO: An admin curates an app into the Discover store (add != enable)', () => {
    let server: FakeDesktopServer;
    let fixture: ComponentFixture<DesktopCatalogComponent>;
    let component: DesktopCatalogComponent;

    beforeEach(async () => {
      server = new FakeDesktopServer();
      TestBed.configureTestingModule({
        imports: [DesktopCatalogComponent],
        providers: [{ provide: BffService, useValue: fakeBff(server) }],
      });
      fixture = TestBed.createComponent(DesktopCatalogComponent);
      component = fixture.componentInstance;
      await component.ngOnInit();
      fixture.detectChanges();
    });

    it('GIVEN an empty catalog, WHEN the admin adds Firefox THEN the store still serves nothing (add != enable), AND WHEN the admin enables it THEN Discover serves it', async () => {
      // GIVEN an empty catalog — the store serves nothing.
      expect(server.servedByDiscover()).toEqual([]);

      // WHEN the admin adds Firefox to the catalog.
      component.appRef = 'org.mozilla.firefox';
      component.displayName = 'Firefox';
      component.source = 'FLATPAK';
      await component.add();
      fixture.detectChanges();

      // THEN the ref is in the catalog but DISABLED — the store STILL serves nothing (default-none).
      expect(server.catalog.map((e) => e.appRef)).toEqual(['org.mozilla.firefox']);
      expect(server.catalog[0].enabled).withContext('add != enable').toBeFalse();
      expect(server.servedByDiscover()).withContext('store still empty after add').toEqual([]);
      expect(component.storeEmpty()).toBeTrue();

      // WHEN the admin clicks Enable on the row (through the rendered DOM).
      const el: HTMLElement = fixture.nativeElement;
      const enableBtn = el.querySelector<HTMLButtonElement>(`[data-enable="${server.catalog[0].id}"]`)!;
      expect(enableBtn).withContext('enable button present on a disabled row').not.toBeNull();
      enableBtn.click();
      await fixture.whenStable();
      fixture.detectChanges();

      // THEN Discover now serves Firefox.
      expect(server.servedByDiscover()).toEqual(['org.mozilla.firefox']);
      expect(component.storeEmpty()).toBeFalse();
    });
  });

  // ── SCENARIO 2: request -> approve (+catalog) -> remote-install ───────────────
  describe('SCENARIO: A user requests an app; the admin approves, catalogs+enables it, and remote-installs', () => {
    let server: FakeDesktopServer;
    let fixture: ComponentFixture<DesktopInstallRequestsComponent>;
    let component: DesktopInstallRequestsComponent;

    beforeEach(async () => {
      server = new FakeDesktopServer();
      server.devices = [device({ id: 'dev-1' }, 'admin@brand-a')]; // the admin holds a license here
      server.requests = [{
        id: 'r-1', requester: 'google:carol', appRef: 'org.inkscape.Inkscape', deviceId: 'dev-1',
        status: 'pending', decidedBy: null, decidedAt: null, domain: 'brand-a', createdAt: null,
      }];
      TestBed.configureTestingModule({
        imports: [DesktopInstallRequestsComponent],
        providers: [
          { provide: BffService, useValue: fakeBff(server) },
          { provide: SessionService, useValue: fakeSession() },
        ],
      });
      fixture = TestBed.createComponent(DesktopInstallRequestsComponent);
      component = fixture.componentInstance;
      await component.ngOnInit();
      fixture.detectChanges();
    });

    it('GIVEN a pending request on a licensed own-domain device, WHEN the admin approves with add-to-catalog + remote-install THEN the request is approved, the app is enabled in Discover, and the install fires onto the device', async () => {
      // GIVEN a pending request is shown in the inbox.
      expect(component.pending().map((r) => r.id)).toEqual(['r-1']);
      const req = component.pending()[0];

      // WHEN the admin opts into add-to-catalog + remote-install and approves.
      component.setAddToCatalog('r-1', true);
      component.setDisplayName('r-1', 'Inkscape');
      component.setRemoteInstall('r-1', true);
      await component.approve(req);
      await fixture.whenStable();
      fixture.detectChanges();

      // THEN the request is approved (CAS pending -> approved).
      expect(server.requests[0].status).toBe('approved');
      // AND the app was added to the catalog AND enabled (so Discover serves it).
      expect(server.servedByDiscover()).toContain('org.inkscape.Inkscape');
      // AND the remote install fired onto the requester's device.
      expect(server.installs).toEqual([{ deviceId: 'dev-1', appRef: 'org.inkscape.Inkscape' }]);
      // AND the row moved out of the pending inbox into history.
      expect(component.pending().length).toBe(0);
      expect(component.decided().map((r) => r.id)).toEqual(['r-1']);
    });

    it('GIVEN the SAME request but on a device the admin has NO license for, WHEN the admin tries to remote-install THEN it is gated (no install fires) and a denial is surfaced', async () => {
      // GIVEN the device is licensed to someone ELSE (cross-user DENY isolation).
      server.devices = [device({ id: 'dev-1' }, 'someone-else@brand-a')];
      await component.ngOnInit();
      fixture.detectChanges();
      const req = component.pending()[0];

      // WHEN the admin attempts a direct remote install.
      await component.remoteInstall(req);

      // THEN nothing installs and the denial is surfaced (the presentation gate blocked it).
      expect(server.installs.length).toBe(0);
      expect(component.noteFor('r-1')?.kind).toBe('err');
      expect(component.canRemoteInstall(req)).toBeFalse();
    });
  });

  // ── SCENARIO 3: open-ssh-terminal (ships dark) ────────────────────────────────
  describe('SCENARIO: An admin opens the in-UI SSH terminal (ships dark)', () => {
    let server: FakeDesktopServer;
    let fixture: ComponentFixture<DesktopSshTerminalComponent>;
    let component: DesktopSshTerminalComponent;

    beforeEach(async () => {
      server = new FakeDesktopServer();
      server.devices = [device({ id: 'dev-1' }, 'admin@brand-a')];
      TestBed.configureTestingModule({
        imports: [DesktopSshTerminalComponent],
        providers: [
          { provide: BffService, useValue: fakeBff(server) },
          { provide: SessionService, useValue: fakeSession() },
        ],
      });
      fixture = TestBed.createComponent(DesktopSshTerminalComponent);
      component = fixture.componentInstance;
      await component.ngOnInit();
      fixture.detectChanges();
    });

    it('GIVEN a licensed own-domain device, WHEN the admin clicks Open terminal THEN the session authorizes but renders the ships-dark state (no live TTY) with the term pane greyed', async () => {
      // GIVEN the Open button is enabled (licensed device).
      const el: HTMLElement = fixture.nativeElement;
      const openBtn = el.querySelector<HTMLButtonElement>('[data-testid="dst-open"]')!;
      expect(openBtn.disabled).withContext('open enabled for a licensed device').toBeFalse();

      // WHEN the admin clicks Open terminal.
      openBtn.click();
      await fixture.whenStable();
      fixture.detectChanges();

      // THEN the session authorized but ships dark — no live socket, the dark panel shows, term greyed.
      expect(component.dark()).toBeTrue();
      expect(component.connected()).toBeFalse();
      expect(el.querySelector('[data-testid="dst-dark"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="dst-term"]')!.classList).toContain('dg-term-dark');
    });

    it('GIVEN a device the admin has NO license for, WHEN they try to open THEN it is gated (disabled + helptext) and no session is authorized', async () => {
      // GIVEN an unlicensed device (cross-user DENY).
      server.devices = [device({ id: 'dev-1' }, 'other@brand-a')];
      await component.ngOnInit();
      fixture.detectChanges();

      // THEN the open button is disabled and the gate helptext is shown.
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector<HTMLButtonElement>('[data-testid="dst-open"]')!.disabled).toBeTrue();
      expect(el.querySelector('[data-testid="dst-gate-help"]')).not.toBeNull();

      // WHEN the admin forces open() anyway THEN no session is authorized.
      await component.open();
      expect(component.dark()).toBeFalse();
      expect(component.error()).toContain('device-SSH license');
    });
  });
});
