import { Injectable, inject, signal } from '@angular/core';
import {
  BffService,
  ForumBanRequest,
  ForumCategoryRequest,
  ForumEnvelope,
  ForumGroupRequest,
  ForumInstallRequest,
} from '../bff.service';

/**
 * Datastore for the admin Forum console (ROLE_ADMIN only). A single signal-backed
 * service (the platform datastore standard) over the admin-bff
 * {@code /bff/admin/forum/**} proxy of the phpBB ACP. Every BFF response is the
 * {@code ForumOutcome.asResponse()} envelope — the returned payload merged with a
 * {@code result} marker ({@code ok} | {@code stubbed} | {@code degraded:<reason>}) —
 * so the store keeps the latest envelope per section AND a human note (last action
 * result) the console surfaces in a role=status / role=alert live region.
 *
 * <p>The forum content shapes (stats / users / categories / queue) are STUBBED until
 * the forum-bff seam is wired on, so they are read as opaque {@code Record} maps; the
 * console renders the {@code result} marker honestly rather than inventing a table.
 */
@Injectable({ providedIn: 'root' })
export class ForumAdminStore {
  private readonly bff = inject(BffService);

  readonly stats = signal<ForumEnvelope | null>(null);
  readonly users = signal<ForumEnvelope | null>(null);
  readonly categories = signal<ForumEnvelope | null>(null);
  readonly moderationQueue = signal<ForumEnvelope | null>(null);
  readonly audit = signal<ForumEnvelope | null>(null);

  /** Result note from the most recent mutating action (ok / stubbed / degraded). */
  readonly note = signal('');
  /** A hard error from a mutating action (the BFF returned {error}). Empty = none. */
  readonly error = signal('');

  // ── loads (GET) ────────────────────────────────────────────────────────
  async refreshStats(): Promise<void> { this.stats.set(await this.bff.forumStats()); }
  async refreshUsers(): Promise<void> { this.users.set(await this.bff.forumUsers()); }
  async refreshCategories(): Promise<void> { this.categories.set(await this.bff.forumCategories()); }
  async refreshModerationQueue(): Promise<void> { this.moderationQueue.set(await this.bff.forumModerationQueue()); }
  async refreshAudit(): Promise<void> { this.audit.set(await this.bff.forumAudit()); }

  async refreshAll(): Promise<void> {
    await Promise.all([
      this.refreshStats(),
      this.refreshUsers(),
      this.refreshCategories(),
      this.refreshModerationQueue(),
      this.refreshAudit(),
    ]);
  }

  // ── mutations ──────────────────────────────────────────────────────────
  async ban(id: string, req: ForumBanRequest): Promise<void> {
    await this.mutate(() => this.bff.forumBan(id, req), this.refreshUsers());
  }
  async unban(id: string): Promise<void> {
    await this.mutate(() => this.bff.forumUnban(id), this.refreshUsers());
  }
  async assignGroup(id: string, req: ForumGroupRequest): Promise<void> {
    await this.mutate(() => this.bff.forumAssignGroup(id, req), this.refreshUsers());
  }
  async createCategory(req: ForumCategoryRequest): Promise<void> {
    await this.mutate(() => this.bff.forumCreateCategory(req), this.refreshCategories());
  }
  async approve(id: string): Promise<void> {
    await this.mutate(() => this.bff.forumApprove(id), this.refreshModerationQueue());
  }
  async reject(id: string): Promise<void> {
    await this.mutate(() => this.bff.forumReject(id), this.refreshModerationQueue());
  }
  async installStyle(req: ForumInstallRequest): Promise<void> {
    await this.mutate(() => this.bff.forumInstallStyle(req));
  }
  async installExtension(req: ForumInstallRequest): Promise<void> {
    await this.mutate(() => this.bff.forumInstallExtension(req));
  }

  /** Run a mutating call, set the honest result note, then refresh the section. */
  private async mutate(call: () => Promise<ForumEnvelope>, refresh?: Promise<void>): Promise<void> {
    this.error.set('');
    this.note.set('');
    try {
      const env = await call();
      this.note.set(noteFor(env));
      if (refresh) await refresh;
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'The forum action failed.');
    }
  }
}

/** A human, AT-friendly note for a ForumOutcome envelope's {@code result} marker. */
export function noteFor(env: ForumEnvelope | null): string {
  const result = (env?.result as string) ?? '';
  if (result === 'ok') return 'Done.';
  if (result === 'stubbed') {
    return 'Recorded — the forum service is not connected yet, so it will be applied once enabled.';
  }
  if (result.startsWith('degraded:')) {
    return `The forum service is degraded (${result.slice('degraded:'.length)}); the change is queued for reconcile.`;
  }
  return '';
}
