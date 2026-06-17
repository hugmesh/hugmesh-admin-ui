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

  beforeEach(async () => {
    const bff = jasmine.createSpyObj<BffService>('BffService', [
      'desktopCatalog', 'desktopSudoGrants', 'desktopInstallRequests', 'devices',
    ]);
    bff.desktopCatalog.and.resolveTo([]);
    bff.desktopSudoGrants.and.resolveTo([]);
    bff.desktopInstallRequests.and.resolveTo([]);
    bff.devices.and.resolveTo([]);

    const session = jasmine.createSpyObj<SessionService>('SessionService', ['isSuperadmin']);
    (session as unknown as { session: () => unknown }).session = () => ({ id: 'admin@brand-a', roles: [] });
    (session as unknown as { isSuperadmin: () => boolean }).isSuperadmin = () => false;

    await TestBed.configureTestingModule({
      imports: [DesktopGovernanceComponent],
      providers: [
        { provide: BffService, useValue: bff },
        { provide: SessionService, useValue: session },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DesktopGovernanceComponent);
    component = fixture.componentInstance;
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
