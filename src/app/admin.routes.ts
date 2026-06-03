import { Routes } from '@angular/router';
import { AdminComponent } from './admin.component';
import { UsageComponent } from './usage.component';
import { NamespaceAccessComponent } from './namespace-access.component';
import { RouteAccessComponent } from './route-access.component';
import { IsoDownloadsComponent } from './iso-downloads.component';

/** Routes exposed by the Admin native-federation remote. The snapdragon.systems
 *  host mounts these at /admin, so they resolve to /admin (allowlist),
 *  /admin/usage (ClickHouse usage dashboard), /admin/namespaces (namespace
 *  access grants), /admin/route-access (per-gateway role→URL rules) and
 *  /admin/isos (CI ISO downloads). Casdoor-admin-role guarded by the host. */
export const ADMIN_ROUTES: Routes = [
  { path: '', component: AdminComponent },
  { path: 'usage', component: UsageComponent },
  { path: 'namespaces', component: NamespaceAccessComponent },
  { path: 'route-access', component: RouteAccessComponent },
  { path: 'isos', component: IsoDownloadsComponent },
];
