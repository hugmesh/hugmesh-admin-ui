import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { BffService } from './bff.service';
import { SessionService } from './session.service';

/** One admin own-component module surfaced in the admin menu. A `superadminOnly`
 *  item is hidden from the menu unless the session carries the superadmin role; a
 *  `fleetOnly` item is shown only when the session carries the fleet capability
 *  (fleet_admin/admin/superadmin — see {@link SessionService.isFleetAdmin}); a
 *  `hidden` item belongs to the HIDDEN tier — it is surfaced ONLY when a server-confirmed
 *  capability probe passes (e.g. the Workload Console, gated on an active grant). */
interface AdminMenuItem { path: string; label: string; superadminOnly?: boolean; fleetOnly?: boolean; hidden?: boolean; }

/**
 * Admin micro-frontend (own repo: hugmesh-admin-ui). Visible only to Casdoor
 * ROLE_ADMIN users (route-guarded). Manages the registration allowlist by Gmail
 * address OR Discord username, calling the Spring admin API behind the gateway,
 * which invites the identity in Casdoor via the hugmesh-pki gateway.
 *
 * <p>This landing view also carries the admin MENU — the nav that surfaces every
 * admin own-component module (usage, namespaces, route-access, routes, ISOs,
 * ArgoCD, tasks, and the cloud Backup &amp; Recovery module) as routerLinks, so a
 * module like Backup is reachable from a menu entry consistent with how the other
 * admin modules are surfaced.
 */
@Component({
  selector: 'hug-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent implements OnInit {
  private readonly bff = inject(BffService);
  private readonly session = inject(SessionService);

  /**
   * The full admin menu, including items that are hidden for the current session. Filtered
   * at template time by the `menu` computed so only presentable items are rendered.
   *
   * - Regular items: visible to any ROLE_ADMIN session.
   * - `superadminOnly` items: hidden from an ADMIN — visible only to ROLE_SUPERADMIN.
   * - `fleetOnly` items: visible only to a session with the fleet capability
   *   (fleet_admin/admin/superadmin — the "My fleet" owner console).
   * - `hidden` items: the HIDDEN tier — only surfaced when a server-confirmed capability probe
   *   passes (the workload console is the first example; the route guard is the authoritative gate).
   */
  private readonly allMenu: ReadonlyArray<AdminMenuItem> = [
    { path: 'usage', label: 'Usage analytics' },
    { path: 'namespaces', label: 'Namespace access' },
    { path: 'delegation', label: 'Delegation & access roles' },
    { path: 'roles', label: 'Roles' },
    { path: 'route-access', label: 'Route access' },
    { path: 'routes', label: 'Route definitions' },
    { path: 'isos', label: 'ISO downloads' },
    { path: 'argocd', label: 'ArgoCD' },
    { path: 'tasks', label: 'Guided tasks' },
    { path: 'backup', label: 'Backup' },
    { path: 'recovery', label: 'Recovery' },
    { path: 'backups', label: 'Backups history' },
    { path: 'cloud-backups', label: 'Cloud backups' },
    { path: 'announcements', label: 'Announcements' },
    { path: 'themes', label: 'Themes' },
    { path: 'test-reports', label: 'Test reports' },
    { path: 'image-gen', label: 'Image generation' },
    { path: 'forum', label: 'Forum admin' },
    { path: 'appeals', label: 'Appeals' },
    { path: 'account-appeals', label: 'Account appeals' },
    { path: 'security', label: 'Security (2FA)' },
    { path: 'device-licenses', label: 'Device licenses', superadminOnly: true },
    { path: 'device-pending', label: 'Pending devices', superadminOnly: true },
    { path: 'phone-fleet', label: 'Phone fleet', superadminOnly: true },
    { path: 'my-fleet', label: 'My fleet', fleetOnly: true },
    { path: 'fleet-entitlements', label: 'Fleet entitlements', superadminOnly: true },
    { path: 'node-storage', label: 'Node storage' },
    { path: 'device-radios', label: 'Device radios' },
    { path: 'domain-capabilities', label: 'Domain capabilities' },
    { path: 'desktop', label: 'Desktop governance' },
    { path: 'egress-vpn', label: 'Egress VPN', superadminOnly: true },
    { path: 'superadmin/domains', label: 'Domains', superadminOnly: true },
    // HIDDEN tier — surfaced ONLY when the server-confirmed workload capability probe passes.
    { path: 'workloads', label: 'Workload console', hidden: true },
  ];

  /** Whether the HIDDEN-tier Workload Console is visible to this session — set from the
   *  server-confirmed capability probe (200 = live grant/role; 404 = dark/denied). The
   *  route is ALSO grant-guarded, so this only governs the menu's discoverability. */
  readonly workloadVisible = signal(false);

  /** The menu the current session may see: superadmin-only items appear only for a
   *  superadmin (defence-in-depth — the route itself is superadmin-guarded too); HIDDEN-tier
   *  items appear only when their server-confirmed capability is present. */
  readonly menu = computed(() =>
    this.allMenu.filter((item) => {
      if (item.superadminOnly && !this.session.isSuperadmin()) return false;
      if (item.fleetOnly && !this.session.isFleetAdmin()) return false;
      if (item.hidden && !this.workloadVisible()) return false;
      return true;
    }));

  /** Gmail address input for the allowlist invite form (ngModel-bound plain property). */
  email = '';
  /** Discord username input for the allowlist invite form (ngModel-bound plain property). */
  discord = '';
  /** Current email allowlist entries, loaded from `GET /bff/admin/allowlist`. */
  readonly emails = signal<string[]>([]);
  /** Current Discord username allowlist entries. */
  readonly discordUsers = signal<string[]>([]);
  /**
   * Inline validation messages surfaced in `role=alert` aria-live regions.
   * An empty string means no error (the region is hidden from AT when empty).
   */
  readonly emailError = signal('');
  /** Inline Discord validation message — surfaced in an aria-live region. */
  readonly discordError = signal('');

  async ngOnInit(): Promise<void> {
    // Load the current allowlist on init so the existing entries are shown immediately.
    this.refresh(await this.bff.allowlist());
    // HIDDEN-tier discovery: probe the workload-console capability (404 on deny = stays
    // hidden). Best-effort + defensive — a probe error never breaks the menu.
    try {
      const cap = await this.bff.workloadCapability();
      this.workloadVisible.set(cap !== null);
    } catch {
      // If the probe throws, treat it as absent — never let a network error reveal the feature.
      this.workloadVisible.set(false);
    }
  }

  /**
   * Replace the in-memory allowlist state from the BFF response. Called after every
   * mutating BFF call (invite) to keep the displayed list in sync without a full reload.
   *
   * @param a - The updated allowlist returned by the BFF.
   */
  private refresh(a: { emails: string[]; discord: string[] }): void {
    this.emails.set(a.emails); this.discordUsers.set(a.discord);
  }

  /**
   * Invite a Gmail address to the registration allowlist (`POST /bff/admin/allowlist/invite`).
   * Normalises the input to lowercase before sending (Casdoor subject comparison is lowercase).
   * Refreshes the allowlist from the BFF response.
   */
  async inviteEmail(): Promise<void> {
    if (!this.email.trim()) { this.emailError.set('Enter a Gmail address to invite.'); return; }
    this.emailError.set('');
    this.refresh(await this.bff.invite('email', this.email.trim().toLowerCase())); this.email = '';
  }

  /**
   * Invite a Discord username to the registration allowlist (`POST /bff/admin/allowlist/invite`).
   * Normalises the input to lowercase before sending.
   * Refreshes the allowlist from the BFF response.
   */
  async inviteDiscord(): Promise<void> {
    if (!this.discord.trim()) { this.discordError.set('Enter a Discord username to invite.'); return; }
    this.discordError.set('');
    this.refresh(await this.bff.invite('discord', this.discord.trim().toLowerCase())); this.discord = '';
  }
}
