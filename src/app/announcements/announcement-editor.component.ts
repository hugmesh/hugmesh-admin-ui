import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  Announcement,
  AnnouncementFormat,
  AnnouncementInput,
  AnnouncementState,
  AnnouncementsStore,
} from './announcements.service';
import { buildPreviewDoc, sanitizeHtml } from './announcement-sanitize';

/** A toolbar formatting action over the WYSIWYG HTML body. */
export type EditorAction = 'bold' | 'italic' | 'link' | 'heading' | 'list';

/**
 * Admin announcement editor (ROLE_ADMIN only, route-guarded). Authors a single
 * announcement: TITLE; the HTML BODY via a WYSIWYG toolbar with an HTML-SOURCE
 * toggle; a live PREVIEW; a SCHEDULE (starts_at / ends_at / timezone); the FOUR
 * per-surface TARGET checkboxes (Home banner, public Login page, Mastodon/akkoma
 * local-only announcement, Forum main page); the lifecycle STATE (draft /
 * published), display PRIORITY and whether it is DISMISSIBLE. Saving POSTs/PUTs to
 * the admin BFF (which sanitises `body_html` and, when target_akkoma is published,
 * propagates a local-only akkoma announcement).
 *
 * SANDBOXING (security-critical) — two walls, mirroring the snapdragon-user-ui
 * card editor:
 *
 *   1. The HTML body is run through {@link sanitizeHtml} (tag/attr allow-list;
 *      strips `<script>`/`on*=`/inline `style`/`javascript:` URLs) before it is
 *      shown in the preview — and the server re-sanitises it as the authority.
 *   2. The preview document is rendered into an `<iframe sandbox>` whose token
 *      list has NO `allow-scripts` and NO `allow-same-origin`, so the frame is a
 *      unique, opaque origin with scripting OFF. We NEVER use raw innerHTML.
 *
 * a11y: a real `role=toolbar` of `<button type=button>` controls; every field has
 * a `<label for>`; the WYSIWYG/HTML toggle is a labelled control; the preview
 * `<iframe>` is named; errors are announced in a `role=alert`/assertive live region.
 */
@Component({
  selector: 'snap-announcement-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './announcement-editor.component.html',
  styleUrl: './announcement-editor.component.scss',
})
export class AnnouncementEditorComponent {
  private readonly store = inject(AnnouncementsStore);
  private readonly sanitizer = inject(DomSanitizer);

  /** The HTML body textarea/contenteditable, used for selection-aware edits. */
  private readonly bodyArea = viewChild<ElementRef<HTMLTextAreaElement>>('bodyArea');

  /** The four user-facing surfaces (Home / Login / akkoma / Forum). */
  readonly surfaces = this.store.surfaces;

  /** The id being edited, or null for a brand-new announcement. */
  readonly editingId = signal<string | null>(null);

  // ── Authored fields ──────────────────────────────────────────────
  title = '';
  /** The announcement HTML body (WYSIWYG-edited or hand-written source). */
  readonly body = signal<string>('');
  readonly format = signal<AnnouncementFormat>('wysiwyg');
  readonly state = signal<AnnouncementState>('draft');
  priority = 0;
  readonly dismissible = signal<boolean>(true);

  /** Per-surface target flags, keyed by the AnnouncementInput field name. */
  readonly targets = signal<Record<string, boolean>>({
    target_home: false, target_login: false, target_akkoma: false, target_forum: false,
  });

  // ── Schedule ─────────────────────────────────────────────────────
  /** datetime-local strings (or '' = unscheduled); converted to ISO on save. */
  startsAt = '';
  endsAt = '';
  /** IANA timezone the schedule is authored in. Defaults to the browser zone. */
  timezone = browserTimezone();

  /** Whether the body is being edited as raw HTML source (vs the WYSIWYG view). */
  readonly showSource = signal<boolean>(false);

  readonly error = signal<string>('');
  readonly saving = signal<boolean>(false);
  /** Emitted (via the savedId signal) after a successful save so a host list can refresh. */
  readonly savedId = signal<string | null>(null);

  /**
   * The sandboxed preview document (iframe `srcdoc`). Recomputed from the
   * SANITISED body — it never contains script and is bound with
   * bypassSecurityTrustHtml ONLY because Angular strips `srcdoc` otherwise; the
   * content itself is already neutralised and the iframe sandbox is the hard wall.
   */
  readonly previewDoc = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(buildPreviewDoc(this.title, this.body())),
  );

  /** True when at least one surface is targeted (a published announcement needs one). */
  readonly hasTarget = computed(() => Object.values(this.targets()).some(Boolean));

  // ── Body editing ─────────────────────────────────────────────────
  onBodyInput(value: string): void { this.body.set(value); }

  toggleSource(): void {
    // Leaving HTML-source view re-sanitises so the WYSIWYG view starts clean.
    if (this.showSource()) {
      this.format.set('wysiwyg');
      this.body.set(sanitizeHtml(this.body()));
    } else {
      this.format.set('html');
    }
    this.showSource.update((v) => !v);
  }

  /** Apply a toolbar formatting action to the current body selection. */
  format2(action: EditorAction): void {
    const ta = this.bodyArea()?.nativeElement;
    const text = this.body();
    const start = ta?.selectionStart ?? text.length;
    const end = ta?.selectionEnd ?? text.length;
    const next = applyAction(text, start, end, action);
    this.body.set(next.value);
    if (ta) {
      queueMicrotask(() => {
        ta.focus();
        ta.setSelectionRange(next.selStart, next.selEnd);
      });
    }
  }

  // ── Targets ──────────────────────────────────────────────────────
  isTargeted(key: string): boolean { return !!this.targets()[key]; }
  toggleTarget(key: string): void {
    this.targets.update((cur) => ({ ...cur, [key]: !cur[key] }));
  }

  setState(s: AnnouncementState): void { this.state.set(s); }

  /** Seed the editor from an existing announcement (edit mode). */
  edit(a: Announcement): void {
    this.editingId.set(a.id);
    this.title = a.title;
    this.body.set(a.body_html);
    this.format.set(a.format);
    this.state.set(a.state);
    this.priority = a.priority;
    this.dismissible.set(a.dismissible);
    this.targets.set({
      target_home: a.target_home, target_login: a.target_login,
      target_akkoma: a.target_akkoma, target_forum: a.target_forum,
    });
    this.startsAt = toLocalInput(a.starts_at);
    this.endsAt = toLocalInput(a.ends_at);
    this.timezone = a.timezone || browserTimezone();
    this.showSource.set(a.format === 'html');
    this.error.set('');
  }

  /** Reset to a blank new announcement. */
  reset(): void {
    this.editingId.set(null);
    this.title = '';
    this.body.set('');
    this.format.set('wysiwyg');
    this.state.set('draft');
    this.priority = 0;
    this.dismissible.set(true);
    this.targets.set({ target_home: false, target_login: false, target_akkoma: false, target_forum: false });
    this.startsAt = '';
    this.endsAt = '';
    this.timezone = browserTimezone();
    this.showSource.set(false);
    this.error.set('');
    this.savedId.set(null);
  }

  /** Build the wire payload from the current form state. */
  toInput(): AnnouncementInput {
    const t = this.targets();
    return {
      title: this.title.trim(),
      // Client-side sanitise too (the server is the authority, but we never send
      // known-dangerous markup, and the preview already shows the cleaned body).
      body_html: sanitizeHtml(this.body()),
      format: this.format(),
      state: this.state(),
      target_home: !!t['target_home'],
      target_login: !!t['target_login'],
      target_akkoma: !!t['target_akkoma'],
      target_forum: !!t['target_forum'],
      priority: Number(this.priority) || 0,
      starts_at: fromLocalInput(this.startsAt),
      ends_at: fromLocalInput(this.endsAt),
      timezone: this.timezone || browserTimezone(),
      dismissible: this.dismissible(),
    };
  }

  /** Validate then create/update the announcement. Errors surface in a live region. */
  async save(): Promise<void> {
    this.error.set('');
    if (!this.title.trim()) { this.error.set('Enter a title for the announcement.'); return; }
    if (this.state() === 'published' && !this.hasTarget()) {
      this.error.set('Select at least one surface (Home, Login, Mastodon or Forum) before publishing.');
      return;
    }
    const start = fromLocalInput(this.startsAt);
    const end = fromLocalInput(this.endsAt);
    if (start && end && start > end) {
      this.error.set('The end date/time must be after the start date/time.');
      return;
    }

    this.saving.set(true);
    try {
      const input = this.toInput();
      const id = this.editingId();
      const saved = id ? await this.store.update(id, input) : await this.store.create(input);
      this.editingId.set(saved.id);
      // Reflect the server's stored (re-sanitised) body back into the editor.
      this.body.set(saved.body_html);
      this.savedId.set(saved.id);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'The announcement could not be saved.');
    } finally {
      this.saving.set(false);
    }
  }
}

// ── Schedule helpers (datetime-local ⇄ ISO) ───────────────────────
/** The browser's IANA timezone, or 'UTC' when unavailable. */
export function browserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/** ISO-8601 (or null) → a `datetime-local`-compatible string (local clock). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // Render in the local zone, trimmed to minutes (datetime-local has no seconds by default).
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` string → ISO-8601 (or null when empty). */
export function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ── WYSIWYG toolbar transforms (pure, unit-testable) ──────────────
interface ActionResult { value: string; selStart: number; selEnd: number; }

/** Apply a formatting action to a [start,end) selection, emitting HTML. */
export function applyAction(text: string, start: number, end: number, action: EditorAction): ActionResult {
  const selected = text.slice(start, end);
  const wrap = (open: string, close: string, placeholder: string): ActionResult => {
    const inner = selected || placeholder;
    const value = text.slice(0, start) + open + inner + close + text.slice(end);
    return { value, selStart: start + open.length, selEnd: start + open.length + inner.length };
  };
  switch (action) {
    case 'bold':
      return wrap('<strong>', '</strong>', 'bold text');
    case 'italic':
      return wrap('<em>', '</em>', 'italic text');
    case 'heading':
      return wrap('<h2>', '</h2>', 'Heading');
    case 'list': {
      const inner = selected || 'list item';
      const snippet = `<ul>\n  <li>${inner}</li>\n</ul>`;
      const value = text.slice(0, start) + snippet + text.slice(end);
      const at = value.indexOf(inner, start);
      return { value, selStart: at, selEnd: at + inner.length };
    }
    case 'link': {
      const label = selected || 'link text';
      const snippet = `<a href="https://">${label}</a>`;
      const value = text.slice(0, start) + snippet + text.slice(end);
      const at = value.indexOf(label, start);
      return { value, selStart: at, selEnd: at + label.length };
    }
  }
}
