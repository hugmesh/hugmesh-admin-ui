import { Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Announcement, AnnouncementsStore } from './announcements.service';
import { AnnouncementEditorComponent } from './announcement-editor.component';

/**
 * Admin "Announcements" management view (ROLE_ADMIN only, route-guarded). Lists
 * every announcement (all states) with its schedule, lifecycle state and the
 * surfaces it targets, and lets an admin CREATE / EDIT / DELETE them via the
 * embedded {@link AnnouncementEditorComponent}. Whether an announcement is
 * currently LIVE on a surface (= published AND inside [starts_at, ends_at] AND the
 * surface flag true) is computed client-side for an at-a-glance "active now" badge;
 * the per-surface BFF read endpoints apply the authoritative ACTIVE rule.
 *
 * a11y: a labelled table of announcements; each row has Edit/Delete `<button>`s;
 * a confirm-before-delete guard; errors announced in a `role=alert` live region.
 */
@Component({
  selector: 'hug-announcement-list',
  standalone: true,
  imports: [CommonModule, AnnouncementEditorComponent],
  templateUrl: './announcement-list.component.html',
  styleUrl: './announcement-list.component.scss',
})
export class AnnouncementListComponent implements OnInit {
  readonly store = inject(AnnouncementsStore);

  private readonly editor = viewChild(AnnouncementEditorComponent);

  /** The id pending a delete confirmation (two-step delete), or null. */
  readonly confirmingDelete = signal<string | null>(null);
  readonly error = signal<string>('');

  /** The surfaces shown as per-row badges, in the same order as the editor. */
  readonly surfaces = this.store.surfaces;

  /** The announcements, sorted for display (priority desc, newest first). */
  readonly rows = computed(() => this.store.sorted());

  async ngOnInit(): Promise<void> {
    await this.store.refresh();
  }

  /** True when the announcement is LIVE right now (published + in-window). */
  isActive(a: Announcement): boolean {
    if (a.state !== 'published') return false;
    const now = Date.now();
    if (a.starts_at && new Date(a.starts_at).getTime() > now) return false;
    if (a.ends_at && new Date(a.ends_at).getTime() < now) return false;
    return true;
  }

  /** The target flags an announcement carries, as surface labels (for the badges). */
  targetLabels(a: Announcement): string[] {
    return this.surfaces
      .filter((s) => (a as unknown as Record<string, boolean>)[s.key as string])
      .map((s) => s.label);
  }

  /** Begin editing an existing announcement in the embedded editor. */
  edit(a: Announcement): void {
    this.confirmingDelete.set(null);
    this.editor()?.edit(a);
    this.scrollToEditor();
  }

  /** Start a fresh announcement in the embedded editor. */
  newAnnouncement(): void {
    this.confirmingDelete.set(null);
    this.editor()?.reset();
    this.scrollToEditor();
  }

  /** First click arms the confirm; second (confirm) actually deletes. */
  askDelete(a: Announcement): void {
    this.confirmingDelete.set(a.id);
  }
  cancelDelete(): void { this.confirmingDelete.set(null); }

  async confirmDelete(a: Announcement): Promise<void> {
    this.error.set('');
    try {
      await this.store.remove(a.id);
      this.confirmingDelete.set(null);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'The announcement could not be deleted.');
    }
  }

  private scrollToEditor(): void {
    queueMicrotask(() => {
      document.querySelector('[data-testid="announcement-editor"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}
