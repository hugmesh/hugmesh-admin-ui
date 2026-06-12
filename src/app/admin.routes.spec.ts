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
import { ForumAdminComponent } from './forum-admin/forum-admin.component';
import { AppealsComponent } from './appeals/appeals.component';
import { DeviceLicensesComponent } from './device-licenses.component';
import { superadminGuard } from './superadmin.guard';

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
    expect(byPath('forum')!.component).toBe(ForumAdminComponent);
    expect(byPath('appeals')!.component).toBe(AppealsComponent);
    expect(byPath('device-licenses')!.component).toBe(DeviceLicensesComponent);
  });

  it('exposes exactly the seventeen admin views the host expects (incl. delegation + appeals + device-licenses)', () => {
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
      'announcements',
      'test-reports',
      'forum',
      'appeals',
      'device-licenses',
    ]);
  });

  it('superadmin-gates the device-licenses console (additive, behind the superadmin guard)', () => {
    expect(byPath('device-licenses')!.canActivate).toEqual([superadminGuard]);
  });

  it('exposes the appeals console as a plain ADMIN route (no superadmin guard)', () => {
    const appeals = byPath('appeals');
    expect(appeals).toBeDefined();
    expect(appeals!.component).toBe(AppealsComponent);
    expect(appeals!.canActivate).toBeUndefined();
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
