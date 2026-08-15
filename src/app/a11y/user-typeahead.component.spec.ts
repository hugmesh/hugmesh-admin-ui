import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { UserTypeaheadComponent } from './user-typeahead.component';
import { BffService, DirectoryUser } from '../bff.service';

/**
 * UserTypeaheadComponent — the shared user picker. The three things worth pinning are the
 * ones a hand-rolled combobox is easiest to get wrong: the ARIA wiring (this repo has no
 * component library to inherit it from), the keyboard contract, and the debounce/abort
 * behaviour that keeps a stale keystroke's results from landing on a newer query.
 *
 * Domain SCOPING is deliberately NOT asserted here — it is not this component's job and
 * cannot be tested from the browser side. It is enforced in admin-bff
 * (`UserDirectoryServiceTest`), which is the point: a client-side filter would be an
 * enumeration hole, so there is nothing here to scope.
 */
describe('UserTypeaheadComponent', () => {
  let fixture: ComponentFixture<UserTypeaheadComponent>;
  let component: UserTypeaheadComponent;
  let bff: jasmine.SpyObj<BffService>;

  const alice: DirectoryUser = {
    username: 'alice', handle: 'alice@brandx.example', provider: 'google', domain: 'default',
  };
  const albert: DirectoryUser = {
    username: 'albert', handle: 'albert#42', provider: 'discord', domain: 'default',
  };

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', ['searchUsers']);
    bff.searchUsers.and.resolveTo([alice, albert]);

    await TestBed.configureTestingModule({
      imports: [UserTypeaheadComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();

    fixture = TestBed.createComponent(UserTypeaheadComponent);
    component = fixture.componentInstance;
    component.inputId = 'tt-user';
    component.testId = 'tt-user';
    fixture.detectChanges();
  });

  function el(): HTMLElement { return fixture.nativeElement; }
  function input(): HTMLInputElement { return el().querySelector('#tt-user')!; }

  /** Type `text` and let the debounce + the resolved search settle. */
  function type(text: string): void {
    const i = input();
    i.value = text;
    i.dispatchEvent(new Event('input'));
    tick(UserTypeaheadComponent.DEBOUNCE_MS);
    tick();          // flush the resolved searchUsers promise
    fixture.detectChanges();
  }

  /** Dispatch a keydown on the input and settle. */
  function key(k: string): KeyboardEvent {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    input().dispatchEvent(e);
    fixture.detectChanges();
    return e;
  }

  // ── ARIA ────────────────────────────────────────────────────────────────
  describe('ARIA (APG combobox with listbox popup)', () => {
    it('marks the input as a combobox controlling its listbox', () => {
      expect(input().getAttribute('role')).toBe('combobox');
      expect(input().getAttribute('aria-controls')).toBe('tt-user-listbox');
      expect(input().getAttribute('aria-autocomplete')).toBe('list');
      expect(el().querySelector('#tt-user-listbox')!.getAttribute('role')).toBe('listbox');
    });

    it('starts collapsed with no active descendant', () => {
      expect(input().getAttribute('aria-expanded')).toBe('false');
      expect(input().hasAttribute('aria-activedescendant')).toBeFalse();
    });

    it('expands and points aria-activedescendant at the highlighted option', fakeAsync(() => {
      type('al');
      expect(input().getAttribute('aria-expanded')).toBe('true');
      key('ArrowDown');
      expect(input().getAttribute('aria-activedescendant')).toBe('tt-user-opt-0');
      const opt = el().querySelector('#tt-user-opt-0')!;
      expect(opt.getAttribute('role')).toBe('option');
      expect(opt.getAttribute('aria-selected')).toBe('true');
    }));

    it('keeps DOM focus on the input while arrowing', fakeAsync(() => {
      document.body.appendChild(fixture.nativeElement);
      input().focus();
      type('al');
      key('ArrowDown');
      expect(document.activeElement).toBe(input());
      fixture.nativeElement.remove();
    }));

    it('keeps the caller\'s describedby ids and omits its own empty live region', () => {
      fixture.componentRef.setInput('describedBy', 'caller-help');
      fixture.detectChanges();
      // Nothing typed yet, so the status region is empty — pointing at it would make a
      // screen reader read the description as trailing silence.
      expect(input().getAttribute('aria-describedby')).toBe('caller-help');
    });

    it('appends its live region once it actually says something', fakeAsync(() => {
      fixture.componentRef.setInput('describedBy', 'caller-help');
      type('al');
      expect(input().getAttribute('aria-describedby')).toBe('caller-help tt-user-status');
    }));
  });

  // ── Keyboard ────────────────────────────────────────────────────────────
  describe('keyboard', () => {
    it('ArrowDown/ArrowUp move the active option and wrap', fakeAsync(() => {
      type('al');
      key('ArrowDown');
      expect(component.activeIndex()).toBe(0);
      key('ArrowDown');
      expect(component.activeIndex()).toBe(1);
      key('ArrowDown');
      expect(component.activeIndex()).withContext('wraps to the top').toBe(0);
      key('ArrowUp');
      expect(component.activeIndex()).withContext('wraps to the bottom').toBe(1);
    }));

    it('Enter commits the active option', fakeAsync(() => {
      const emitted: string[] = [];
      component.valueChange.subscribe(v => emitted.push(v));
      type('al');
      key('ArrowDown');
      const e = key('Enter');
      expect(e.defaultPrevented).withContext('must not submit the form').toBeTrue();
      expect(component.value).toBe('alice');
      expect(emitted.at(-1)).toBe('alice');
      // Must STAY closed: choose() hands focus back to the input, and onFocus re-opens the
      // popup whenever suggestions are still held — so a commit has to drop the list too.
      expect(component.open()).toBeFalse();
      expect(component.options()).toEqual([]);
    }));

    it('Enter with nothing highlighted still submits the surrounding form', fakeAsync(() => {
      type('al');
      const e = key('Enter');
      expect(e.defaultPrevented).toBeFalse();
    }));

    it('Escape closes the popup WITHOUT clearing what was typed', fakeAsync(() => {
      type('al');
      expect(component.open()).toBeTrue();
      key('Escape');
      expect(component.open()).toBeFalse();
      expect(component.value).withContext('the typed text survives').toBe('al');
    }));
  });

  // ── Commit spelling ─────────────────────────────────────────────────────
  describe('committed identity spelling', () => {
    it('commits the bare Casdoor username by default', fakeAsync(() => {
      type('al');
      component.choose(alice);
      expect(component.value).toBe('alice');
    }));

    it('commits provider:handle in qualified mode', fakeAsync(() => {
      component.commit = 'qualified';
      type('al');
      component.choose(albert);
      expect(component.value).toBe('discord:albert#42');
    }));
  });

  // ── Debounce / cap / states ─────────────────────────────────────────────
  describe('search behaviour', () => {
    it('does not search below the minimum query length', fakeAsync(() => {
      type('a');
      expect(bff.searchUsers).not.toHaveBeenCalled();
      expect(component.statusText).toContain('Keep typing');
    }));

    it('issues ONE request for a burst of keystrokes within the debounce window', fakeAsync(() => {
      const i = input();
      for (const v of ['al', 'ali', 'alic', 'alice']) {
        i.value = v;
        i.dispatchEvent(new Event('input'));
        tick(UserTypeaheadComponent.DEBOUNCE_MS / 5);
      }
      tick(UserTypeaheadComponent.DEBOUNCE_MS);
      tick();
      expect(bff.searchUsers).toHaveBeenCalledTimes(1);
      expect(bff.searchUsers).toHaveBeenCalledWith(
        'alice', UserTypeaheadComponent.PAGE_SIZE, jasmine.any(AbortSignal));
    }));

    it('caps the requested rows at the page size', fakeAsync(() => {
      type('al');
      expect(bff.searchUsers.calls.mostRecent().args[1]).toBe(UserTypeaheadComponent.PAGE_SIZE);
    }));

    it('announces a no-matches state and keeps the free-text fallback', fakeAsync(() => {
      bff.searchUsers.and.resolveTo([]);
      type('zzz');
      expect(component.open()).toBeFalse();
      expect(component.statusText).toContain('No matching users');
      expect(component.statusText).toContain('type a username directly');
      expect(component.value).withContext('free text is preserved').toBe('zzz');
    }));

    it('announces the result count for a screen reader', fakeAsync(() => {
      type('al');
      expect(component.statusText).toContain('2 matching users');
      const status = el().querySelector('[data-testid="tt-user-status"]')!;
      expect(status.getAttribute('role')).toBe('status');
      expect(status.getAttribute('aria-live')).toBe('polite');
    }));

    it('a superseded request cannot repopulate the list', fakeAsync(() => {
      type('al');
      expect(component.options().length).toBe(2);
      // A new keystroke below the minimum aborts the pending/settled request and clears.
      const i = input();
      i.value = 'a';
      i.dispatchEvent(new Event('input'));
      tick(UserTypeaheadComponent.DEBOUNCE_MS);
      tick();
      fixture.detectChanges();
      expect(component.options()).toEqual([]);
      expect(component.open()).toBeFalse();
    }));

    it('a failed search degrades to no suggestions, never a thrown error', fakeAsync(() => {
      bff.searchUsers.and.rejectWith(new Error('boom'));
      expect(() => type('al')).not.toThrow();
      expect(component.options()).toEqual([]);
      expect(component.open()).toBeFalse();
    }));
  });
});
