import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FleetEntitlementsComponent } from './fleet-entitlements.component';
import { BffService, FleetEntitlement } from './bff.service';

const fixtureEntitlements = (): FleetEntitlement[] => [
  { subject: 'casdoor:alice', active: true, seats: 25, expiresAt: null, updatedAt: '2026-07-20T09:00:00Z' },
  { subject: 'casdoor:bob', active: false, seats: null, expiresAt: null, updatedAt: '2026-07-19T08:00:00Z' },
];

describe('FleetEntitlementsComponent', () => {
  let fixture: ComponentFixture<FleetEntitlementsComponent>;
  let component: FleetEntitlementsComponent;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService',
      ['listFleetEntitlements', 'upsertFleetEntitlement', 'removeFleetEntitlement']);
    bff.listFleetEntitlements.and.resolveTo(fixtureEntitlements());
    await TestBed.configureTestingModule({
      imports: [FleetEntitlementsComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(FleetEntitlementsComponent);
    component = fixture.componentInstance;
  });

  async function init(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('loads entitlements on init and renders one row per subject', async () => {
    await init();
    expect(bff.listFleetEntitlements).toHaveBeenCalledTimes(1);
    const el: HTMLElement = fixture.nativeElement;
    const rows = el.querySelectorAll('[data-entitlement]');
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('data-entitlement')).toBe('casdoor:alice');
    expect(el.querySelector('[data-entitlement="casdoor:alice"] .fe-seats-cell')!.textContent!.trim()).toBe('25');
    expect(el.querySelector('[data-testid="fe-empty"]')).toBeNull();
  });

  it('renders the state chip: active vs inactive vs expired', async () => {
    const list = fixtureEntitlements();
    // A past expiry on an otherwise-active row must read as EXPIRED.
    list.push({ subject: 'casdoor:carol', active: true, seats: null, expiresAt: '2020-01-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z' });
    bff.listFleetEntitlements.and.resolveTo(list);
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-entitlement="casdoor:alice"] [data-state]')!.textContent!.trim()).toBe('active');
    expect(el.querySelector('[data-entitlement="casdoor:bob"] [data-state]')!.textContent!.trim()).toBe('inactive');
    expect(el.querySelector('[data-entitlement="casdoor:carol"] [data-state]')!.textContent!.trim()).toBe('expired');
  });

  it('renders an empty state when no entitlements exist', async () => {
    bff.listFleetEntitlements.and.resolveTo([]);
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="fe-empty"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="fe-table"]')).toBeNull();
  });

  it('surfaces a network-level load failure in the role=alert region', async () => {
    bff.listFleetEntitlements.and.rejectWith(new Error('NetworkError'));
    await init();
    expect(component.loadError()).toContain('NetworkError');
    const alert = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="fe-error"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
  });

  describe('grant / revoke (step-up gated)', () => {
    it('refuses to grant with a blank subject — no BFF call, an error note surfaces', async () => {
      await init();
      component.subject = '   ';
      await component.grant();
      expect(bff.upsertFleetEntitlement).not.toHaveBeenCalled();
      expect(component.actionNote()?.kind).toBe('err');
    });

    it('grants (upserts) via upsertFleetEntitlement(subject, {active}) and prepends the returned row + clears the subject', async () => {
      await init();
      const saved: FleetEntitlement = { subject: 'casdoor:carol', active: true, seats: null, expiresAt: null, updatedAt: '2026-07-22T00:00:00Z' };
      bff.upsertFleetEntitlement.and.resolveTo(saved);

      component.subject = 'casdoor:carol';
      component.active = true;
      await component.grant();
      fixture.detectChanges();

      expect(bff.upsertFleetEntitlement).toHaveBeenCalledWith('casdoor:carol', { active: true });
      expect(component.entitlements()[0].subject).toBe('casdoor:carol');
      expect(component.subject).toBe('');
      expect(component.actionNote()?.kind).toBe('ok');
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-entitlement="casdoor:carol"]')).not.toBeNull();
    });

    it('includes seats and an ISO-converted expiry in the upsert body', async () => {
      await init();
      const saved: FleetEntitlement = { subject: 'casdoor:dave', active: true, seats: 10, expiresAt: '2026-12-31T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00Z' };
      bff.upsertFleetEntitlement.and.resolveTo(saved);

      component.subject = 'casdoor:dave';
      component.active = true;
      component.seats = 10;
      component.expiresAt = '2026-12-31T00:00:00Z';   // set directly; toIso normalises to ISO
      await component.grant();

      expect(bff.upsertFleetEntitlement).toHaveBeenCalledWith('casdoor:dave',
        { active: true, seats: 10, expiresAt: '2026-12-31T00:00:00.000Z' });
    });

    it('updates an EXISTING subject in place (upsert replaces, does not duplicate the row)', async () => {
      await init();
      const updated: FleetEntitlement = { subject: 'casdoor:alice', active: false, seats: 5, expiresAt: null, updatedAt: '2026-07-22T10:00:00Z' };
      bff.upsertFleetEntitlement.and.resolveTo(updated);

      component.subject = 'casdoor:alice';
      component.active = false;
      await component.grant();

      expect(component.entitlements().filter((e) => e.subject === 'casdoor:alice').length).toBe(1);
      expect(component.entitlements().find((e) => e.subject === 'casdoor:alice')!.active).toBeFalse();
    });

    it('revokes via removeFleetEntitlement and removes the row (confirm accepted)', async () => {
      spyOn(window, 'confirm').and.returnValue(true);
      await init();
      bff.removeFleetEntitlement.and.resolveTo({ deleted: 1 });

      await component.revoke(component.entitlements()[0]);
      fixture.detectChanges();

      expect(bff.removeFleetEntitlement).toHaveBeenCalledWith('casdoor:alice');
      expect(component.entitlements().some((e) => e.subject === 'casdoor:alice')).toBeFalse();
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-entitlement="casdoor:alice"]')).toBeNull();
    });

    it('does not revoke when the confirmation is declined', async () => {
      spyOn(window, 'confirm').and.returnValue(false);
      await init();
      await component.revoke(component.entitlements()[0]);
      expect(bff.removeFleetEntitlement).not.toHaveBeenCalled();
    });

    it('opens the inline MFA step-up dialog on a "requires step-up" 403 and retries the SAME grant on success', async () => {
      await init();
      component.subject = 'casdoor:carol';
      component.active = true;
      bff.upsertFleetEntitlement.and.rejectWith(
        new Error('entitlement upsert requires step-up re-authentication (present X-PhoneLock-StepUp)'));

      await component.grant();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="mfa-stepup-dialog"]')).not.toBeNull();
      expect(component.stepUpChallenge()).not.toBeNull();

      const saved: FleetEntitlement = { subject: 'casdoor:carol', active: true, seats: null, expiresAt: null, updatedAt: '2026-07-22T00:00:00Z' };
      bff.upsertFleetEntitlement.and.resolveTo(saved);
      await component.onStepUpSatisfied();
      fixture.detectChanges();

      expect(bff.upsertFleetEntitlement).toHaveBeenCalledTimes(2);
      expect(bff.upsertFleetEntitlement.calls.allArgs()).toEqual([
        ['casdoor:carol', { active: true }],
        ['casdoor:carol', { active: true }],
      ]);
      expect(el.querySelector('[data-testid="mfa-stepup-dialog"]')).toBeNull();
    });

    it('dismisses the step-up dialog without retrying on cancel', async () => {
      await init();
      component.subject = 'casdoor:carol';
      bff.upsertFleetEntitlement.and.rejectWith(
        new Error('entitlement upsert requires step-up re-authentication (present X-PhoneLock-StepUp)'));
      await component.grant();
      expect(component.stepUpChallenge()).not.toBeNull();

      component.onStepUpDismissed();
      expect(component.stepUpChallenge()).toBeNull();
      expect(bff.upsertFleetEntitlement).toHaveBeenCalledTimes(1);
    });

    it('surfaces a non-step-up mutation failure in the role=alert action-note', async () => {
      await init();
      component.subject = 'casdoor:carol';
      bff.upsertFleetEntitlement.and.rejectWith(new Error('seats must not be negative'));
      await component.grant();
      fixture.detectChanges();

      const note = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="fe-action-note"]')!;
      expect(note.getAttribute('role')).toBe('alert');
      expect(note.textContent).toContain('seats must not be negative');
    });
  });

  describe('accessibility', () => {
    it('labels the section heading via aria-labelledby', async () => {
      await init();
      const section = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="fleet-entitlements-view"]')!;
      expect(section.getAttribute('aria-labelledby')).toBe('fe-heading');
    });

    it('names the table and scopes every header column', async () => {
      await init();
      const table = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="fe-table"]')!;
      expect(table.getAttribute('aria-labelledby')).toBe('fe-heading');
      const headers = table.querySelectorAll('thead th');
      expect(headers.length).toBe(6);
      for (const th of Array.from(headers)) {
        expect(th.getAttribute('scope')).toBe('col');
      }
    });
  });
});
