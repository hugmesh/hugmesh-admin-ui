import { Routes } from '@angular/router';
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
import { ForumAdminComponent } from './forum-admin/forum-admin.component';
import { AppealsComponent } from './appeals/appeals.component';
import { DeviceLicensesComponent } from './device-licenses.component';
import { SuperadminDomainsComponent } from './superadmin-domains.component';
import { OidcProviderRolesComponent } from './oidc-provider-roles.component';
import { AnubisAdminComponent } from './anubis-admin.component';
import { superadminGuard } from './superadmin.guard';

/** Routes exposed by the Admin native-federation remote. The snapdragon.systems
 *  host mounts these at /admin, so they resolve to /admin (allowlist),
 *  /admin/usage (ClickHouse usage dashboard), /admin/namespaces (namespace
 *  access grants), /admin/delegation (access-role suspend/ban + lift, domain-lock
 *  add/remove, and namespace grant/revoke — the AdminController delegation
 *  surface), /admin/route-access (per-gateway role→URL rules),
 *  /admin/isos (CI ISO downloads), /admin/argocd (ArgoCD applications dashboard,
 *  via the role-secured BFF proxy), /admin/tasks (guided admin-task wizard),
 *  the cloud Backup & Recovery feature module: /admin/backup (start a backup),
 *  /admin/recovery (restore a backup) and /admin/backups (history), and
 *  /admin/announcements (create + schedule + target announcements for the home
 *  banner, public login page, Mastodon/akkoma and the forum main page),
 *  /admin/appeals (the Appeals-Decide console — approve/deny a referred moderation
 *  appeal via the admin-bff decide-proxy that forwards to federation-api,
 *  domain-scoped), and
 *  /admin/device-licenses (the SUPERADMIN-only Device Licenses console over the
 *  device-ownership / SSH-operate-license registry — additionally superadmin-guarded), and
 *  /admin/superadmin/domains (the SUPERADMIN-only Domains console over the domain_registry
 *  brand list — multi-tenancy PR9, additionally superadmin-guarded), and
 *  /admin/oidc-providers (configure which roles new users auto-receive when registering via
 *  a given OIDC identity provider — domain-scoped for admins, all-domains for superadmin), and
 *  /admin/superadmin/anubis (SUPERADMIN-only read-only view of the Anubis PoW challenge sidecar:
 *  status, configured settings, and proxied Prometheus metrics with auto-refresh).
 *  Casdoor-admin-role guarded by the host. */
export const ADMIN_ROUTES: Routes = [
  { path: '', component: AdminComponent },
  { path: 'usage', component: UsageComponent },
  { path: 'namespaces', component: NamespaceAccessComponent },
  { path: 'delegation', component: DelegationComponent },
  { path: 'route-access', component: RouteAccessComponent },
  { path: 'routes', component: RouteDefinitionsComponent },
  { path: 'isos', component: IsoDownloadsComponent },
  { path: 'argocd', component: ArgocdDashboardComponent },
  { path: 'tasks', component: AdminTaskWizardComponent },
  { path: 'backup', component: BackupComponent },
  { path: 'recovery', component: RecoveryComponent },
  { path: 'backups', component: BackupHistoryComponent },
  { path: 'announcements', component: AnnouncementListComponent },
  { path: 'test-reports', component: TestReportsComponent },
  { path: 'forum', component: ForumAdminComponent },
  { path: 'appeals', component: AppealsComponent },
  { path: 'device-licenses', component: DeviceLicensesComponent, canActivate: [superadminGuard] },
  { path: 'superadmin/domains', component: SuperadminDomainsComponent, canActivate: [superadminGuard] },
  { path: 'oidc-providers', component: OidcProviderRolesComponent },
  { path: 'superadmin/anubis', component: AnubisAdminComponent, canActivate: [superadminGuard] },
];
