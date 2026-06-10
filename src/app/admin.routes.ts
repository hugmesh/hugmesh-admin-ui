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

/** Routes exposed by the Admin native-federation remote. The snapdragon.systems
 *  host mounts these at /admin, so they resolve to /admin (allowlist),
 *  /admin/usage (ClickHouse usage dashboard), /admin/namespaces (namespace
 *  access grants), /admin/route-access (per-gateway role→URL rules),
 *  /admin/isos (CI ISO downloads), /admin/argocd (ArgoCD applications dashboard,
 *  via the role-secured BFF proxy), /admin/tasks (guided admin-task wizard) and
 *  the cloud Backup & Recovery feature module: /admin/backup (start a backup),
 *  /admin/recovery (restore a backup) and /admin/backups (history).
 *  Casdoor-admin-role guarded by the host. */
export const ADMIN_ROUTES: Routes = [
  { path: '', component: AdminComponent },
  { path: 'usage', component: UsageComponent },
  { path: 'namespaces', component: NamespaceAccessComponent },
  { path: 'route-access', component: RouteAccessComponent },
  { path: 'routes', component: RouteDefinitionsComponent },
  { path: 'isos', component: IsoDownloadsComponent },
  { path: 'argocd', component: ArgocdDashboardComponent },
  { path: 'tasks', component: AdminTaskWizardComponent },
  { path: 'backup', component: BackupComponent },
  { path: 'recovery', component: RecoveryComponent },
  { path: 'backups', component: BackupHistoryComponent },
];
