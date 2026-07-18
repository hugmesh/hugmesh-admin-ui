import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DomainCapabilitiesComponent, GLOBAL_DOMAIN } from './domain-capabilities.component';
import { BffService, DomainCapability } from './bff.service';
import { SessionService } from './session.service';

const CAP = BffService.USER_MESH_DEVICES;

function row(domain: string, granted: boolean, enabled: boolean): DomainCapability {
  return { id: `id-${domain}`, domain, capability: CAP, granted, enabled, generation: 1 };
}

describe('DomainCapabilitiesComponent', () => {
  let fixture: ComponentFixture<DomainCapabilitiesComponent>;
  let component: DomainCapabilitiesComponent;
  let bff: jasmine.SpyObj<BffService>;
  let session: jasmine.SpyObj<SessionService>;

  function configure(superadmin: boolean, rows: DomainCapability[]) {
    bff = jasmine.createSpyObj<BffService>('BffService',
      ['domainCapabilities', 'setDomainCapabilityGranted', 'setDomainCapabilityEnabled']);
    bff.domainCapabilities.and.resolveTo(rows);

    session = jasmine.createSpyObj<SessionService>('SessionService', ['isSuperadmin']);
    (session as unknown as { isSuperadmin: () => boolean }).isSuperadmin = () => superadmin;

    TestBed.configureTestingModule({
      imports: [DomainCapabilitiesComponent],
      providers: [
        { provide: BffService, useValue: bff },
        { provide: SessionService, useValue: session },
      ],
    });
    fixture = TestBed.createComponent(DomainCapabilitiesComponent);
    component = fixture.componentInstance;
  }

  /** Trigger the component lifecycle (which runs ngOnInit's single await) then render. */
  async function init(): Promise<void> {
    fixture.detectChanges();      // fires ngOnInit
    await fixture.whenStable();   // domainCapabilities() resolved
    fixture.detectChanges();      // render with the loaded data
  }

  // ════════════════════════ SUPERADMIN view ══════════════════════════════════════

  describe('as SUPERADMIN', () => {
    it('loads every domain row (incl. the GLOBAL sentinel) and renders the domains table', async () => {
      configure(true, [row(GLOBAL_DOMAIN, false, false), row('brandx', true, true), row('brandy', false, true)]);
      await init();

      expect(bff.domainCapabilities).toHaveBeenCalledTimes(1);
      expect(component.domainRows().length).toBe(2);
      expect(component.globalRow()?.domain).toBe(GLOBAL_DOMAIN);

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="dc-global-panel"]')).not.toBeNull();
      expect(el.querySelector('[data-domain-row="brandx"]')).not.toBeNull();
      expect(el.querySelector('[data-domain-row="brandy"]')).not.toBeNull();
      expect(el.querySelector('[data-domain-row="' + GLOBAL_DOMAIN + '"]')).toBeNull();
      // the own-domain admin card is NOT shown for a superadmin session
      expect(el.querySelector('[data-testid="dc-own-domain"]')).toBeNull();
    });

    it('renders the empty state when no domain has been granted yet', async () => {
      configure(true, [row(GLOBAL_DOMAIN, false, false)]);
      await init();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="dc-domains-empty"]')).not.toBeNull();
    });

    it('toggles the platform-wide kill switch (the GLOBAL row granted flag) and reloads', async () => {
      configure(true, [row(GLOBAL_DOMAIN, false, false)]);
      await init();
      bff.setDomainCapabilityGranted.and.resolveTo(row(GLOBAL_DOMAIN, true, false));
      bff.domainCapabilities.and.resolveTo([row(GLOBAL_DOMAIN, true, false)]);

      await component.toggleGranted(component.globalRow()!);

      expect(bff.setDomainCapabilityGranted).toHaveBeenCalledWith(GLOBAL_DOMAIN, CAP, true);
      expect(bff.domainCapabilities).toHaveBeenCalledTimes(2);
    });

    it('toggles a per-domain granted flag (PUT .../{domain}/{capability})', async () => {
      configure(true, [row(GLOBAL_DOMAIN, true, false), row('brandx', false, false)]);
      await init();
      bff.setDomainCapabilityGranted.and.resolveTo(row('brandx', true, false));

      await component.toggleGranted(component.domainRows()[0]);

      expect(bff.setDomainCapabilityGranted).toHaveBeenCalledWith('brandx', CAP, true);
    });

    it('toggles a per-domain enabled flag on a domain\'s behalf (PUT .../{domain}/{capability}/enabled)', async () => {
      configure(true, [row(GLOBAL_DOMAIN, true, false), row('brandx', true, false)]);
      await init();
      bff.setDomainCapabilityEnabled.and.resolveTo(row('brandx', true, true));

      await component.toggleEnabledForDomain(component.domainRows()[0]);

      expect(bff.setDomainCapabilityEnabled).toHaveBeenCalledWith('brandx', CAP, true);
    });

    it('grants a brand-new domain via the free-text form and clears the input on success', async () => {
      configure(true, [row(GLOBAL_DOMAIN, true, false)]);
      await init();
      bff.setDomainCapabilityGranted.and.resolveTo(row('brandz', true, false));

      component.newDomain = ' brandz ';
      await component.grantNewDomain();

      // NOTE: the component does not trim before calling the BFF today except via the
      // explicit trim() call — assert the trimmed value was sent.
      expect(bff.setDomainCapabilityGranted).toHaveBeenCalledWith('brandz', CAP, true);
      expect(component.newDomain).toBe('');
    });

    it('refuses to grant a blank domain without calling the BFF', async () => {
      configure(true, [row(GLOBAL_DOMAIN, true, false)]);
      await init();
      component.newDomain = '   ';
      await component.grantNewDomain();
      expect(bff.setDomainCapabilityGranted).not.toHaveBeenCalled();
      expect(component.error()).not.toBe('');
    });

    it('refuses to grant the GLOBAL sentinel through the free-text form', async () => {
      configure(true, [row(GLOBAL_DOMAIN, true, false)]);
      await init();
      // A leading space cannot round-trip through a text input; the guard compares against
      // the trimmed sentinel word.
      component.newDomain = GLOBAL_DOMAIN.trim();
      await component.grantNewDomain();
      expect(bff.setDomainCapabilityGranted).not.toHaveBeenCalled();
      expect(component.error()).toContain('global');
    });
  });

  // ════════════════════════ ADMIN (own-domain) view ══════════════════════════════

  describe('as ADMIN (non-superadmin)', () => {
    it('renders the own-domain card, not the superadmin table', async () => {
      configure(false, [row('brandx', true, false)]);
      await init();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="dc-own-domain"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="dc-global-panel"]')).toBeNull();
      expect(component.ownRow()?.domain).toBe('brandx');
    });

    it('shows the enable toggle ENABLED (not disabled) once granted, and toggles it', async () => {
      configure(false, [row('brandx', true, false)]);
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const checkbox = el.querySelector<HTMLInputElement>('#dc-own-enabled')!;
      expect(checkbox.disabled).toBeFalse();
      expect(checkbox.checked).toBeFalse();

      bff.setDomainCapabilityEnabled.and.resolveTo(row('brandx', true, true));
      await component.toggleOwnEnabled();
      expect(bff.setDomainCapabilityEnabled).toHaveBeenCalledWith('brandx', CAP, true);
    });

    it('greys out (disables) the enable toggle and shows an explanation when granted=false', async () => {
      configure(false, [row('brandx', false, false)]);
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const checkbox = el.querySelector<HTMLInputElement>('#dc-own-enabled')!;
      expect(checkbox.disabled).toBeTrue();
      expect(el.querySelector('[data-testid="dc-not-granted-hint"]')).not.toBeNull();
    });

    it('greys out the enable toggle when the domain has NO row at all (never granted)', async () => {
      configure(false, []);
      await init();
      expect(component.ownRow()).toBeNull();
      const el: HTMLElement = fixture.nativeElement;
      const checkbox = el.querySelector<HTMLInputElement>('#dc-own-enabled')!;
      expect(checkbox.disabled).toBeTrue();
      expect(el.querySelector('[data-testid="dc-not-granted-hint"]')).not.toBeNull();
    });

    it('never calls the BFF from toggleOwnEnabled when ungranted (guards even if invoked programmatically)', async () => {
      configure(false, [row('brandx', false, false)]);
      await init();
      await component.toggleOwnEnabled();
      expect(bff.setDomainCapabilityEnabled).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════ degraded state (load failure) ════════════════════════

  describe('degraded state', () => {
    it('surfaces a load failure in a role=alert live region without throwing', async () => {
      configure(true, []);
      bff.domainCapabilities.and.rejectWith(new Error('BFF unavailable'));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const alert = el.querySelector('[data-testid="dc-error"]')!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.textContent).toContain('BFF unavailable');
    });

    it('surfaces a mutation failure without losing the currently-loaded rows', async () => {
      configure(true, [row(GLOBAL_DOMAIN, true, false), row('brandx', true, false)]);
      await init();
      bff.setDomainCapabilityGranted.and.rejectWith(new Error('conflict'));

      await component.toggleGranted(component.domainRows()[0]);

      expect(component.error()).toBe('conflict');
      // the stale row list is still present — a failed mutation does not clear the view
      expect(component.domainRows().length).toBe(1);
    });
  });

  describe('accessibility', () => {
    it('labels the section heading via aria-labelledby', async () => {
      configure(true, [row(GLOBAL_DOMAIN, false, false)]);
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const section = el.querySelector('[data-testid="domain-capabilities-view"]')!;
      expect(section.getAttribute('aria-labelledby')).toBe('dc-heading');
      expect(el.querySelector('#dc-heading')).not.toBeNull();
    });

    it('gives every checkbox an accessible name via aria-label', async () => {
      configure(true, [row(GLOBAL_DOMAIN, true, false), row('brandx', true, true)]);
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const boxes = Array.from(el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      expect(boxes.length).toBeGreaterThan(0);
      for (const box of boxes) {
        expect(box.getAttribute('aria-label')).withContext(box.outerHTML).toBeTruthy();
      }
    });
  });
});
