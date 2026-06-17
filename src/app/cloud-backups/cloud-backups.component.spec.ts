import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CloudBackupsComponent } from './cloud-backups.component';
import { CloudBackupsService } from './cloud-backups.service';
import { SessionService } from '../session.service';

/**
 * Shell specs — the tab strip + the SUPERADMIN-only TOTAL tab gating. The bff is
 * authoritative (the /bff/superadmin/** endpoint is SUPERADMIN-only); these prove
 * the UI degrades correctly: the TOTAL tab is HIDDEN for an admin and SHOWN for a
 * superadmin, and selecting it is refused for a non-superadmin.
 */
describe('CloudBackupsComponent (shell)', () => {
  // A no-op service stub (the panels load lazily; the shell itself makes no calls).
  const apiStub = {
    listSets: () => Promise.resolve([]),
    services: () => Promise.resolve([]),
    getDestination: () => Promise.resolve(undefined),
  } as unknown as CloudBackupsService;

  async function mount(isSuperadmin: boolean): Promise<{
    fixture: ComponentFixture<CloudBackupsComponent>;
    component: CloudBackupsComponent;
    el: HTMLElement;
  }> {
    localStorage.clear();
    localStorage.setItem('snap.session', JSON.stringify({ bffToken: 'tok' }));
    await TestBed.resetTestingModule()
      .configureTestingModule({
        imports: [CloudBackupsComponent],
        providers: [
          { provide: CloudBackupsService, useValue: apiStub },
          { provide: SessionService, useValue: { isSuperadmin: () => isSuperadmin } },
        ],
      })
      .compileComponents();
    const fixture = TestBed.createComponent(CloudBackupsComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => localStorage.clear());

  it('renders the console with the three always-on tabs', async () => {
    const { el } = await mount(false);
    expect(el.querySelector('[data-testid="cloud-backups-view"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="cloud-backups-tab-sets"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="cloud-backups-tab-create"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="cloud-backups-tab-destination"]')).not.toBeNull();
  });

  it('HIDES the TOTAL tab for an admin (non-superadmin)', async () => {
    const { component, el } = await mount(false);
    expect(component.tabs().some((t) => t.id === 'total')).toBeFalse();
    expect(el.querySelector('[data-testid="cloud-backups-tab-total"]')).toBeNull();
  });

  it('SHOWS the TOTAL tab for a superadmin', async () => {
    const { component, el } = await mount(true);
    expect(component.tabs().some((t) => t.id === 'total')).toBeTrue();
    expect(el.querySelector('[data-testid="cloud-backups-tab-total"]')).not.toBeNull();
  });

  it('REFUSES to activate the TOTAL panel for an admin even if select(total) is called', async () => {
    const { component, fixture, el } = await mount(false);
    component.select('total');
    fixture.detectChanges();
    expect(component.active()).toBe('sets'); // stayed on the default
    expect(el.querySelector('[data-testid="cloud-backups-panel-total"]')).toBeNull();
  });

  it('switches panels when a tab is selected (superadmin can open TOTAL)', async () => {
    const { component, fixture, el } = await mount(true);
    (el.querySelector('[data-testid="cloud-backups-tab-total"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(component.active()).toBe('total');
    expect(el.querySelector('[data-testid="cloud-backups-panel-total"]')).not.toBeNull();
  });

  it('every tab button carries an accessible name (aria-label)', async () => {
    const { el } = await mount(true);
    const tabs = Array.from(el.querySelectorAll('[role="tab"]'));
    expect(tabs.length).toBe(4);
    for (const t of tabs) {
      expect((t.getAttribute('aria-label') ?? '').trim().length).toBeGreaterThan(0);
    }
  });
});
