import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CloudBackupsComponent } from './cloud-backups.component';
import { CloudBackupsService } from './cloud-backups.service';
import { SessionService } from '../session.service';
import { BffService, PLATFORM_CAPABILITIES_ABSENT } from '../bff.service';

/**
 * Shell specs — the tab strip + the SUPERADMIN-only TOTAL tab gating, PLUS the Velero
 * capability gate. The bff is authoritative; these prove the UI degrades correctly: the
 * TOTAL tab is HIDDEN for an admin and SHOWN for a superadmin, and when Velero is ABSENT the
 * whole console shows the capability-gate notice with no tabs (graceful degradation).
 */
describe('CloudBackupsComponent (shell)', () => {
  // A no-op service stub (the panels load lazily; the shell itself makes no calls).
  const apiStub = {
    listSets: () => Promise.resolve([]),
    services: () => Promise.resolve([]),
    getDestination: () => Promise.resolve(undefined),
  } as unknown as CloudBackupsService;

  function bffStub(veleroPresent: boolean) {
    return {
      platformCapabilities: () =>
        Promise.resolve({ ...PLATFORM_CAPABILITIES_ABSENT, veleroPresent }),
    } as unknown as BffService;
  }

  async function mount(isSuperadmin: boolean, veleroPresent = true): Promise<{
    fixture: ComponentFixture<CloudBackupsComponent>;
    component: CloudBackupsComponent;
    el: HTMLElement;
  }> {
    localStorage.clear();
    localStorage.setItem('hug.session', JSON.stringify({ roles: [] }));
    await TestBed.resetTestingModule()
      .configureTestingModule({
        imports: [CloudBackupsComponent],
        providers: [
          { provide: CloudBackupsService, useValue: apiStub },
          { provide: SessionService, useValue: { isSuperadmin: () => isSuperadmin } },
          { provide: BffService, useValue: bffStub(veleroPresent) },
        ],
      })
      .compileComponents();
    const fixture = TestBed.createComponent(CloudBackupsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
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

  describe('capability gate (Velero absent → graceful degradation)', () => {
    it('shows the capability-gate notice and hides the tabs when Velero is absent', async () => {
      const { el } = await mount(true, /* veleroPresent */ false);
      const gate = el.querySelector('[data-testid="capability-gate"]')!;
      expect(gate).withContext('gate notice present').not.toBeNull();
      expect(gate.getAttribute('data-capability')).toBe('velero');
      expect(gate.classList).toContain('notice--warn');
      // actions suppressed: no tabs, no panels.
      expect(el.querySelector('[role="tablist"]')).toBeNull();
      expect(el.querySelector('[data-testid="cloud-backups-tab-sets"]')).toBeNull();
    });

    it('renders the tabs (no gate) when Velero is present', async () => {
      const { el } = await mount(true, /* veleroPresent */ true);
      expect(el.querySelector('[data-testid="capability-gate"]')).toBeNull();
      expect(el.querySelector('[role="tablist"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="cloud-backups-tab-sets"]')).not.toBeNull();
    });

    it('gives the gate notice an accessible name naming the backup unavailability', async () => {
      const { el } = await mount(false, false);
      const gate = el.querySelector('[data-testid="capability-gate"]')!;
      const name = gate.getAttribute('aria-label') ?? '';
      expect(name.trim().length).toBeGreaterThan(0);
      expect(name.toLowerCase()).toContain('backup');
    });
  });
});
