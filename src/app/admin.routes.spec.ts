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
import { DelegationComponent } from './delegation/delegation.component';
import { TestReportsComponent } from './test-reports/test-reports.component';
import { ImageGenComponent } from './image-gen/image-gen.component';
import { MfaSecurityComponent } from './mfa/mfa-security.component';
import { ForumAdminComponent } from './forum-admin/forum-admin.component';
import { AppealsComponent } from './appeals/appeals.component';
import { AccountAppealsComponent } from './account-appeals/account-appeals.component';
import { DeviceLicensesComponent } from './device-licenses.component';
import { DevicePendingComponent } from './device-pending.component';
import { StoragePoolsComponent } from './storage-pools.component';
import { DeviceRadiosComponent } from './device-radios.component';
import { DomainCapabilitiesComponent } from './domain-capabilities.component';
import { EgressVpnComponent } from './egress-vpn.component';
import { SuperadminDomainsComponent } from './superadmin-domains.component';
import { OidcProviderRolesComponent } from './oidc-provider-roles.component';
import { GamesServicesComponent } from './games-services/games-services.component';
import { AnubisAdminComponent } from './anubis-admin.component';
import { DesktopGovernanceComponent } from './desktop-governance/desktop-governance.component';
import { superadminGuard } from './superadmin.guard';
import { gamesServicesGuard } from './games-services.guard';
import { WorkloadConsoleComponent } from './workload-console/workload-console.component';
import { WorkloadLogsComponent } from './workload-console/workload-logs.component';
import { WorkloadTerminalComponent } from './workload-console/workload-terminal.component';
import { workloadConsoleGuard } from './workload-console.guard';

/**
 * These specs lock down the federation contract: `./routes` (exposed under the
 * remote name "admin") is the single module the snapdragon.systems host mounts
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
    expect(byPath('test-reports')!.component).toBe(TestReportsComponent);
    expect(byPath('image-gen')!.component).toBe(ImageGenComponent);
    expect(byPath('forum')!.component).toBe(ForumAdminComponent);
    expect(byPath('appeals')!.component).toBe(AppealsComponent);
    expect(byPath('account-appeals')!.component).toBe(AccountAppealsComponent);
    expect(byPath('security')!.component).toBe(MfaSecurityComponent);
    expect(byPath('device-licenses')!.component).toBe(DeviceLicensesComponent);
    expect(byPath('device-pending')!.component).toBe(DevicePendingComponent);
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

  it('exposes exactly the thirty-four admin views the host expects (incl. delegation + appeals + account-appeals + the self-service security/MFA console + device-licenses + device-pending + node-storage + device-radios + domain-capabilities + desktop governance + egress-vpn + superadmin/domains + oidc-providers + games-services + superadmin/anubis + cloud-backups + image-gen + the HIDDEN-tier workloads console + its logs/terminal sub-views)', () => {
    expect(ADMIN_ROUTES.map((r) => r.path)).toEqual([
      '',
      'usage',
      'namespaces',
      'delegation',
      'route-access',
      'routes',
      'isos',
      'argocd',
      'tasks',
      'backup',
      'recovery',
      'backups',
      'cloud-backups',
      'announcements',
      'test-reports',
      'image-gen',
      'forum',
      'appeals',
      'account-appeals',
      'security',
      'device-licenses',
      'device-pending',
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

  it('superadmin-gates the egress-vpn console (additive, behind the superadmin guard)', () => {
    const ev = byPath('egress-vpn');
    expect(ev).toBeDefined();
    expect(ev!.component).toBe(EgressVpnComponent);
    expect(ev!.canActivate).toEqual([superadminGuard]);
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
