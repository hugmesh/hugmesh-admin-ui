import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CanActivateFn, Router, provideRouter } from '@angular/router';
import { ADMIN_ROUTES } from './admin.routes';
import { AdminComponent } from './admin.component';
import { UsageComponent } from './usage.component';
import { NamespaceAccessComponent } from './namespace-access.component';
import { RouteAccessComponent } from './route-access.component';
import { RouteDefinitionsComponent } from './route-definitions.component';
import { IsoDownloadsComponent } from './iso-downloads.component';
import { ArgocdDashboardComponent } from './argocd-dashboard.component';
import { AdminTaskWizardComponent } from './admin-task-wizard.component';
import { BackupComponent } from './backup/backup.component';
import { RecoveryComponent } from './backup/recovery.component';
import { BackupHistoryComponent } from './backup/backup-history.component';
import { AnnouncementListComponent } from './announcements/announcement-list.component';
import { DomainThemesComponent } from './themes/domain-themes.component';
import { DelegationComponent } from './delegation/delegation.component';
import { TestReportsComponent } from './test-reports/test-reports.component';
import { ImageGenComponent } from './image-gen/image-gen.component';
import { MfaSecurityComponent } from './mfa/mfa-security.component';
import { ForumAdminComponent } from './forum-admin/forum-admin.component';
import { AppealsComponent } from './appeals/appeals.component';
import { AccountAppealsComponent } from './account-appeals/account-appeals.component';
import { DeviceLicensesComponent } from './device-licenses.component';
import { DevicePendingComponent } from './device-pending.component';
import { PhoneFleetComponent } from './phone-fleet.component';
import { MyFleetComponent } from './my-fleet.component';
import { FleetEntitlementsComponent } from './fleet-entitlements.component';
import { StoragePoolsComponent } from './storage-pools.component';
import { DeviceRadiosComponent } from './device-radios.component';
import { DomainCapabilitiesComponent } from './domain-capabilities.component';
import { EgressVpnComponent } from './egress-vpn.component';
import { SuperadminDomainsComponent } from './superadmin-domains.component';
import { OidcProviderRolesComponent } from './oidc-provider-roles.component';
import { GamesServicesComponent } from './games-services/games-services.component';
import { AnubisAdminComponent } from './anubis-admin.component';
import { DesktopGovernanceComponent } from './desktop-governance/desktop-governance.component';
import { BackingServicesComponent } from './backing-services/backing-services.component';
import { adminGuard } from './admin.guard';
import { superadminGuard } from './superadmin.guard';
import { fleetAdminGuard } from './fleet.guard';
import { gamesServicesGuard } from './games-services.guard';
import { WorkloadConsoleComponent } from './workload-console/workload-console.component';
import { WorkloadLogsComponent } from './workload-console/workload-logs.component';
import { WorkloadTerminalComponent } from './workload-console/workload-terminal.component';
import { workloadConsoleGuard } from './workload-console.guard';

/**
 * These specs lock down the federation contract: `./routes` (exposed under the
 * remote name "admin") is the single module the hugmesh.net host mounts
 * at /admin. The host depends on these exact paths and components, so a
 * regression here would silently break the host's admin console.
 */
describe('ADMIN_ROUTES (exposed ./routes federation contract)', () => {
  const byPath = (path: string) => ADMIN_ROUTES.find((r) => r.path === path);

  it('exposes the allowlist console at the empty path (default mount point)', () => {
    const root = byPath('');
    expect(root).toBeDefined();
    expect(root!.component).toBe(AdminComponent);
  });

  it('wires each feature route to its dedicated component', () => {
    expect(byPath('usage')!.component).toBe(UsageComponent);
    expect(byPath('namespaces')!.component).toBe(NamespaceAccessComponent);
    expect(byPath('delegation')!.component).toBe(DelegationComponent);
    expect(byPath('route-access')!.component).toBe(RouteAccessComponent);
    expect(byPath('routes')!.component).toBe(RouteDefinitionsComponent);
    expect(byPath('isos')!.component).toBe(IsoDownloadsComponent);
    expect(byPath('argocd')!.component).toBe(ArgocdDashboardComponent);
    expect(byPath('tasks')!.component).toBe(AdminTaskWizardComponent);
    expect(byPath('backup')!.component).toBe(BackupComponent);
    expect(byPath('recovery')!.component).toBe(RecoveryComponent);
    expect(byPath('backups')!.component).toBe(BackupHistoryComponent);
    expect(byPath('announcements')!.component).toBe(AnnouncementListComponent);
    // Per-domain themes: the editor the operator sets a domain's brand from.
    expect(byPath('themes')!.component).toBe(DomainThemesComponent);
    expect(byPath('test-reports')!.component).toBe(TestReportsComponent);
    expect(byPath('image-gen')!.component).toBe(ImageGenComponent);
    expect(byPath('forum')!.component).toBe(ForumAdminComponent);
    expect(byPath('appeals')!.component).toBe(AppealsComponent);
    expect(byPath('account-appeals')!.component).toBe(AccountAppealsComponent);
    expect(byPath('security')!.component).toBe(MfaSecurityComponent);
    expect(byPath('device-licenses')!.component).toBe(DeviceLicensesComponent);
    expect(byPath('device-pending')!.component).toBe(DevicePendingComponent);
    expect(byPath('phone-fleet')!.component).toBe(PhoneFleetComponent);
    expect(byPath('my-fleet')!.component).toBe(MyFleetComponent);
    expect(byPath('fleet-entitlements')!.component).toBe(FleetEntitlementsComponent);
    expect(byPath('node-storage')!.component).toBe(StoragePoolsComponent);
    expect(byPath('device-radios')!.component).toBe(DeviceRadiosComponent);
    expect(byPath('domain-capabilities')!.component).toBe(DomainCapabilitiesComponent);
    expect(byPath('egress-vpn')!.component).toBe(EgressVpnComponent);
    expect(byPath('superadmin/domains')!.component).toBe(SuperadminDomainsComponent);
    expect(byPath('oidc-providers')!.component).toBe(OidcProviderRolesComponent);
    expect(byPath('desktop')!.component).toBe(DesktopGovernanceComponent);
    expect(byPath('games-services')!.component).toBe(GamesServicesComponent);
    expect(byPath('superadmin/anubis')!.component).toBe(AnubisAdminComponent);
  });

  it('exposes exactly the forty admin views the host expects (incl. delegation + the roles grant/revoke console + appeals + account-appeals + the self-service security/MFA console + device-licenses + device-pending + phone-fleet + my-fleet + fleet-entitlements + node-storage + device-radios + domain-capabilities + desktop governance + egress-vpn + superadmin/domains + oidc-providers + games-services + superadmin/anubis + cloud-backups + backing-services + image-gen + per-domain themes + the HIDDEN-tier workloads console + its logs/terminal sub-views)', () => {
    expect(ADMIN_ROUTES.map((r) => r.path)).toEqual([
      '',
      'usage',
      'namespaces',
      'delegation',
      'roles',
      'route-access',
      'routes',
      'isos',
      'argocd',
      'tasks',
      'backup',
      'recovery',
      'backups',
      'cloud-backups',
      'backing-services',
      'announcements',
      'themes',
      'test-reports',
      'image-gen',
      'forum',
      'appeals',
      'account-appeals',
      'security',
      'device-licenses',
      'device-pending',
      'phone-fleet',
      'my-fleet',
      'fleet-entitlements',
      'node-storage',
      'device-radios',
      'domain-capabilities',
      'egress-vpn',
      'superadmin/domains',
      'oidc-providers',
      'desktop',
      'games-services',
      'superadmin/anubis',
      'workloads',
      'workloads/logs',
      'workloads/terminal',
    ]);
  });

  it('grant-gates the HIDDEN-tier workload console + its DANGEROUS sub-views (behind the workload-console grant guard)', () => {
    const wc = byPath('workloads');
    expect(wc).toBeDefined();
    expect(wc!.component).toBe(WorkloadConsoleComponent);
    expect(wc!.canActivate).toEqual([workloadConsoleGuard]);

    const logs = byPath('workloads/logs');
    expect(logs!.component).toBe(WorkloadLogsComponent);
    expect(logs!.canActivate).toEqual([workloadConsoleGuard]);

    const term = byPath('workloads/terminal');
    expect(term!.component).toBe(WorkloadTerminalComponent);
    expect(term!.canActivate).toEqual([workloadConsoleGuard]);
  });

  it('superadmin-gates the device-licenses console (additive, behind the superadmin guard)', () => {
    expect(byPath('device-licenses')!.canActivate).toEqual([superadminGuard]);
  });

  it('superadmin-gates the device-pending pick-list (assign enrolled nodes; behind the superadmin guard)', () => {
    const dp = byPath('device-pending');
    expect(dp).toBeDefined();
    expect(dp!.component).toBe(DevicePendingComponent);
    expect(dp!.canActivate).toEqual([superadminGuard]);
  });

  it('superadmin-gates the phone-fleet console (read-only MDM phone registry; behind the superadmin guard)', () => {
    const pf = byPath('phone-fleet');
    expect(pf).toBeDefined();
    expect(pf!.component).toBe(PhoneFleetComponent);
    expect(pf!.canActivate).toEqual([superadminGuard]);
  });

  it('fleet-gates the my-fleet owner console (fleetAdminGuard — fleet_admin/admin/superadmin; the BFF enforces the entitlement + owner wall)', () => {
    const mf = byPath('my-fleet');
    expect(mf).toBeDefined();
    expect(mf!.component).toBe(MyFleetComponent);
    expect(mf!.canActivate).toEqual([fleetAdminGuard]);
  });

  it('superadmin-gates the fleet-entitlements console (grant/revoke the FLEET_ADMIN subscription; behind the superadmin guard)', () => {
    const fe = byPath('fleet-entitlements');
    expect(fe).toBeDefined();
    expect(fe!.component).toBe(FleetEntitlementsComponent);
    expect(fe!.canActivate).toEqual([superadminGuard]);
  });

  it('superadmin-gates the egress-vpn console (additive, behind the superadmin guard)', () => {
    const ev = byPath('egress-vpn');
    expect(ev).toBeDefined();
    expect(ev!.component).toBe(EgressVpnComponent);
    expect(ev!.canActivate).toEqual([superadminGuard]);
  });

  it('superadmin-gates the backing-services console (managed cross-domain infra; behind the superadmin guard)', () => {
    const bs = byPath('backing-services');
    expect(bs).toBeDefined();
    expect(bs!.component).toBe(BackingServicesComponent);
    expect(bs!.canActivate).toEqual([superadminGuard]);
  });

  it('superadmin-gates the domains console (multi-tenancy PR9, behind the superadmin guard)', () => {
    const domains = byPath('superadmin/domains');
    expect(domains).toBeDefined();
    expect(domains!.component).toBe(SuperadminDomainsComponent);
    expect(domains!.canActivate).toEqual([superadminGuard]);
  });

  it('leaves the desktop-governance console UN-superadmin-guarded (ADMIN/SUPERADMIN; the BFF gates ADMIN/SUPERADMIN own-domain)', () => {
    const desktop = byPath('desktop');
    expect(desktop).toBeDefined();
    expect(desktop!.component).toBe(DesktopGovernanceComponent);
    expect(desktop!.canActivate).toBeUndefined();
  });

  it('games-gates the games-services operator console (behind the games-services guard)', () => {
    const gs = byPath('games-services');
    expect(gs).toBeDefined();
    expect(gs!.component).toBe(GamesServicesComponent);
    expect(gs!.canActivate).toEqual([gamesServicesGuard]);
  });

  it('superadmin-gates the anubis console (read-only PoW sidecar view, behind the superadmin guard)', () => {
    const anubis = byPath('superadmin/anubis');
    expect(anubis).toBeDefined();
    expect(anubis!.component).toBe(AnubisAdminComponent);
    expect(anubis!.canActivate).toEqual([superadminGuard]);
  });

  it('exposes the appeals console as a plain ADMIN route (no superadmin guard)', () => {
    const appeals = byPath('appeals');
    expect(appeals).toBeDefined();
    expect(appeals!.component).toBe(AppealsComponent);
    expect(appeals!.canActivate).toBeUndefined();
  });

  it('exposes the account-appeals console as a plain ADMIN route (no superadmin guard) — DISTINCT from the content-moderation appeals console', () => {
    const accountAppeals = byPath('account-appeals');
    expect(accountAppeals).toBeDefined();
    expect(accountAppeals!.component).toBe(AccountAppealsComponent);
    expect(accountAppeals!.canActivate).toBeUndefined();
  });

  it('exposes the node-storage console as a plain ADMIN route (ADMIN-CAPABLE — the deliberate divergence from device-licenses; ownership is gated by the BFF)', () => {
    const storage = byPath('node-storage');
    expect(storage).toBeDefined();
    expect(storage!.component).toBe(StoragePoolsComponent);
    expect(storage!.canActivate).toBeUndefined();
  });

  it('exposes the device-radios console as a plain ADMIN route (ADMIN-CAPABLE — the same node-storage divergence; ownership is gated by the BFF)', () => {
    const radios = byPath('device-radios');
    expect(radios).toBeDefined();
    expect(radios!.component).toBe(DeviceRadiosComponent);
    expect(radios!.canActivate).toBeUndefined();
  });

  it('exposes the domain-capabilities console as a plain ADMIN route (no route guard — the BFF list endpoint itself scopes an ADMIN to their own domain vs. every domain for a SUPERADMIN)', () => {
    const dc = byPath('domain-capabilities');
    expect(dc).toBeDefined();
    expect(dc!.component).toBe(DomainCapabilitiesComponent);
    expect(dc!.canActivate).toBeUndefined();
  });

  /**
   * The WHOLE path→guard map, pinned in one place (see the GUARD POLICY note on ADMIN_ROUTES).
   * `undefined` is deliberate: the landing and the plain consoles carry NO remote-side guard —
   * their client gate is the host shell's `/admin` guard. A guard added to or dropped from any
   * route fails here, so the README routes/guard tables and the docblocks that describe this map
   * get revisited in the same change.
   */
  const EXPECTED_GUARDS: Record<string, CanActivateFn[] | undefined> = {
    '': undefined,
    'usage': undefined,
    'namespaces': undefined,
    'delegation': undefined,
    'roles': undefined,
    'route-access': undefined,
    'routes': undefined,
    'isos': undefined,
    'argocd': undefined,
    'tasks': undefined,
    'backup': undefined,
    'recovery': undefined,
    'backups': undefined,
    'cloud-backups': undefined,
    'backing-services': [superadminGuard],
    'announcements': undefined,
    'themes': undefined,
    'test-reports': undefined,
    'image-gen': undefined,
    'forum': undefined,
    'appeals': undefined,
    'account-appeals': undefined,
    'security': undefined,
    'device-licenses': [superadminGuard],
    'device-pending': [superadminGuard],
    'phone-fleet': [superadminGuard],
    'my-fleet': [fleetAdminGuard],
    'fleet-entitlements': [superadminGuard],
    'node-storage': undefined,
    'device-radios': undefined,
    'domain-capabilities': undefined,
    'egress-vpn': [superadminGuard],
    'superadmin/domains': [superadminGuard],
    'oidc-providers': undefined,
    'desktop': undefined,
    'games-services': [gamesServicesGuard],
    'superadmin/anubis': [superadminGuard],
    'workloads': [workloadConsoleGuard],
    'workloads/logs': [workloadConsoleGuard],
    'workloads/terminal': [workloadConsoleGuard],
  };

  it('pins the whole path→guard map (plain consoles carry no remote-side guard; the rest carry their audience guard)', () => {
    const actual: Record<string, unknown> = {};
    for (const route of ADMIN_ROUTES) actual[route.path!] = route.canActivate;
    expect(actual).toEqual(EXPECTED_GUARDS);
  });

  it('wires adminGuard onto NO route — TODO(admin-guard) is an open decision (it reads only the hug.session mirror), and the README/docblocks say so', () => {
    for (const route of ADMIN_ROUTES) {
      expect(route.canActivate ?? []).withContext(`route '${route.path}'`).not.toContain(adminGuard);
    }
  });

  it('declares every route with either a component or children (no dead routes)', () => {
    for (const route of ADMIN_ROUTES) {
      expect(route.component || route.children).withContext(`route ${route.path}`).toBeTruthy();
    }
  });

  it('contains no duplicate paths', () => {
    const paths = ADMIN_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

/**
 * Router-level pin of the two regressions that ruled out wiring adminGuard onto the plain routes
 * as written (see TODO(admin-guard) in admin.guard.ts). ADMIN_ROUTES is mounted exactly as the
 * standalone dev shell mounts it (`app.routes.ts`: `{ path: '', children: ADMIN_ROUTES }`), plus
 * a stub `/login` so a redirect is observable. The REAL guards and the REAL SessionService run,
 * fed by the `hug.session` localStorage mirror (seeded, stale, or absent). No RouterOutlet is
 * rendered, so an activated route does not instantiate its console (none of its BFF calls fire).
 *
 * What this can and cannot show: it runs this remote's router config in isolation. It does not
 * load the host shell, so the host's own `/admin` guard (which reads roles hydrated from
 * `GET /bff/session`) is not in the picture; the "host admitted them" premise of the stale- and
 * absent-mirror cases is taken from hugmesh-host-shell's code, not exercised here.
 *
 * The workloads routes are left out on purpose: workloadConsoleGuard makes a live BFF probe.
 */
describe('ADMIN_ROUTES guard wiring (router-level, standalone mount)', () => {
  @Component({ standalone: true, template: '' })
  class LoginStubComponent {}

  const KEY = 'hug.session';
  let saved: string | null;

  beforeEach(() => {
    saved = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
  });

  afterEach(() => {
    if (saved === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, saved);
  });

  /** Seed the mirror BEFORE anything injects SessionService (its signal reads the key once, at
   *  construction), then navigate and report where the router settled. `null` = no mirror. */
  async function navigateAs(roles: string[] | null, url: string): Promise<string> {
    if (roles) {
      localStorage.setItem(KEY, JSON.stringify({
        id: 'google:e2e@example.test', label: 'e2e', provider: 'google', roles, registrationComplete: true,
      }));
    }
    TestBed.configureTestingModule({
      providers: [provideRouter([
        { path: 'login', component: LoginStubComponent },
        { path: '', children: ADMIN_ROUTES },
      ])],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    return router.url;
  }

  it('does not bounce a caller with NO hug.session mirror off the landing or a plain console (cookie-only session the host supports; the dev shell writes no mirror)', async () => {
    expect(await navigateAs(null, '/')).toBe('/');
    TestBed.resetTestingModule();
    expect(await navigateAs(null, '/node-storage')).toBe('/node-storage');
  });

  it('does not bounce a caller whose mirror predates a mid-session admin grant (still says "user") off the landing or a plain console', async () => {
    expect(await navigateAs(['user'], '/')).toBe('/');
    TestBed.resetTestingModule();
    expect(await navigateAs(['user'], '/device-radios')).toBe('/device-radios');
  });

  it('still lets the audience guards refuse: an admin without superadmin is sent to /login from a superadmin-only console', async () => {
    expect(await navigateAs(['admin'], '/device-licenses')).toBe('/login');
  });

  it('still admits each audience to its own console (superadmin, bare fleet_admin, bare games_services_runner)', async () => {
    expect(await navigateAs(['superadmin'], '/device-licenses')).toBe('/device-licenses');
    TestBed.resetTestingModule();
    expect(await navigateAs(['fleet_admin'], '/my-fleet')).toBe('/my-fleet');
    TestBed.resetTestingModule();
    expect(await navigateAs(['games_services_runner'], '/games-services')).toBe('/games-services');
  });
});
