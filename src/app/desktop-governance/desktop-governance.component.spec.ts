import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DesktopGovernanceComponent } from './desktop-governance.component';
import { BffService } from '../bff.service';
import { SessionService } from '../session.service';

/**
 * The shell only renders the active tab's child; the children are exercised in their own specs.
 * A permissive BffService stub keeps the lazily-rendered children from erroring on init.
 */
describe('DesktopGovernanceComponent (module shell)', () => {
  let fixture: ComponentFixture<DesktopGovernanceComponent>;
  let component: DesktopGovernanceComponent;

  async function build(opts: { superadmin?: boolean; dialCapable?: boolean } = {}): Promise<void> {
    TestBed.resetTestingModule();
    const bff = jasmine.createSpyObj<BffService>('BffService', [
      'desktopCatalog', 'desktopSudoGrants', 'desktopInstallRequests', 'devices',
      'desktopDialCapability', 'desktopDials',
    ]);
    bff.desktopCatalog.and.resolveTo([]);
    bff.desktopSudoGrants.and.resolveTo([]);
    bff.desktopInstallRequests.and.resolveTo([]);
    bff.devices.and.resolveTo([]);
    bff.desktopDialCapability.and.resolveTo(opts.dialCapable ?? false);
    bff.desktopDials.and.resolveTo([]);

    const session = jasmine.createSpyObj<SessionService>('SessionService', ['isSuperadmin']);
    (session as unknown as { session: () => unknown }).session = () => ({ id: 'admin@brand-a', roles: [] });
    (session as unknown as { isSuperadmin: () => boolean }).isSuperadmin = () => !!opts.superadmin;

    await TestBed.configureTestingModule({
      imports: [DesktopGovernanceComponent],
      providers: [
        { provide: BffService, useValue: bff },
        { provide: SessionService, useValue: session },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DesktopGovernanceComponent);
    component = fixture.componentInstance;
  }

  beforeEach(async () => {
    await build();
  });

  it('defaults to the Discover curation tab', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.tab()).toBe('catalog');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="desktop-catalog-view"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="desktop-sudo-view"]')).toBeNull();
  });

  it('switches to each tab and renders only that child', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    component.select('sudo');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    let el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="desktop-sudo-view"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="desktop-catalog-view"]')).toBeNull();

    component.select('requests');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement;
    expect(el.querySelector('[data-testid="desktop-install-requests-view"]')).not.toBeNull();

    component.select('terminal');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement;
    expect(el.querySelector('[data-testid="desktop-ssh-terminal-view"]')).not.toBeNull();
  });

  it('marks the active tab via aria-selected', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="dg-tab-catalog"]')!.getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('[data-testid="dg-tab-sudo"]')!.getAttribute('aria-selected')).toBe('false');

    component.select('sudo');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="dg-tab-sudo"]')!.getAttribute('aria-selected')).toBe('true');
  });

  // ── UI-DIAL: SUPERADMIN-only dial tab visibility (HIDDEN-tier capability probe) ──
  describe('SSH-dials sub-tab visibility', () => {
    it('HIDES the dials tab for a plain ADMIN (not superadmin) regardless of capability', async () => {
      await build({ superadmin: false, dialCapable: true });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(component.dialTabVisible()).toBeFalse();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="dg-tab-dials"]')).toBeNull();
    });

    it('HIDES the dials tab for a SUPERADMIN when the dial leg is dark (capability off)', async () => {
      await build({ superadmin: true, dialCapable: false });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(component.dialTabVisible()).toBeFalse();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="dg-tab-dials"]')).toBeNull();
    });

    it('SHOWS the dials tab for a SUPERADMIN when the capability probe reports it enabled', async () => {
      await build({ superadmin: true, dialCapable: true });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(component.dialTabVisible()).toBeTrue();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="dg-tab-dials"]')).not.toBeNull();

      component.select('dials');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="desktop-dials-view"]')).not.toBeNull();
    });

    it('select(dials) is a NO-OP when the tab is not visible (defence-in-depth)', async () => {
      await build({ superadmin: false, dialCapable: true });
      fixture.detectChanges();
      await fixture.whenStable();
      component.select('dials');
      expect(component.tab()).toBe('catalog');
    });
  });

  it('labels the shell + tab nav for a11y', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="desktop-governance-view"]')!.getAttribute('aria-labelledby'))
      .toBe('dg-shell-heading');
    expect(el.querySelector('nav.dg-tabs')!.getAttribute('aria-label')!.length).toBeGreaterThan(0);
  });
});
