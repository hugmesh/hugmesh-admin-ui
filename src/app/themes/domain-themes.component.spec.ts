import { TestBed } from '@angular/core/testing';
import { DomainThemesComponent } from './domain-themes.component';
import { DomainThemesStore, MESH_DEFAULT_SEGMENT, ThemeRow } from './domain-themes.service';
import { SessionService } from '../session.service';
import { signal } from '@angular/core';

/**
 * The per-domain theme editor.
 *
 * Three behaviours here are load-bearing, and each exists because of something that has
 * already gone wrong on this platform:
 *
 * 1. THE UN-THEMED WARNING. This editor cannot derive colours — the maths has exactly one
 *    implementation, in the Studio — so saving a CHANGED selection clears the stored
 *    stylesheet and the domain falls back to the shipped chrome. If the operator is not
 *    told before saving, they discover it on the live page and read it as a break. The
 *    warning must appear only when a render actually stands to be lost.
 *
 * 2. THE MESH DEFAULT IS SUPERADMIN-ONLY, and it is keyed by the EMPTY string, so it
 *    travels as the reserved `_default` segment. Both halves are tested: that a domain
 *    admin is not invited to edit it, and that the reserved segment is what goes on the
 *    wire — a row for a domain literally named `_default` would be inherited by nobody.
 *
 * 3. THE UI DOES NOT DECIDE AUTHORIZATION. Disabling a button is courtesy; the BFF's
 *    canManage is the gate. So a 403 must still be reported in words, because the shell's
 *    menu and the gateway have already disagreed once in production and the operator's
 *    fix differs depending on which rule refused them.
 */
describe('DomainThemesComponent', () => {
  let store: {
    themes: ReturnType<typeof signal<ThemeRow[]>>;
    loading: ReturnType<typeof signal<boolean>>;
    error: ReturnType<typeof signal<string>>;
    knownPresets: () => string[];
    refresh: jasmine.Spy;
    save: jasmine.Spy;
    clear: jasmine.Spy;
    segmentOf: (d: string | null | undefined) => string;
  };
  let superadmin: boolean;

  function row(over: Partial<ThemeRow> = {}): ThemeRow {
    return {
      domain: 'brandx', preset: 'nord', ramp: 'dusk', style: 'sharp', decor: 'none',
      primaryHex: undefined, secondaryHex: undefined, updatedBy: 'admin@x',
      renderedBy: 'studio', isDefault: false, ...over,
    } as ThemeRow;
  }

  function setup(rows: ThemeRow[], asSuperadmin = false) {
    superadmin = asSuperadmin;
    const themes = signal<ThemeRow[]>(rows);
    store = {
      themes,
      loading: signal(false),
      error: signal(''),
      knownPresets: () => ['nord', 'pride'],
      refresh: jasmine.createSpy('refresh').and.resolveTo(undefined),
      save: jasmine.createSpy('save').and.resolveTo(true),
      clear: jasmine.createSpy('clear').and.resolveTo(true),
      segmentOf: (d) => (d && d.trim() ? d.trim() : MESH_DEFAULT_SEGMENT),
    };
    TestBed.configureTestingModule({
      imports: [DomainThemesComponent],
      providers: [
        { provide: DomainThemesStore, useValue: store },
        { provide: SessionService, useValue: { isSuperadmin: () => superadmin, isAdmin: () => true } },
      ],
    });
    const fixture = TestBed.createComponent(DomainThemesComponent);
    fixture.detectChanges();
    return fixture;
  }

  function el(fixture: ReturnType<typeof setup>, testid: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testid}"]`);
  }

  it('lists every theme it was given without filtering', () => {
    // The BFF already scoped the list; re-filtering here would duplicate a rule that has
    // drifted before.
    const f = setup([row(), row({ domain: 'brandy' }), row({ domain: '', isDefault: true })]);
    expect(el(f, 'theme-row-brandx')).toBeTruthy();
    expect(el(f, 'theme-row-brandy')).toBeTruthy();
    expect(el(f, `theme-row-${MESH_DEFAULT_SEGMENT}`)).toBeTruthy();
  });

  it('marks a domain with no stored stylesheet, since "nothing changed" is otherwise a mystery', () => {
    const f = setup([row({ renderedBy: undefined })]);
    expect(el(f, 'rendered-no')).toBeTruthy();
    expect(el(f, 'rendered-yes')).toBeNull();
  });

  describe('the mesh default', () => {
    it('is not editable by a domain admin', () => {
      const f = setup([row({ domain: '', isDefault: true })], false);
      const btn = el(f, `edit-${MESH_DEFAULT_SEGMENT}`) as HTMLButtonElement;
      expect(btn.disabled).toBeTrue();
      // ...and the reason is given, not merely implied by a dead control.
      expect(btn.getAttribute('title')).toContain('superadmin-only');
    });

    it('is editable by a superadmin', () => {
      const f = setup([row({ domain: '', isDefault: true })], true);
      expect((el(f, `edit-${MESH_DEFAULT_SEGMENT}`) as HTMLButtonElement).disabled).toBeFalse();
    });

    it('offers no Clear at all — there is nothing above it to fall back to', () => {
      const f = setup([row({ domain: '', isDefault: true })], true);
      expect(el(f, `clear-${MESH_DEFAULT_SEGMENT}`)).toBeNull();
    });

    it('saves through the EMPTY domain key, which the store maps to the reserved segment', async () => {
      const f = setup([row({ domain: '', isDefault: true, preset: 'dark' })], true);
      const c = f.componentInstance;
      c.open(c.store.themes()[0]);
      f.detectChanges();
      await c.save();
      expect(store.save).toHaveBeenCalled();
      expect(store.save.calls.mostRecent().args[0]).toBe('');
    });
  });

  describe('the un-themed warning', () => {
    it('is absent while the selection is unchanged', () => {
      const f = setup([row()]);
      const c = f.componentInstance;
      c.open(c.store.themes()[0]);
      f.detectChanges();
      expect(el(f, 'unstyle-warning')).toBeNull();
    });

    it('appears as soon as any axis changes', () => {
      const f = setup([row()]);
      const c = f.componentInstance;
      c.open(c.store.themes()[0]);
      c.draftPreset.set('pride');
      f.detectChanges();
      expect(el(f, 'unstyle-warning')).toBeTruthy();
      expect(el(f, 'unstyle-warning')!.textContent).toContain('default chrome');
    });

    it('appears for a ramp change too, not only the preset', () => {
      const f = setup([row()]);
      const c = f.componentInstance;
      c.open(c.store.themes()[0]);
      c.draftRamp.set('light');
      f.detectChanges();
      expect(el(f, 'unstyle-warning')).toBeTruthy();
    });

    it('appears when ONLY the decor changed', () => {
      // The edit this screen exists for: a mesh with decoration switched on, being
      // switched off. Decor is part of the selection the BFF compares, so this drops the
      // render exactly like a preset change — and it is the case most likely to be
      // reached from here, so under-warning on it would be the worst possible omission.
      const f = setup([row({ decor: 'uwu' })]);
      const c = f.componentInstance;
      c.open(c.store.themes()[0]);
      c.draftDecor.set('none');
      f.detectChanges();
      expect(el(f, 'unstyle-warning')).toBeTruthy();
    });

    it('stays hidden when there was never a render to lose', () => {
      // Nothing is being taken away, so warning about it would be noise.
      const f = setup([row({ renderedBy: undefined })]);
      const c = f.componentInstance;
      c.open(c.store.themes()[0]);
      c.draftPreset.set('pride');
      f.detectChanges();
      expect(el(f, 'unstyle-warning')).toBeNull();
    });
  });

  describe('saving', () => {
    it('omits blank colour overrides rather than sending empty strings', async () => {
      // The BFF's hex pattern accepts absent, not empty-that-is-not-truly-absent.
      const f = setup([row()]);
      const c = f.componentInstance;
      c.open(c.store.themes()[0]);
      await c.save();
      const body = store.save.calls.mostRecent().args[1];
      expect('primaryHex' in body).toBeFalse();
      expect('secondaryHex' in body).toBeFalse();
    });

    it('sends a colour override when one is set', async () => {
      const f = setup([row()]);
      const c = f.componentInstance;
      c.open(c.store.themes()[0]);
      c.draftPrimary.set('#ff0088');
      await c.save();
      expect(store.save.calls.mostRecent().args[1].primaryHex).toBe('#ff0088');
    });

    it('sends decor ALWAYS, including "none"', async () => {
      // Unlike the hexes above, decor is never omitted. "none" is the selection that
      // turns a decoration off; if it were dropped as "empty", the BFF would compare the
      // write as unchanged and keep serving the decorated stylesheet — the exact bug that
      // made a switched-on decoration unclearable.
      const f = setup([row({ decor: 'uwu' })]);
      const c = f.componentInstance;
      c.open(c.store.themes()[0]);
      c.draftDecor.set('none');
      await c.save();
      expect(store.save.calls.mostRecent().args[1].decor).toBe('none');
    });

    it('carries a row\'s existing decor into the editor so it can be changed at all', () => {
      const f = setup([row({ decor: 'sparkle' })]);
      const c = f.componentInstance;
      c.open(c.store.themes()[0]);
      expect(c.draftDecor()).toBe('sparkle');
    });

    it('will not save without a preset', () => {
      const f = setup([row({ preset: '' })]);
      const c = f.componentInstance;
      c.open(c.store.themes()[0]);
      f.detectChanges();
      expect((el(f, 'save-theme') as HTMLButtonElement).disabled).toBeTrue();
    });

    it('closes the editor on success and leaves it open on failure', async () => {
      const f = setup([row()]);
      const c = f.componentInstance;
      c.open(c.store.themes()[0]);
      await c.save();
      expect(c.editing()).toBeNull();

      store.save.and.resolveTo(false);
      c.open(c.store.themes()[0]);
      await c.save();
      expect(c.editing()).not.toBeNull();
    });
  });

  describe('clearing', () => {
    it('takes two clicks, so one misclick cannot drop a domain to the default', async () => {
      const f = setup([row()]);
      const c = f.componentInstance;
      await c.clear(c.store.themes()[0]);
      expect(store.clear).not.toHaveBeenCalled();
      await c.clear(c.store.themes()[0]);
      expect(store.clear).toHaveBeenCalled();
    });
  });

  it('reports a refusal in words rather than only disabling a control', () => {
    // Presentation gating is courtesy; the BFF is the gate, so its refusal must be
    // readable when the operator reaches it anyway.
    const f = setup([row()]);
    store.error.set('You do not have permission to save the theme for domain \'brandy\'.');
    f.detectChanges();
    expect(el(f, 'themes-error')!.textContent).toContain('do not have permission');
  });
});
