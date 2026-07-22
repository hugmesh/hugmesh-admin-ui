import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyFleetComponent } from './my-fleet.component';
import { BffService, PhoneDevice } from './bff.service';

/** Two owned phones: a MANAGED+unlocked one (owner-assigned, lockable) and a minimal BYOD one
 *  (unmanaged, not lockable). Every string is a DISTINCT sentinel so a `toContain` on the detail
 *  region pins exactly one field. */
const fixtureOwned = (): PhoneDevice[] => [
  {
    id: 'row-1',
    deviceId: 'owned-a1',
    deviceClass: 'phone',
    serial: 'SER-OWN-1',
    codename: 'komodo',
    marketingName: 'Pixel 9 Pro',
    os: 'GrapheneOS',
    osVersion: 'osver-own-1',
    role: 'field-tech',
    attachedDomain: 'attached-brand-a',
    enterpriseProfilePresent: true,
    attestationVerdict: 'verified',
    managementMode: 'mesh_owned',
    lockState: 'unlocked',
    lockPropagationState: null,
    lockGeneration: 2,
    lockReason: null,
    lockActor: null,
    lockUpdatedAt: null,
    physicalOwner: 'casdoor:alice',
    ownerDomain: 'owner-brand-a',
    lastIngestedAt: '2026-07-18T09:30:00Z',
    ingestCount: 12,
  },
  {
    id: 'row-2',
    deviceId: 'owned-b2',
    enterpriseProfilePresent: false,
    managementMode: 'unmanaged',
    lockState: 'unlocked',
    lockPropagationState: null,
    lockGeneration: 0,
    lockReason: null,
    lockActor: null,
    lockUpdatedAt: null,
    physicalOwner: 'casdoor:alice',
    ownerDomain: 'owner-brand-a',
    ingestCount: 1,
  },
];

describe('MyFleetComponent', () => {
  let fixture: ComponentFixture<MyFleetComponent>;
  let component: MyFleetComponent;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService',
      ['ownedPhones', 'lockOwnedPhone', 'unlockOwnedPhone']);
    bff.ownedPhones.and.resolveTo(fixtureOwned());
    await TestBed.configureTestingModule({
      imports: [MyFleetComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(MyFleetComponent);
    component = fixture.componentInstance;
  });

  async function init(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function clickExpand(deviceId: string): void {
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>(`[data-expand="${deviceId}"]`)!.click();
    fixture.detectChanges();
  }

  it('reads the caller\'s OWN fleet on init and renders one row per phone', async () => {
    await init();
    expect(bff.ownedPhones).toHaveBeenCalledTimes(1);
    expect(component.phones().length).toBe(2);
    const el: HTMLElement = fixture.nativeElement;
    const rows = el.querySelectorAll('[data-phone-id]');
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('data-phone-id')).toBe('owned-a1');
    expect(rows[1].getAttribute('data-phone-id')).toBe('owned-b2');
    expect(el.querySelector('[data-testid="mf-empty"]')).toBeNull();
  });

  it('renders the summary columns (device name, OS, management + lock chips)', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    const row = el.querySelector('[data-phone-id="owned-a1"]')!;
    expect(row.querySelector('.p-device')!.textContent).toContain('Pixel 9 Pro');
    expect(row.querySelector('.p-os')!.textContent).toContain('GrapheneOS');
    expect(row.querySelector('.p-domain')!.textContent).toContain('attached-brand-a');
    expect(row.querySelector('[data-management="mesh_owned"]')!.textContent!.trim()).toBe('managed');
    const byod = el.querySelector('[data-phone-id="owned-b2"]')!;
    expect(byod.querySelector('[data-management="unmanaged"]')!.textContent!.trim()).toBe('BYOD');
    expect(byod.querySelector('.p-role')!.textContent!.trim()).toBe('—');
  });

  it('does NOT expose any SUPERADMIN provisioning affordance (no mark-managed, no owner-assign)', async () => {
    await init();
    clickExpand('owned-a1');
    const el: HTMLElement = fixture.nativeElement;
    // The fleet-owner surface is read + lock/unlock ONLY — provisioning lives on the superadmin page.
    expect(el.querySelector('[data-mark-managed]')).toBeNull();
    expect(el.querySelector('[data-clear-managed]')).toBeNull();
    expect(el.querySelector('[data-owner-assign]')).toBeNull();
    expect(el.querySelector('[data-owner-physical]')).toBeNull();
    // ...but the owner is DISPLAYED (read-only) in the detail.
    expect(el.querySelector('[data-testid="mf-owner"]')!.textContent).toContain('casdoor:alice');
    expect(el.querySelector('[data-testid="mf-owner-domain"]')!.textContent).toContain('owner-brand-a');
  });

  describe('MDM provider (Azure Intune co-equal)', () => {
    it('shows a Headwind provider chip and no Intune id for a default (headwind) phone', async () => {
      await init();
      clickExpand('owned-a1');
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-mdm-provider="headwind"]')!.textContent!.trim()).toBe('Headwind');
      expect(el.querySelector('[data-testid="mf-intune-device-id"]')).toBeNull();
    });

    it('shows an "Azure Intune" chip + the intuneDeviceId + the unlock-asymmetry note for a LOCKED azure phone', async () => {
      const azureLocked: PhoneDevice = {
        ...fixtureOwned()[0],
        mdmProvider: 'azure-intune',
        intuneDeviceId: 'intune-own-abc123',
        lockState: 'locked',
        lockPropagationState: 'applied',
      };
      bff.ownedPhones.and.resolveTo([azureLocked]);
      await init();
      clickExpand('owned-a1');
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-mdm-provider="azure-intune"]')!.textContent!.trim()).toBe('Azure Intune');
      expect(el.querySelector('[data-testid="mf-intune-device-id"]')!.textContent!.trim())
        .toBe('intune-own-abc123');
      const note = el.querySelector('[data-azure-unlock-note="owned-a1"]');
      expect(note).not.toBeNull();
      expect(note!.textContent!).toContain('does not force-unlock the handset');
    });

    it('does NOT show the azure unlock note for a headwind phone', async () => {
      const headwindLocked: PhoneDevice = {
        ...fixtureOwned()[0], lockState: 'locked', lockPropagationState: 'applied',
      };
      bff.ownedPhones.and.resolveTo([headwindLocked]);
      await init();
      clickExpand('owned-a1');
      expect((fixture.nativeElement as HTMLElement)
        .querySelector('[data-azure-unlock-note="owned-a1"]')).toBeNull();
    });

    it('providerLabel() maps azure-intune → "Azure Intune", else → "Headwind"', () => {
      expect(component.providerLabel({ mdmProvider: 'azure-intune' } as PhoneDevice)).toBe('Azure Intune');
      expect(component.providerLabel({} as PhoneDevice)).toBe('Headwind');
    });
  });

  it('renders an empty state when the caller owns no phones', async () => {
    bff.ownedPhones.and.resolveTo([]);
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="mf-empty"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="mf-empty"]')!.textContent).toContain('no phones in your fleet');
    expect(el.querySelector('[data-testid="mf-table"]')).toBeNull();
  });

  it('surfaces a network-level load failure in the role=alert region', async () => {
    bff.ownedPhones.and.rejectWith(new Error('NetworkError when attempting to fetch resource'));
    await init();
    expect(component.loadError()).toContain('NetworkError');
    const el: HTMLElement = fixture.nativeElement;
    const alert = el.querySelector('[data-testid="mf-error"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(el.querySelector('[data-testid="mf-table"]')).toBeNull();
    expect(el.querySelector('[data-testid="mf-empty"]')).toBeNull();
  });

  it('re-fetches the fleet when Refresh is clicked and clears a previous error', async () => {
    bff.ownedPhones.and.rejectWith(new Error('boom'));
    await init();
    expect(component.loadError()).toBe('boom');
    bff.ownedPhones.and.resolveTo(fixtureOwned());
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="mf-refresh"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(bff.ownedPhones).toHaveBeenCalledTimes(2);
    expect(component.loadError()).toBe('');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[data-phone-id]').length).toBe(2);
  });

  it('expands a row into the detail (owner + lock blocks) and collapses it again', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-phone-detail="owned-a1"]')).toBeNull();
    clickExpand('owned-a1');
    const detail = el.querySelector('[data-phone-detail="owned-a1"]')!;
    const text = detail.textContent!;
    expect(text).toContain('SER-OWN-1');   // serial
    expect(text).toContain('komodo');       // codename
    expect(text).toContain('osver-own-1');  // osVersion
    expect(text).toContain('casdoor:alice');// physical owner
    expect(text).toContain('owner-brand-a');// owner domain
    clickExpand('owned-a1');
    expect(el.querySelector('[data-phone-detail="owned-a1"]')).toBeNull();
  });

  it('keeps at most one detail row open', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    clickExpand('owned-a1');
    clickExpand('owned-b2');
    expect(el.querySelector('[data-phone-detail="owned-a1"]')).toBeNull();
    expect(el.querySelector('[data-phone-detail="owned-b2"]')).not.toBeNull();
  });

  describe('lock / unlock (fleet-owner, step-up gated)', () => {
    it('DISABLES the Lock control for a BYOD (unmanaged) phone and shows the not-lockable helper', async () => {
      await init();
      clickExpand('owned-b2');
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector<HTMLButtonElement>('[data-lock-action="owned-b2"]')!.disabled).toBeTrue();
      expect(el.querySelector('[data-lock-help="owned-b2"]')).not.toBeNull();
    });

    it('ENABLES the Lock control for a managed phone and shows no helper', async () => {
      await init();
      clickExpand('owned-a1');
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector<HTMLButtonElement>('[data-lock-action="owned-a1"]')!.disabled).toBeFalse();
      expect(el.querySelector('[data-lock-help="owned-a1"]')).toBeNull();
    });

    it('locks an owned managed phone via bff.lockOwnedPhone(id, reason), swaps the row to locked and clears the reason', async () => {
      spyOn(window, 'confirm').and.returnValue(true);
      await init();
      clickExpand('owned-a1');
      const locked: PhoneDevice = { ...fixtureOwned()[0], lockState: 'locked', lockPropagationState: 'applied' };
      bff.lockOwnedPhone.and.resolveTo(locked);

      component.lockReason = 'device lost';
      await component.lock(component.phones()[0]);
      fixture.detectChanges();

      expect(bff.lockOwnedPhone).toHaveBeenCalledWith('owned-a1', 'device lost');
      expect(component.phones()[0].lockState).toBe('locked');
      expect(component.lockReason).toBe('');
      expect(component.actionNote()?.kind).toBe('ok');
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-phone-id="owned-a1"] [data-lock-state="locked"]')).not.toBeNull();
    });

    it('refuses to lock with a blank reason — no BFF call, an error note surfaces', async () => {
      await init();
      clickExpand('owned-a1');
      component.lockReason = '   ';
      await component.lock(component.phones()[0]);
      expect(bff.lockOwnedPhone).not.toHaveBeenCalled();
      expect(component.actionNote()?.kind).toBe('err');
    });

    it('unlocks a locked owned phone via bff.unlockOwnedPhone and swaps the row to unlocked', async () => {
      const phones = fixtureOwned();
      phones[0].lockState = 'locked';
      bff.ownedPhones.and.resolveTo(phones);
      await init();
      clickExpand('owned-a1');
      bff.unlockOwnedPhone.and.resolveTo({ ...phones[0], lockState: 'unlocked' });

      await component.unlock(component.phones()[0]);
      fixture.detectChanges();

      expect(bff.unlockOwnedPhone).toHaveBeenCalledWith('owned-a1');
      expect(component.phones()[0].lockState).toBe('unlocked');
    });

    it('opens the inline MFA step-up dialog on a "requires step-up" 403 and retries the SAME lock on success, without re-prompting confirm()', async () => {
      spyOn(window, 'confirm').and.returnValue(true);
      await init();
      clickExpand('owned-a1');
      component.lockReason = 'stolen';
      bff.lockOwnedPhone.and.rejectWith(
        new Error('lock requires step-up re-authentication (present X-PhoneLock-StepUp)'));

      await component.lock(component.phones()[0]);
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="mfa-stepup-dialog"]')).not.toBeNull();
      expect((window.confirm as jasmine.Spy).calls.count()).toBe(1);

      bff.lockOwnedPhone.and.resolveTo({ ...fixtureOwned()[0], lockState: 'locked' });
      await component.onStepUpSatisfied();
      fixture.detectChanges();

      expect(bff.lockOwnedPhone).toHaveBeenCalledTimes(2);
      expect(bff.lockOwnedPhone.calls.allArgs()).toEqual([
        ['owned-a1', 'stolen'],
        ['owned-a1', 'stolen'],
      ]);
      expect((window.confirm as jasmine.Spy).calls.count()).toBe(1);
      expect(component.phones()[0].lockState).toBe('locked');
      expect(el.querySelector('[data-testid="mfa-stepup-dialog"]')).toBeNull();
    });

    it('disables the row action buttons while a step-up dialog is open (no orphaned retry)', async () => {
      spyOn(window, 'confirm').and.returnValue(true);
      await init();
      clickExpand('owned-a1');
      component.lockReason = 'stolen';
      bff.lockOwnedPhone.and.rejectWith(
        new Error('lock requires step-up re-authentication (present X-PhoneLock-StepUp)'));

      await component.lock(component.phones()[0]);
      fixture.detectChanges();

      expect(component.busy()).toBe(false);
      expect(component.stepUpChallenge()).not.toBeNull();
      expect(component.actionsLocked()).toBe(true);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector<HTMLButtonElement>('[data-lock-action="owned-a1"]')!.disabled).toBe(true);
    });

    it('dismisses the step-up dialog without retrying on cancel', async () => {
      await init();
      clickExpand('owned-a1');
      component.lockReason = 'x';
      spyOn(window, 'confirm').and.returnValue(true);
      bff.lockOwnedPhone.and.rejectWith(
        new Error('lock requires step-up re-authentication (present X-PhoneLock-StepUp)'));
      await component.lock(component.phones()[0]);
      expect(component.stepUpChallenge()).not.toBeNull();

      component.onStepUpDismissed();
      expect(component.stepUpChallenge()).toBeNull();
      expect(bff.lockOwnedPhone).toHaveBeenCalledTimes(1);
    });

    it('surfaces a non-step-up mutation failure (e.g. a 404 cross-owner) in the role=alert action-note', async () => {
      spyOn(window, 'confirm').and.returnValue(true);
      await init();
      clickExpand('owned-a1');
      component.lockReason = 'x';
      bff.lockOwnedPhone.and.rejectWith(new Error("phone 'owned-a1' not found"));

      await component.lock(component.phones()[0]);
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const note = el.querySelector('[data-testid="mf-action-note"]')!;
      expect(note.getAttribute('role')).toBe('alert');
      expect(note.getAttribute('aria-live')).toBe('assertive');
      expect(note.textContent).toContain('not found');
    });
  });

  describe('accessibility', () => {
    it('labels the section heading via aria-labelledby', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const section = el.querySelector('[data-testid="my-fleet-view"]')!;
      expect(section.getAttribute('aria-labelledby')).toBe('mf-heading');
      expect(el.querySelector('#mf-heading')).not.toBeNull();
    });

    it('names the fleet table and scopes every header column', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const table = el.querySelector('[data-testid="mf-table"]')!;
      expect(table.getAttribute('aria-labelledby')).toBe('mf-heading');
      const headers = table.querySelectorAll('thead th');
      expect(headers.length).toBe(8);
      for (const th of Array.from(headers)) {
        expect(th.getAttribute('scope')).toBe('col');
      }
    });

    it('drives each expand button with aria-expanded + aria-controls onto the detail row', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const button = el.querySelector('[data-expand="owned-a1"]')!;
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(button.getAttribute('aria-controls')).toBe('mf-detail-row-1');
      clickExpand('owned-a1');
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(el.querySelector('#mf-detail-row-1')).not.toBeNull();
    });

    it('announces the loading state politely in role=status', async () => {
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const status = el.querySelector('[data-testid="mf-loading"]')!;
      expect(status.getAttribute('role')).toBe('status');
      expect(status.getAttribute('aria-live')).toBe('polite');
      await init();
      expect(el.querySelector('[data-testid="mf-loading"]')).toBeNull();
    });
  });
});
