import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AccountAppealsComponent } from './account-appeals.component';
import { AccountAppeal, BffService } from '../bff.service';

const appeal = (over: Partial<AccountAppeal> = {}): AccountAppeal => ({
  id: 'ap-1', userSub: 'google:alice@x.com', handle: 'alice@x.com', domain: 'brand-a',
  reason: 'let me back in', contactEmail: null, status: 'PENDING',
  submittedAt: '2026-01-01T00:00:00Z', decidedAt: null, decidedBy: null, ...over,
});

describe('AccountAppealsComponent (account-ban appeal inbox)', () => {
  let fixture: ComponentFixture<AccountAppealsComponent>;
  let component: AccountAppealsComponent;
  let bff: jasmine.SpyObj<BffService>;

  function setup(appeals: AccountAppeal[]) {
    bff = jasmine.createSpyObj<BffService>('BffService', ['accountAppeals', 'decideAccountAppeal']);
    bff.accountAppeals.and.resolveTo(appeals);

    TestBed.configureTestingModule({
      imports: [AccountAppealsComponent],
      providers: [{ provide: BffService, useValue: bff }],
    });

    fixture = TestBed.createComponent(AccountAppealsComponent);
    component = fixture.componentInstance;
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  function testid(id: string): HTMLElement | null {
    return el().querySelector(`[data-testid="${id}"]`);
  }

  it('loads and lists the pending inbox', async () => {
    setup([appeal()]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(bff.accountAppeals).toHaveBeenCalled();
    expect(testid('aa-pending')!.textContent).toContain('alice@x.com');
    expect(testid('aa-empty')).toBeNull();
  });

  it('shows an empty-state message when there are no pending appeals', async () => {
    setup([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(testid('aa-empty')).toBeTruthy();
  });

  it('renders the appellant reason and optional contact email', async () => {
    setup([appeal({ reason: 'this was unfair', contactEmail: 'alt@example.com' })]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(testid('aa-reason')!.textContent).toContain('this was unfair');
    expect(testid('aa-contact-email')!.textContent).toContain('alt@example.com');
  });

  // ── DECIDE: approve actually restores access (per the honesty invariant) ────

  it('approve calls the decide endpoint with APPROVED and reports success on decided:1', async () => {
    setup([appeal()]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    bff.decideAccountAppeal.and.resolveTo({ decided: 1, status: 'APPROVED' });
    await component.approve(appeal());
    fixture.detectChanges();

    expect(bff.decideAccountAppeal).toHaveBeenCalledWith('ap-1', 'APPROVED');
    const note = component.noteFor('ap-1');
    expect(note?.kind).toBe('ok');
    expect(note?.text.toLowerCase()).toContain('restored');
  });

  it('deny calls the decide endpoint with DENIED', async () => {
    setup([appeal()]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    bff.decideAccountAppeal.and.resolveTo({ decided: 1, status: 'DENIED' });
    await component.deny(appeal());

    expect(bff.decideAccountAppeal).toHaveBeenCalledWith('ap-1', 'DENIED');
    expect(component.noteFor('ap-1')?.kind).toBe('ok');
  });

  it('a decided:0 response (already decided / out of scope) is reported as a no-op, not a success', async () => {
    setup([appeal()]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    bff.decideAccountAppeal.and.resolveTo({ decided: 0, status: 'APPROVED' });
    await component.approve(appeal());

    const note = component.noteFor('ap-1');
    expect(note?.kind).toBe('err');
    expect(note?.text).toContain('already decided');
  });

  it('a FAILED approve (restore did not happen server-side) is surfaced as an honest error, NEVER a success note', async () => {
    setup([appeal()]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    bff.decideAccountAppeal.and.rejectWith(new Error('casdoor unreachable'));
    await component.approve(appeal());

    const note = component.noteFor('ap-1');
    expect(note?.kind).toBe('err');
    expect(note!.text).toContain('NOT restored');
    expect(note!.text).toContain('casdoor unreachable');
  });

  it('lists decided appeals separately from the pending inbox', async () => {
    setup([
      appeal({ id: 'ap-1', status: 'PENDING' }),
      appeal({ id: 'ap-2', status: 'APPROVED', decidedBy: 'admin-x', decidedAt: '2026-01-02T00:00:00Z' }),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.pending().map((a) => a.id)).toEqual(['ap-1']);
    expect(component.decided().map((a) => a.id)).toEqual(['ap-2']);
    expect(testid('aa-decided')!.textContent).toContain('APPROVED');
  });
});
