import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SessionService } from '../session.service';
import {
  DomainThemesStore, RAMPS, STYLES, DECORS, ThemeRow, MESH_DEFAULT_SEGMENT,
} from './domain-themes.service';

/**
 * Admin "Themes" view — set a different theme per domain (ROLE_ADMIN, route-guarded).
 *
 * WHO SEES WHAT is decided by the BFF, not here: a superadmin's list comes back with
 * every domain plus the mesh default, a domain admin's with their own row and the default
 * they inherit. This component renders what it was given and does not filter, because a
 * UI that hid rows would only be duplicating a rule that has already drifted once on this
 * platform (the shell offered Moderation while the gateway refused it). The Edit control
 * is disabled where `canManage` would refuse, purely so the operator is not invited to
 * fail — and a 403 is still reported in words if they get there anyway.
 *
 * THE UN-THEMED WARNING is the part worth keeping. This editor cannot derive CSS (the
 * colour maths has one implementation, in the Studio), so saving a CHANGED selection
 * clears the stored stylesheet and the domain renders the shipped chrome until the Studio
 * re-renders it. That is stated before the save, not discovered on the live page.
 *
 * a11y: a labelled table; per-row buttons; the editor is a fieldset with labelled
 * controls; errors and the pending-change warning are announced in `role=alert` regions;
 * a two-step confirm guards Clear.
 */
@Component({
  selector: 'hug-domain-themes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './domain-themes.component.html',
  styleUrl: './domain-themes.component.scss',
})
export class DomainThemesComponent implements OnInit {
  readonly store = inject(DomainThemesStore);
  private readonly session = inject(SessionService);

  readonly ramps = RAMPS;
  readonly styles = STYLES;
  readonly decors = DECORS;
  readonly meshDefaultSegment = MESH_DEFAULT_SEGMENT;

  /** The row being edited (its domain key), or null when the editor is closed. */
  readonly editing = signal<string | null>(null);
  /** The row pending a clear confirmation (two-step), or null. */
  readonly confirmingClear = signal<string | null>(null);
  readonly saving = signal(false);

  // The working copy. Kept separate from the store so an abandoned edit changes nothing.
  readonly draftPreset = signal('');
  readonly draftRamp = signal<string>('dark');
  readonly draftStyle = signal<string>('soft');
  readonly draftDecor = signal<string>('none');
  readonly draftPrimary = signal('');
  readonly draftSecondary = signal('');

  /** The row currently open in the editor. */
  readonly current = computed(() =>
    this.store.themes().find((t) => this.keyOf(t) === this.editing()) ?? null,
  );

  /**
   * True when saving would DROP the stored stylesheet — i.e. the selection changed and
   * this editor cannot supply a replacement. The domain then renders the shipped chrome
   * until the Studio re-renders, which the operator must know BEFORE saving.
   */
  readonly willUnstyle = computed(() => {
    const row = this.current();
    if (!row) return false;
    // Nothing to lose if nothing was ever rendered for it.
    if (!row.renderedBy) return false;
    return (
      row.preset !== this.draftPreset().trim() ||
      row.ramp !== this.draftRamp() ||
      row.style !== this.draftStyle() ||
      // Decor is part of the SELECTION the BFF compares, so a decor-only change drops the
      // render exactly like any other. Leaving it out here would under-warn on the one
      // edit an operator is most likely to make from this screen — switching a decoration
      // off — and they would watch the domain go un-themed with no warning shown.
      (row.decor ?? 'none') !== this.draftDecor() ||
      (row.primaryHex ?? '') !== this.draftPrimary().trim() ||
      (row.secondaryHex ?? '') !== this.draftSecondary().trim()
    );
  });

  async ngOnInit(): Promise<void> {
    await this.store.refresh();
  }

  /** A stable key for a row: the reserved segment for the mesh default. */
  keyOf(t: ThemeRow): string {
    return t.isDefault ? MESH_DEFAULT_SEGMENT : (t.domain ?? '');
  }

  label(t: ThemeRow): string {
    return t.isDefault ? 'Mesh default (inherited by every domain)' : (t.domain ?? '');
  }

  /**
   * May this caller edit this row? Presentation only — the BFF's `canManage` is the gate.
   * Superadmin: anything. Domain admin: their own domain, and never the mesh default,
   * because changing it repaints every domain that has not overridden it.
   */
  canEdit(t: ThemeRow): boolean {
    if (this.session.isSuperadmin()) return true;
    return !t.isDefault;
  }

  /** Whether the row has a stylesheet stored, i.e. whether it renders themed at all. */
  isRendered(t: ThemeRow): boolean {
    return !!t.renderedBy;
  }

  open(t: ThemeRow): void {
    this.editing.set(this.keyOf(t));
    this.confirmingClear.set(null);
    this.draftPreset.set(t.preset ?? '');
    this.draftRamp.set(t.ramp ?? 'dark');
    this.draftStyle.set(t.style ?? 'soft');
    this.draftDecor.set(t.decor ?? 'none');
    this.draftPrimary.set(t.primaryHex ?? '');
    this.draftSecondary.set(t.secondaryHex ?? '');
  }

  cancel(): void {
    this.editing.set(null);
  }

  async save(): Promise<void> {
    const row = this.current();
    if (!row || this.saving()) return;
    this.saving.set(true);
    try {
      const ok = await this.store.save(row.isDefault ? '' : (row.domain ?? ''), {
        preset: this.draftPreset().trim(),
        ramp: this.draftRamp(),
        style: this.draftStyle(),
        // Always sent, 'none' included: 'none' is the selection that turns a decoration
        // OFF, so omitting it would make switching one off indistinguishable from leaving
        // it on and the decorated stylesheet would survive the write.
        decor: this.draftDecor(),
        // Omit rather than send blank: absent is the honest encoding of "no override",
        // and the BFF's hex pattern rejects an empty string that is not truly absent.
        ...(this.draftPrimary().trim() ? { primaryHex: this.draftPrimary().trim() } : {}),
        ...(this.draftSecondary().trim() ? { secondaryHex: this.draftSecondary().trim() } : {}),
      });
      if (ok) this.editing.set(null);
    } finally {
      this.saving.set(false);
    }
  }

  async clear(t: ThemeRow): Promise<void> {
    if (this.confirmingClear() !== this.keyOf(t)) {
      this.confirmingClear.set(this.keyOf(t));
      return;
    }
    this.confirmingClear.set(null);
    await this.store.clear(t.isDefault ? '' : (t.domain ?? ''));
  }
}
