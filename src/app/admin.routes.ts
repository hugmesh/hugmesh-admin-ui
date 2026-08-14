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
import { WorkloadConsoleComponent } from './workload-console/workload-console.component';
import { WorkloadLogsComponent } from './workload-console/workload-logs.component';
import { WorkloadTerminalComponent } from './workload-console/workload-terminal.component';
import { CloudBackupsComponent } from './cloud-backups/cloud-backups.component';
import { BackingServicesComponent } from './backing-services/backing-services.component';
import { ImageGenComponent } from './image-gen/image-gen.component';
import { MfaSecurityComponent } from './mfa/mfa-security.component';
import { superadminGuard } from './superadmin.guard';
import { fleetAdminGuard } from './fleet.guard';
import { gamesServicesGuard } from './games-services.guard';
import { workloadConsoleGuard } from './workload-console.guard';

/** Routes exposed by the Admin native-federation remote. The hugmesh.net
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
 *  /admin/account-appeals (the ACCOUNT-BAN appeal inbox — distinct from /admin/appeals
 *  above: approve/deny a curtailed user's own appeal against their access_suspension
 *  PROFILE ban/suspension; an approve actually restores access via
 *  SuspensionService.clear, domain-scoped, ADMIN/SUPERADMIN only), and
 *  /admin/device-licenses (the SUPERADMIN-only Device Licenses console over the
 *  device-ownership / SSH-operate-license registry — additionally superadmin-guarded; each
 *  device row also carries an "Issued SSH keys" panel to MINT/download/revoke an
 *  admin-bff-issued Ed25519 credential, step-up gated via the shared inline MFA dialog), and
 *  /admin/device-pending (the SUPERADMIN-only Pending Devices pick-list — assign a
 *  headscale-enrolled node into the registry; the machine-key fingerprint is an OPAQUE
 *  token captured from headscale, never typed/edited — additionally superadmin-guarded), and
 *  /admin/phone-fleet (the SUPERADMIN-only Phone Fleet console over the sovereign MDM phone
 *  registry — every Android phone that has ingested its provisioning snapshot; management +
 *  lockout + fleet-owner assignment, additionally superadmin-guarded), and
 *  /admin/my-fleet (the FLEET-OWNER console over the PUBLIC /bff/admin/phone-fleet plane — a
 *  non-superadmin FLEET_ADMIN/ADMIN sees + locks/unlocks ONLY their own owned devices; guarded
 *  by fleetAdminGuard, with the BFF enforcing the per-subject entitlement + owner/domain wall), and
 *  /admin/fleet-entitlements (the SUPERADMIN-only Fleet Entitlements console — grant/update/revoke
 *  a subject's FLEET_ADMIN subscription; additionally superadmin-guarded, step-up gated), and
 *  /admin/superadmin/domains (the SUPERADMIN-only Domains console over the domain_registry
 *  brand list — multi-tenancy PR9, additionally superadmin-guarded), and
 *  /admin/oidc-providers (configure which roles new users auto-receive when registering via
 *  a given OIDC identity provider — domain-scoped for admins, all-domains for superadmin), and
 *  /admin/node-storage (attach + register ADDITIONAL node-pinned storage so designated services
 *  have space on that node — ADMIN-capable, ownership-gated downstream in the BFF), and
 *  /admin/device-radios (attach a Meshtastic LoRa radio — USB serial, LoRa-WiFi TCP, or a
 *  WAN mesh via an MQTT broker — to a mesh node for the mesh↔Matrix bridge; ADMIN-capable
 *  like node-storage, ownership-gated downstream in the BFF), and
 *  /admin/domain-capabilities (the per-domain CAPABILITY GATE console — first capability
 *  'user-mesh-devices': a user may register a mesh radio under their own name only once a
 *  superadmin has GRANTED the capability to their domain AND the domain's admin has ENABLED
 *  it, plus a platform-wide kill switch. ADMIN-reachable like node-storage/device-radios;
 *  the BFF's own list scoping is what differentiates the superadmin cross-domain table from
 *  the admin own-domain toggle — no route guard needed), and
 *  /admin/egress-vpn (the SUPERADMIN-only Egress VPN console — import provider WireGuard/OpenVPN
 *  configs that nodes use for outgoing public egress, additionally superadmin-guarded), and
 *  /admin/games-services (the games app-store operator console — add/run dockerized FOSS game
 *  servers from the catalog; gated on a games-services role: ADMIN catalog-enable+create/run or
 *  RUNNER mod-delegated run/stop, behind the games-services guard), and
 *  /admin/superadmin/anubis (SUPERADMIN-only read-only view of the Anubis PoW challenge sidecar:
 *  status, configured settings, and proxied Prometheus metrics with auto-refresh — additionally
 *  superadmin-guarded), and
 *  /admin/security (the self-service Security console: enroll/list/remove your OWN MFA factors
 *  — TOTP authenticator or WebAuthn passkey — and regenerate recovery codes, over the shared
 *  hugmesh-auth-core /bff/mfa/* contract; the SAME inline step-up dialog this console uses
 *  for its own step-up-gated remove/regenerate mutations is reusable by any privileged admin
 *  action elsewhere in this app — see {@code MfaStepUpDialogComponent}).
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
  // Cloud Backups console (per-domain + superadmin TOTAL) over the bff `cloudbackup`
  // surfaces — DISTINCT from the legacy USB Backup/Recovery/Backups-history module
  // above (mirrors the bff's distinct /bff/admin/cloud-backups prefix). The TOTAL
  // tab inside is superadmin-only (hidden for an admin; the bff is authoritative).
  { path: 'cloud-backups', component: CloudBackupsComponent },
  // Managed backing-services console (SUPERADMIN-only, cross-domain infra): choose self-hosted
  // (default) vs a managed cloud equivalent per backing service. The bff
  // (/bff/superadmin/backing-services) is authoritative (SUPERADMIN + step-up + ships dark);
  // this guard is presentation-only.
  { path: 'backing-services', component: BackingServicesComponent, canActivate: [superadminGuard] },
  { path: 'announcements', component: AnnouncementListComponent },
  { path: 'test-reports', component: TestReportsComponent },
  // Image-generation console (ADMIN/SUPERADMIN) over the bff `imagegen` surfaces
  // (/bff/admin/image-builds). Trigger a build, stream SSE progress, download the
  // image and (only when ssh_keys_allowed + step-up) the non-secret keys bundle.
  // Capability-gated on the x86 build node + ships dark when the generator is disabled.
  { path: 'image-gen', component: ImageGenComponent },
  { path: 'forum', component: ForumAdminComponent },
  { path: 'appeals', component: AppealsComponent },
  { path: 'account-appeals', component: AccountAppealsComponent },
  // Self-service Security console: enroll/list/remove your OWN MFA factors (TOTP +
  // WebAuthn passkey) and regenerate recovery codes, over the shared hugmesh-auth-core
  // /bff/mfa/* contract (the same one login-ui's /login/security already uses). ANY
  // authenticated admin/superadmin may reach it (no additional guard) — the BFF is the
  // authoritative owner scope (a caller only ever sees/mutates their own factors).
  { path: 'security', component: MfaSecurityComponent },
  { path: 'device-licenses', component: DeviceLicensesComponent, canActivate: [superadminGuard] },
  { path: 'device-pending', component: DevicePendingComponent, canActivate: [superadminGuard] },
  { path: 'phone-fleet', component: PhoneFleetComponent, canActivate: [superadminGuard] },
  // Fleet-OWNER surface (PUBLIC /bff/admin/phone-fleet plane) — a non-superadmin FLEET_ADMIN/
  // ADMIN manages ONLY their own owned phones. Guarded by fleetAdminGuard (fleet_admin/admin/
  // superadmin); the BFF enforces the per-subject entitlement + owner-within-domain wall.
  { path: 'my-fleet', component: MyFleetComponent, canActivate: [fleetAdminGuard] },
  // Fleet-entitlement admin (SUPERADMIN) — grant/update/revoke the FLEET_ADMIN subscription.
  { path: 'fleet-entitlements', component: FleetEntitlementsComponent, canActivate: [superadminGuard] },
  { path: 'node-storage', component: StoragePoolsComponent },
  { path: 'device-radios', component: DeviceRadiosComponent },
  { path: 'domain-capabilities', component: DomainCapabilitiesComponent },
  { path: 'egress-vpn', component: EgressVpnComponent, canActivate: [superadminGuard] },
  { path: 'superadmin/domains', component: SuperadminDomainsComponent, canActivate: [superadminGuard] },
  { path: 'oidc-providers', component: OidcProviderRolesComponent },
  { path: 'desktop', component: DesktopGovernanceComponent },
  { path: 'games-services', component: GamesServicesComponent, canActivate: [gamesServicesGuard] },
  { path: 'superadmin/anubis', component: AnubisAdminComponent, canActivate: [superadminGuard] },
  // ── WORKLOAD CONSOLE (HIDDEN tier) ──────────────────────────────────────────────
  // Registered but NEVER auto-surfaced in the menu (the host loads it only when the
  // grant guard passes — a server-confirmed capability probe that 404s on deny). The
  // logs/terminal sub-routes are the SUPERADMIN DANGEROUS surfaces (the BFF re-enforces
  // SA + step-up + dangerous-tier on each).
  { path: 'workloads', component: WorkloadConsoleComponent, canActivate: [workloadConsoleGuard] },
  { path: 'workloads/logs', component: WorkloadLogsComponent, canActivate: [workloadConsoleGuard] },
  { path: 'workloads/terminal', component: WorkloadTerminalComponent, canActivate: [workloadConsoleGuard] },
];
