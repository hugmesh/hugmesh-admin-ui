import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppealsComponent } from './appeals.component';
import { AppealsStore } from './appeals-store.service';
import { ModerationRequest } from '../bff.service';

function row(over: Partial<ModerationRequest> = {}): ModerationRequest {
  return {
    id: 7, requester: 'mod', kind: 'user-removal', target: '@x:brand', reason: 'spam',
    status: 'approved', adminDecider: 'admin', domain: 'DOMAIN_brand', ...over,
  };
}

describe('AppealsComponent', () => {
  let fixture: ComponentFixture<AppealsComponent>;
  let component: AppealsComponent;
  let store: jasmine.SpyObj<AppealsStore> & {
    decided: ReturnType<typeof signal<ModerationRequest[]>>;
    deciding: ReturnType<typeof signal<number | null>>;
    note: ReturnType<typeof signal<string>>;
    error: ReturnType<typeof signal<string>>;
    busy: () => boolean;
  };

  beforeEach(async () => {
    const decided = signal<ModerationRequest[]>([]);
    const deciding = signal<number | null>(null);
    const note = signal('');
    const error = signal('');
    const spy = jasmine.createSpyObj<AppealsStore>('AppealsStore', ['decide', 'reset']);
    store = Object.assign(spy, {
      decided, deciding, note, error,
      busy: () => deciding() !== null,
    }) as typeof store;
    store.decide.and.callFake(async (id: number, approve: boolean) => {
      const r = row({ id, status: approve ? 'approved' : 'denied' });
      decided.update((rows) => [r, ...rows]);
      return r;
    });

    await TestBed.configureTestingModule({
      imports: [AppealsComponent],
      providers: [{ provide: AppealsStore, useValue: store }],
    }).compileComponents();
    fixture = TestBed.createComponent(AppealsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ── USER-SITUATIONAL ───────────────────────────────────────────────────
  it('approves the entered id via the store and clears the input', async () => {
    component.appealId = '7';
    await component.approve();
    expect(store.decide).toHaveBeenCalledWith(7, true);
    expect(component.appealId).toBe('');
  });

  it('denies the entered id via the store (approve=false)', async () => {
    component.appealId = '9';
    await component.deny();
    expect(store.decide).toHaveBeenCalledWith(9, false);
  });

  it('renders a decided row in the session record table', async () => {
    component.appealId = '7';
    await component.approve();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const tr = el.querySelector('[data-appeal-id="7"]');
    expect(tr).withContext('decided row').not.toBeNull();
    expect(tr!.querySelector('.status-pill')!.textContent!.trim()).toBe('approved');
  });

  // ── VALIDATION (mirrors the admin-bff @Positive id check) ──────────────
  it('does not call the store on a blank id and announces the error', async () => {
    component.appealId = '   ';
    await component.approve();
    expect(store.decide).not.toHaveBeenCalled();
    expect(component.idError()).not.toBe('');
    fixture.detectChanges();
    const alert = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="ap-id-error"]');
    expect(alert!.getAttribute('role')).toBe('alert');
    expect(alert!.getAttribute('aria-live')).toBe('assertive');
  });

  it('rejects a non-positive / non-integer id before calling the store', async () => {
    for (const bad of ['0', '-3', '2.5', 'abc']) {
      store.decide.calls.reset();
      component.appealId = bad;
      await component.approve();
      expect(store.decide).withContext(`id="${bad}"`).not.toHaveBeenCalled();
      expect(component.idError()).withContext(`id="${bad}"`).not.toBe('');
    }
  });

  it('keeps the id on a transport error so the admin can retry', async () => {
    store.decide.and.resolveTo(null);
    component.appealId = '7';
    await component.approve();
    expect(component.appealId).toBe('7');
  });

  // ── CONCURRENT/OPTIMISTIC (busy disables the controls) ─────────────────
  it('disables both decide buttons while a decision is in flight (busy)', () => {
    store.deciding.set(7);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector<HTMLButtonElement>('[data-testid="ap-approve"]')!.disabled).toBeTrue();
    expect(el.querySelector<HTMLButtonElement>('[data-testid="ap-deny"]')!.disabled).toBeTrue();
    expect(el.querySelector('[data-testid="ap-busy"]')).not.toBeNull();
  });

  it('ignores a submit while busy (no double-decide)', async () => {
    store.deciding.set(7);
    component.appealId = '8';
    await component.approve();
    expect(store.decide).not.toHaveBeenCalled();
  });

  // ── ACCESSIBILITY ──────────────────────────────────────────────────────
  describe('accessibility', () => {
    it('associates the id input with a <label for> and persistent helptext', () => {
      const el: HTMLElement = fixture.nativeElement;
      const input = el.querySelector<HTMLInputElement>('#ap-id');
      const label = el.querySelector<HTMLLabelElement>('label[for="ap-id"]');
      expect(input).not.toBeNull();
      expect(label).not.toBeNull();
      expect(label!.textContent!.trim().length).toBeGreaterThan(0);
      // helptext is always referenced; the error id is appended only when present.
      expect(input!.getAttribute('aria-describedby')).toContain('ap-id-help');
      expect(el.querySelector('#ap-id-help')).not.toBeNull();
    });

    it('gives the approve/deny buttons accessible names that include the id', () => {
      component.appealId = '7';
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="ap-approve"]')!.getAttribute('aria-label')).toContain('7');
      expect(el.querySelector('[data-testid="ap-deny"]')!.getAttribute('aria-label')).toContain('7');
    });

    it('exposes a status live region for the last decision note', () => {
      store.note.set('Appeal #7 approved.');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const note = el.querySelector('[data-testid="ap-note"]');
      expect(note!.getAttribute('role')).toBe('status');
      expect(note!.getAttribute('aria-live')).toBe('polite');
    });

    it('renders a hard error in a role=alert/assertive live region', () => {
      store.error.set('federation-api unreachable');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const err = el.querySelector('[data-testid="ap-error"]');
      expect(err!.getAttribute('role')).toBe('alert');
      expect(err!.getAttribute('aria-live')).toBe('assertive');
    });

    it('renders the missing pending-list dependency disabled with explanatory helptext', () => {
      const el: HTMLElement = fixture.nativeElement;
      const gap = el.querySelector('[data-testid="ap-gap-pending-list"]');
      expect(gap).not.toBeNull();
      expect(gap!.getAttribute('aria-disabled')).toBe('true');
      const helpId = gap!.getAttribute('aria-describedby')!;
      const help = el.querySelector(`#${helpId}`);
      expect(help).withContext('gap helptext').not.toBeNull();
      expect(help!.textContent!.toLowerCase()).toContain('no admin service endpoint');
    });
  });
});
