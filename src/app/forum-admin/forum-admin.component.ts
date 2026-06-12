import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ForumGroupRequest } from '../bff.service';
import { ForumAdminStore } from './forum-admin-store.service';

type Tab = 'stats' | 'users' | 'categories' | 'moderation' | 'styles' | 'audit';

/**
 * Admin "Forum admin" console (ROLE_ADMIN only, route-guarded). The single seam
 * onto the full phpBB ACP capability via the admin-bff ForumAdminController proxy
 * ({@code /bff/admin/forum/**}): stats / usage, user management + reversible ban,
 * group assignment, category create, the moderation queue (approve / reject), style
 * and extension install (ADMIN-only), and the audit log.
 *
 * <p>Admin gating is defence-in-depth (gateway + resource-server filter +
 * @PreAuthorize, and forum-bff re-derives ROLE_ADMIN from the JWT); this UI mirrors
 * it but the admin-bff is the source of truth. Forum content is read as the opaque
 * ForumOutcome envelope (STUBBED until the forum-bff seam is wired), so the console
 * surfaces the honest {@code result} marker rather than inventing data.
 */
@Component({
  selector: 'snap-forum-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './forum-admin.component.html',
  styleUrl: './forum-admin.component.scss',
})
export class ForumAdminComponent implements OnInit {
  readonly store = inject(ForumAdminStore);

  readonly tabs: ReadonlyArray<{ id: Tab; label: string }> = [
    { id: 'stats', label: 'Stats' },
    { id: 'users', label: 'Users' },
    { id: 'categories', label: 'Categories' },
    { id: 'moderation', label: 'Moderation queue' },
    { id: 'styles', label: 'Styles & extensions' },
    { id: 'audit', label: 'Audit' },
  ];
  readonly tab = signal<Tab>('stats');

  readonly groups: ForumGroupRequest['group'][] = ['ADMINISTRATORS', 'GLOBAL_MODERATORS', 'REGISTERED'];

  // user management form
  banUserId = '';
  banReason = '';
  groupUserId = '';
  group: ForumGroupRequest['group'] = 'REGISTERED';
  readonly userFormError = signal('');

  // category form
  catName = '';
  catDescription = '';
  catParentId = '';
  readonly catFormError = signal('');

  // styles / extensions form
  styleName = '';
  extensionName = '';
  readonly installError = signal('');

  // moderation form
  moderationId = '';

  async ngOnInit(): Promise<void> {
    await this.store.refreshAll();
  }

  select(tab: Tab): void {
    this.tab.set(tab);
  }

  /** Pretty-print an opaque forum envelope (minus the result marker) for display. */
  pretty(env: Record<string, unknown> | null): string {
    if (!env) return '';
    const { result: _result, ...rest } = env;
    return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '';
  }

  // ── users ──────────────────────────────────────────────────────────────
  async ban(): Promise<void> {
    if (!this.banUserId.trim()) { this.userFormError.set('Enter a forum user id to ban.'); return; }
    this.userFormError.set('');
    await this.store.ban(this.banUserId.trim(), { reason: this.banReason.trim() || null });
    this.banReason = '';
  }
  async unban(): Promise<void> {
    if (!this.banUserId.trim()) { this.userFormError.set('Enter a forum user id to lift the ban for.'); return; }
    this.userFormError.set('');
    await this.store.unban(this.banUserId.trim());
  }
  async assignGroup(): Promise<void> {
    if (!this.groupUserId.trim()) { this.userFormError.set('Enter a forum user id to assign a group.'); return; }
    this.userFormError.set('');
    await this.store.assignGroup(this.groupUserId.trim(), { group: this.group });
  }

  // ── categories ─────────────────────────────────────────────────────────
  async createCategory(): Promise<void> {
    if (!this.catName.trim()) { this.catFormError.set('Enter a forum name.'); return; }
    this.catFormError.set('');
    const parentId = this.catParentId.trim() ? Number(this.catParentId.trim()) : null;
    if (parentId !== null && (!Number.isInteger(parentId) || parentId < 0)) {
      this.catFormError.set('Parent id must be a whole number.');
      return;
    }
    await this.store.createCategory({
      name: this.catName.trim(),
      description: this.catDescription.trim() || null,
      parentId,
    });
    this.catName = '';
    this.catDescription = '';
    this.catParentId = '';
  }

  // ── moderation ─────────────────────────────────────────────────────────
  async approve(): Promise<void> {
    if (!this.moderationId.trim()) return;
    await this.store.approve(this.moderationId.trim());
    this.moderationId = '';
  }
  async reject(): Promise<void> {
    if (!this.moderationId.trim()) return;
    await this.store.reject(this.moderationId.trim());
    this.moderationId = '';
  }

  // ── styles / extensions ────────────────────────────────────────────────
  async installStyle(): Promise<void> {
    if (!this.styleName.trim()) { this.installError.set('Enter a style name.'); return; }
    this.installError.set('');
    await this.store.installStyle({ name: this.styleName.trim() });
    this.styleName = '';
  }
  async installExtension(): Promise<void> {
    if (!this.extensionName.trim()) { this.installError.set('Enter an extension name.'); return; }
    this.installError.set('');
    await this.store.installExtension({ name: this.extensionName.trim() });
    this.extensionName = '';
  }
}
