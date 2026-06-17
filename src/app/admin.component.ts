import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { BffService } from './bff.service';
import { SessionService } from './session.service';

/** One admin own-component module surfaced in the admin menu. A `superadminOnly`
 *  item is hidden from the menu unless the session carries the superadmin role. */
interface AdminMenuItem { path: string; label: string; superadminOnly?: boolean; }

/**
 * Admin micro-frontend (own repo: snapdragon-admin-ui). Visible only to Casdoor
 * ROLE_ADMIN users (route-guarded). Manages the registration allowlist by Gmail
 * address OR Discord username, calling the Spring admin API behind the gateway,
 * which invites the identity in Casdoor via the snapdragon-pki gateway.
 *
 * <p>This landing view also carries the admin MENU — the nav that surfaces every
 * admin own-component module (usage, namespaces, route-access, routes, ISOs,
 * ArgoCD, tasks, and the cloud Backup &amp; Recovery module) as routerLinks, so a
 * module like Backup is reachable from a menu entry consistent with how the other
 * admin modules are surfaced.
 */
@Component({
  selector: 'snap-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent implements OnInit {
  private readonly bff = inject(BffService);
  private readonly session = inject(SessionService);

  /** The full admin menu (routerLinks relative to the /admin mount point). The
   *  superadmin-only Device licenses console is appended last. */
  private readonly allMenu: ReadonlyArray<AdminMenuItem> = [
    { path: 'usage', label: 'Usage analytics' },
    { path: 'namespaces', label: 'Namespace access' },
    { path: 'delegation', label: 'Delegation & access roles' },
    { path: 'route-access', label: 'Route access' },
    { path: 'routes', label: 'Route definitions' },
    { path: 'isos', label: 'ISO downloads' },
    { path: 'argocd', label: 'ArgoCD' },
    { path: 'tasks', label: 'Guided tasks' },
    { path: 'backup', label: 'Backup' },
    { path: 'recovery', label: 'Recovery' },
    { path: 'backups', label: 'Backups history' },
    { path: 'announcements', label: 'Announcements' },
    { path: 'test-reports', label: 'Test reports' },
    { path: 'forum', label: 'Forum admin' },
    { path: 'appeals', label: 'Appeals' },
    { path: 'device-licenses', label: 'Device licenses', superadminOnly: true },
    { path: 'node-storage', label: 'Node storage' },
    { path: 'egress-vpn', label: 'Egress VPN', superadminOnly: true },
    { path: 'superadmin/domains', label: 'Domains', superadminOnly: true },
  ];

  /** The menu the current session may see: superadmin-only items appear only for a
   *  superadmin (defence-in-depth — the route itself is superadmin-guarded too). */
  readonly menu = computed(() =>
    this.allMenu.filter((item) => !item.superadminOnly || this.session.isSuperadmin()));

  email = '';
  discord = '';
  readonly emails = signal<string[]>([]);
  readonly discordUsers = signal<string[]>([]);
  /** Inline validation messages surfaced in role=alert live regions. Empty = valid. */
  readonly emailError = signal('');
  readonly discordError = signal('');

  async ngOnInit(): Promise<void> { this.refresh(await this.bff.allowlist()); }
  private refresh(a: { emails: string[]; discord: string[] }): void {
    this.emails.set(a.emails); this.discordUsers.set(a.discord);
  }
  async inviteEmail(): Promise<void> {
    if (!this.email.trim()) { this.emailError.set('Enter a Gmail address to invite.'); return; }
    this.emailError.set('');
    this.refresh(await this.bff.invite('email', this.email.trim().toLowerCase())); this.email = '';
  }
  async inviteDiscord(): Promise<void> {
    if (!this.discord.trim()) { this.discordError.set('Enter a Discord username to invite.'); return; }
    this.discordError.set('');
    this.refresh(await this.bff.invite('discord', this.discord.trim().toLowerCase())); this.discord = '';
  }
}
