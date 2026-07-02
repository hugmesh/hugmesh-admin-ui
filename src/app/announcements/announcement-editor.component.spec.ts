import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AnnouncementEditorComponent,
  applyAction,
  fromLocalInput,
  toLocalInput,
} from './announcement-editor.component';
import { Announcement, AnnouncementInput, AnnouncementsStore } from './announcements.service';

describe('AnnouncementEditorComponent', () => {
  let fixture: ComponentFixture<AnnouncementEditorComponent>;
  let component: AnnouncementEditorComponent;
  let el: HTMLElement;
  let store: jasmine.SpyObj<AnnouncementsStore>;

  const surfaces = [
    { key: 'target_home' as const, label: 'Home (logged-in top banner)', hint: '' },
    { key: 'target_login' as const, label: 'Login page (everyone)', hint: '' },
    { key: 'target_akkoma' as const, label: 'Mastodon / akkoma', hint: '' },
    { key: 'target_forum' as const, label: 'Forum main page', hint: '' },
  ];

  function saved(over: Partial<Announcement> = {}): Announcement {
    return {
      id: 'srv-1', title: 'T', body_html: '<p>b</p>', format: 'wysiwyg', state: 'draft',
      target_home: false, target_login: false, target_akkoma: false, target_forum: false,
      priority: 0, starts_at: null, ends_at: null, timezone: 'UTC', dismissible: true, ...over,
    };
  }

  beforeEach(async () => {
    store = jasmine.createSpyObj<AnnouncementsStore>('AnnouncementsStore', ['create', 'update'], {
      surfaces,
    });
    store.create.and.resolveTo(saved());
    store.update.and.resolveTo(saved());

    await TestBed.configureTestingModule({
      imports: [AnnouncementEditorComponent],
      providers: [{ provide: AnnouncementsStore, useValue: store }],
    }).compileComponents();
    fixture = TestBed.createComponent(AnnouncementEditorComponent);
    component = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  /** The raw HTML the sandboxed iframe `srcdoc` is bound to (unwrap SafeHtml). */
  function previewHtml(): string {
    const safe = component.previewDoc() as { changingThisBreaksApplicationSecurity?: string };
    return String(safe.changingThisBreaksApplicationSecurity ?? component.previewDoc());
  }

  describe('sandboxed preview (security)', () => {
    it('renders the preview in an iframe with an EMPTY sandbox (no scripts, no same-origin)', () => {
      const frame = el.querySelector<HTMLIFrameElement>('[data-testid="ann-preview"]')!;
      expect(frame.tagName.toLowerCase()).toBe('iframe');
      const sandbox = frame.getAttribute('sandbox');
      expect(sandbox).toBe(''); // empty token list = maximal restriction
      expect((sandbox ?? '').toLowerCase()).not.toContain('allow-scripts');
      expect((sandbox ?? '').toLowerCase()).not.toContain('allow-same-origin');
    });

    it('neutralises a <script>/onerror payload typed into the body', () => {
      component.onBodyInput('<p>ok</p><script>alert(1)</script><img src=x onerror=alert(2)>');
      fixture.detectChanges();
      const html = previewHtml();
      expect(html.toLowerCase()).not.toContain('<script>alert');
      expect(html).not.toMatch(/onerror=/i);
      expect(html).toContain('<p>ok</p>');
    });

    it('binds the preview via [srcdoc] (never raw innerHTML)', () => {
      component.onBodyInput('<p>hello world</p>');
      fixture.detectChanges();
      const frame = el.querySelector<HTMLIFrameElement>('[data-testid="ann-preview"]')!;
      // The component never writes to .innerHTML; the body reaches the frame via srcdoc.
      expect(frame.getAttribute('srcdoc') ?? frame.srcdoc).toContain('hello world');
    });
  });

  describe('WYSIWYG ⇄ HTML source toggle', () => {
    it('toggles aria-pressed + the format and re-sanitises on returning to WYSIWYG', () => {
      const toggle = el.querySelector<HTMLButtonElement>('[data-testid="ann-source-toggle"]')!;
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      component.onBodyInput('<p>x</p><script>bad()</script>');
      component.toggleSource(); // -> source view
      fixture.detectChanges();
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      component.toggleSource(); // -> back to WYSIWYG, sanitises
      expect(component.body().toLowerCase()).not.toContain('<script');
    });
  });

  describe('formatting toolbar', () => {
    it('exposes a role=toolbar with an accessible name and real buttons', () => {
      const toolbar = el.querySelector('[role="toolbar"]')!;
      expect(toolbar.getAttribute('aria-label')).toBeTruthy();
      for (const id of ['fmt-bold', 'fmt-italic', 'fmt-link', 'fmt-heading', 'fmt-list']) {
        const btn = el.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
        expect(btn.tagName.toLowerCase()).withContext(id).toBe('button');
        expect(btn.getAttribute('type')).toBe('button');
        expect(btn.getAttribute('aria-label')).withContext(id).toBeTruthy();
      }
    });

    it('bold wraps the selection in <strong>', () => {
      component.format2('bold');
      expect(component.body()).toContain('<strong>bold text</strong>');
    });

    // ── KEYBOARD (the toolbar is a WAI-ARIA APG roving-tabindex composite) ──
    it('uses a roving tabindex: only the first toolbar button is tabbable', async () => {
      document.body.appendChild(fixture.nativeElement);
      await fixture.whenStable();
      const btns = Array.from(
        el.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button'),
      );
      expect(btns[0].tabIndex).toBe(0);
      expect(btns.slice(1).every((b) => b.tabIndex === -1)).toBeTrue();
      fixture.nativeElement.remove();
    });

    it('ArrowRight moves roving focus to the next toolbar button', async () => {
      document.body.appendChild(fixture.nativeElement);
      await fixture.whenStable();
      const btns = Array.from(
        el.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button'),
      );
      btns[0].focus();
      el.querySelector('[role="toolbar"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      fixture.detectChanges();
      expect(document.activeElement).toBe(btns[1]);
      expect(btns[1].tabIndex).toBe(0);
      fixture.nativeElement.remove();
    });
  });

  describe('targets', () => {
    it('renders a checkbox per surface (Home / Login / akkoma / Forum)', () => {
      for (const s of surfaces) {
        expect(el.querySelector(`[data-target="${s.key}"]`)).withContext(s.key).not.toBeNull();
      }
    });

    it('toggleTarget flips the per-surface flag', () => {
      expect(component.isTargeted('target_login')).toBeFalse();
      component.toggleTarget('target_login');
      expect(component.isTargeted('target_login')).toBeTrue();
      expect(component.hasTarget()).toBeTrue();
    });
  });

  describe('validation', () => {
    it('blocks save with no title (no BFF call, alert announced)', async () => {
      component.title = '   ';
      await component.save();
      fixture.detectChanges();
      expect(store.create).not.toHaveBeenCalled();
      expect(component.error()).toContain('title');
      const alert = el.querySelector('[data-testid="ann-error"]')!;
      expect(alert.getAttribute('role')).toBe('alert');
    });

    it('blocks publishing with no target surface selected', async () => {
      component.title = 'Has title';
      component.setState('published');
      await component.save();
      expect(store.create).not.toHaveBeenCalled();
      expect(component.error()).toContain('surface');
    });

    it('blocks save when ends_at is before starts_at', async () => {
      component.title = 'X';
      component.startsAt = '2026-06-10T12:00';
      component.endsAt = '2026-06-10T11:00';
      await component.save();
      expect(store.create).not.toHaveBeenCalled();
      expect(component.error()).toContain('end');
    });
  });

  describe('save', () => {
    it('creates a new announcement with the sanitised body + targets', async () => {
      component.title = 'Maintenance';
      component.onBodyInput('<p>Soon</p><script>x()</script>');
      component.toggleTarget('target_home');
      component.toggleTarget('target_login');
      component.setState('published');
      component.priority = 7;
      await component.save();

      expect(store.create).toHaveBeenCalled();
      const arg = store.create.calls.mostRecent().args[0] as AnnouncementInput;
      expect(arg.title).toBe('Maintenance');
      expect(arg.body_html.toLowerCase()).not.toContain('<script');
      expect(arg.target_home).toBeTrue();
      expect(arg.target_login).toBeTrue();
      expect(arg.target_akkoma).toBeFalse();
      expect(arg.state).toBe('published');
      expect(arg.priority).toBe(7);
      expect(component.savedId()).toBe('srv-1');
    });

    it('updates when editing an existing announcement', async () => {
      component.edit(saved({ id: 'edit-me', title: 'Old', target_forum: true, format: 'html' }));
      expect(component.editingId()).toBe('edit-me');
      expect(component.isTargeted('target_forum')).toBeTrue();
      store.update.and.resolveTo(saved({ id: 'edit-me' }));
      component.title = 'New title';
      await component.save();
      expect(store.update).toHaveBeenCalledWith('edit-me', jasmine.objectContaining({ title: 'New title' }));
    });

    it('surfaces the BFF error and does not mark saved', async () => {
      store.create.and.rejectWith(new Error('title required'));
      component.title = 'X';
      await component.save();
      expect(component.error()).toBe('title required');
      expect(component.savedId()).toBeNull();
    });

    it('retracts the previous saved confirmation when a re-save starts (no stale badge)', async () => {
      // First save succeeds → the "saved" badge condition (savedId set) holds.
      component.title = 'First';
      await component.save();
      expect(component.savedId()).toBe('srv-1');
      // The re-save (an update now — editingId is set) FAILS. savedId must be
      // cleared at save-start so the FIRST save's confirmation can never
      // present the failed second save as saved.
      store.update.and.rejectWith(new Error('boom'));
      component.title = 'Second';
      await component.save();
      expect(component.error()).toBe('boom');
      expect(component.savedId()).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('labels the title, schedule and timezone inputs', () => {
      for (const id of ['ann-title', 'ann-starts', 'ann-ends', 'ann-timezone', 'ann-priority']) {
        expect(el.querySelector(`label[for="${id}"]`)).withContext(id).not.toBeNull();
      }
      const frame = el.querySelector('[data-testid="ann-preview"]')!;
      expect(frame.getAttribute('title')).toBeTruthy();
      expect(frame.getAttribute('aria-labelledby')).toBe('ann-preview-heading');
    });
  });
});

describe('announcement-editor pure helpers', () => {
  describe('applyAction', () => {
    it('wraps a selection in <em> for italic', () => {
      const r = applyAction('hello', 0, 5, 'italic');
      expect(r.value).toBe('<em>hello</em>');
    });
    it('inserts an <h2> heading placeholder when nothing is selected', () => {
      const r = applyAction('', 0, 0, 'heading');
      expect(r.value).toContain('<h2>Heading</h2>');
    });
    it('builds a <ul><li> list', () => {
      const r = applyAction('', 0, 0, 'list');
      expect(r.value).toContain('<li>list item</li>');
    });
    it('inserts an <a href> link snippet', () => {
      const r = applyAction('', 0, 0, 'link');
      expect(r.value).toContain('<a href="https://">link text</a>');
    });
  });

  describe('schedule codec', () => {
    it('fromLocalInput returns null for empty and ISO otherwise', () => {
      expect(fromLocalInput('')).toBeNull();
      expect(fromLocalInput('2026-06-10T12:00')).toMatch(/2026-06-10T/);
    });
    it('toLocalInput round-trips an ISO instant to a minutes-precision local string', () => {
      const local = toLocalInput('2026-06-10T12:00:00.000Z');
      expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(toLocalInput(null)).toBe('');
      expect(toLocalInput('not-a-date')).toBe('');
    });
  });
});
