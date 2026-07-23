import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ForumGroupRequest } from '../bff.service';
import { ForumAdminStore } from './forum-admin-store.service';
import { RovingFocusDirective } from '../a11y/roving-focus.directive';

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
  selector: 'hug-forum-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, RovingFocusDirective],
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

  /**
   * The phpBB group names available for assignment. Maps directly to the
   * `ForumGroupRequest.group` union (`ADMINISTRATORS | GLOBAL_MODERATORS | REGISTERED`).
   */
  readonly groups: ForumGroupRequest['group'][] = ['ADMINISTRATORS', 'GLOBAL_MODERATORS', 'REGISTERED'];

  // ── User management form ────────────────────────────────────────────────
  /** The forum user id to ban/lift ban or assign a group (ngModel-bound plain property). */
  banUserId = '';
  /** Optional ban reason stored on the phpBB user record. */
  banReason = '';
  /** The forum user id to assign a group (may differ from `banUserId`). */
  groupUserId = '';
  /** The phpBB group to assign the user to (defaults to the safest: REGISTERED). */
  group: ForumGroupRequest['group'] = 'REGISTERED';
  /** Inline validation error for user management — `role=alert` live region. */
  readonly userFormError = signal('');

  // ── Category form ───────────────────────────────────────────────────────
  /** Name of the forum category to create. */
  catName = '';
  /** Optional description shown under the category in phpBB. */
  catDescription = '';
  /** Optional parent category id (blank = top-level). Validated as a non-negative integer. */
  catParentId = '';
  /** Inline validation error for the category form — `role=alert` live region. */
  readonly catFormError = signal('');

  // ── Styles / extensions form ────────────────────────────────────────────
  /** Name of the phpBB style to install (style name, NOT a URL). */
  styleName = '';
  /** Name of the phpBB extension to install (extension name, NOT a URL). */
  extensionName = '';
  /** Inline validation error for the styles / extensions form — `role=alert` live region. */
  readonly installError = signal('');

  // ── Moderation form ─────────────────────────────────────────────────────
  /** The moderation queue item id to approve or reject. */
  moderationId = '';

  async ngOnInit(): Promise<void> {
    // Load all forum admin surfaces in parallel.
    await this.store.refreshAll();
  }

  /**
   * Switch the active sub-tab.
   *
   * @param tab - The tab id to make active.
   */
  select(tab: Tab): void {
    this.tab.set(tab);
  }

  /**
   * Pretty-print an opaque forum outcome envelope for display. Strips the `result`
   * marker (which is shown separately as a badge) so only the domain payload remains.
   * Returns an empty string when the envelope is null or has no extra fields.
   *
   * @param env - The opaque outcome envelope from the ForumOutcome record.
   * @returns A pretty-printed JSON string, or `''` when empty.
   */
  pretty(env: Record<string, unknown> | null): string {
    if (!env) return '';
    const { result: _result, ...rest } = env;
    return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '';
  }

  // ── users ──────────────────────────────────────────────────────────────
  /**
   * Ban a forum user (`POST /bff/admin/forum/users/{id}/ban`). The reason is optional;
   * the ban is lifted via {@link unban}. Validates that a user id is entered before calling.
   */
  async ban(): Promise<void> {
    if (!this.banUserId.trim()) { this.userFormError.set('Enter a forum user id to ban.'); return; }
    this.userFormError.set('');
    await this.store.ban(this.banUserId.trim(), { reason: this.banReason.trim() || null });
    this.banReason = '';
  }

  /**
   * Lift a forum user ban (`DELETE /bff/admin/forum/users/{id}/ban`).
   * Uses the same `banUserId` field — the admin enters the id and picks lift vs ban.
   */
  async unban(): Promise<void> {
    if (!this.banUserId.trim()) { this.userFormError.set('Enter a forum user id to lift the ban for.'); return; }
    this.userFormError.set('');
    await this.store.unban(this.banUserId.trim());
  }

  /**
   * Assign a phpBB group to a forum user (`POST /bff/admin/forum/users/{id}/group`).
   * The `group` field is the selected group (ADMINISTRATORS | GLOBAL_MODERATORS | REGISTERED).
   */
  async assignGroup(): Promise<void> {
    if (!this.groupUserId.trim()) { this.userFormError.set('Enter a forum user id to assign a group.'); return; }
    this.userFormError.set('');
    await this.store.assignGroup(this.groupUserId.trim(), { group: this.group });
  }

  // ── categories ─────────────────────────────────────────────────────────
  /**
   * Create a forum category (`POST /bff/admin/forum/categories`). `parentId` is
   * optional (blank = top-level); validates that it is a non-negative integer when provided.
   * The `catFormError` signal is surfaced in a `role=alert` live region.
   */
  async createCategory(): Promise<void> {
    if (!this.catName.trim()) { this.catFormError.set('Enter a forum name.'); return; }
    this.catFormError.set('');
    const parentId = this.catParentId.trim() ? Number(this.catParentId.trim()) : null;
    // A negative or non-integer parent id is not a valid phpBB category reference.
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
  /**
   * Approve a moderation queue item (`POST /bff/admin/forum/moderation/{id}/approve`).
   * Clears the id field after submitting. A blank id is a no-op (template guards the button).
   */
  async approve(): Promise<void> {
    if (!this.moderationId.trim()) return;
    await this.store.approve(this.moderationId.trim());
    this.moderationId = '';
  }

  /**
   * Reject a moderation queue item (`POST /bff/admin/forum/moderation/{id}/reject`).
   * Clears the id field after submitting.
   */
  async reject(): Promise<void> {
    if (!this.moderationId.trim()) return;
    await this.store.reject(this.moderationId.trim());
    this.moderationId = '';
  }

  // ── styles / extensions ────────────────────────────────────────────────
  /**
   * Install a phpBB style (`POST /bff/admin/forum/styles`).
   * Validates that a style name is entered. The name is the phpBB style identifier, not a URL.
   */
  async installStyle(): Promise<void> {
    if (!this.styleName.trim()) { this.installError.set('Enter a style name.'); return; }
    this.installError.set('');
    await this.store.installStyle({ name: this.styleName.trim() });
    this.styleName = '';
  }

  /**
   * Install a phpBB extension (`POST /bff/admin/forum/extensions`).
   * Validates that an extension name is entered. ADMIN-only on the BFF side.
   */
  async installExtension(): Promise<void> {
    if (!this.extensionName.trim()) { this.installError.set('Enter an extension name.'); return; }
    this.installError.set('');
    await this.store.installExtension({ name: this.extensionName.trim() });
    this.extensionName = '';
  }
}
