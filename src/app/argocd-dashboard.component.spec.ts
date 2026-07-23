import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ArgocdDashboardComponent } from './argocd-dashboard.component';
import { BffService, ArgoApp, ArgoAppDetail, PLATFORM_CAPABILITIES_ABSENT } from './bff.service';

describe('ArgocdDashboardComponent', () => {
  let fixture: ComponentFixture<ArgocdDashboardComponent>;
  let component: ArgocdDashboardComponent;
  let bff: jasmine.SpyObj<BffService>;

  const games: ArgoApp = {
    name: 'games', project: 'hugmesh', namespace: 'hugmesh-games',
    syncStatus: 'OutOfSync', health: 'Degraded', revision: 'abc123',
  };
  const detail: ArgoAppDetail = {
    app: games,
    resourceTree: { nodes: [{
      group: 'apps', kind: 'Deployment', namespace: 'hugmesh-games', name: 'games',
      version: 'v1', syncStatus: '', health: 'Degraded', parentRefs: [],
    }] },
    message: 'replicas unavailable',
  };

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService',
      ['argoApplications', 'argoApplication', 'argoSync', 'platformCapabilities']);
    bff.argoApplications.and.resolveTo({ items: [games], unavailable: false });
    // Default: ArgoCD present, so the existing behaviour specs see the live dashboard.
    bff.platformCapabilities.and.resolveTo({ ...PLATFORM_CAPABILITIES_ABSENT, argocdPresent: true });
    await TestBed.configureTestingModule({
      imports: [ArgocdDashboardComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(ArgocdDashboardComponent);
    component = fixture.componentInstance;
  });

  async function init() {
    fixture.detectChanges();
    // ngOnInit now chains platform.load() -> refresh() (two async hops); flush BOTH before
    // asserting by settling twice, then re-render.
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('renders an app card per application with sync + health badges', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-app="games"]')).not.toBeNull();
    const badges = el.querySelectorAll('[data-app="games"] .badge');
    expect(badges.length).toBe(2);
    // a11y: the badge carries the status TEXT, not colour alone.
    expect(el.textContent).toContain('OutOfSync');
    expect(el.textContent).toContain('Degraded');
  });

  it('shows an honest notice when the BFF reports ArgoCD unavailable (503)', async () => {
    bff.argoApplications.and.resolveTo({ items: [], unavailable: true });
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="argocd-unavailable"]')).not.toBeNull();
  });

  it('opens a detail panel with the resource tree', async () => {
    bff.argoApplication.and.resolveTo(detail);
    await init();
    await component.open('games');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(bff.argoApplication).toHaveBeenCalledWith('games');
    expect(el.querySelector('[data-testid="argocd-resource-tree"]')).not.toBeNull();
    expect(el.querySelector('[data-node="Deployment/games"]')).not.toBeNull();
  });

  it('guards sync behind an aria-modal confirm dialog and only calls the BFF on confirm', async () => {
    bff.argoSync.and.resolveTo({ name: 'games', accepted: true, phase: 'Running', revision: 'def', message: '' });
    await init();

    // Asking to sync opens the dialog but does NOT call the BFF yet.
    component.askSync('games');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const dialog = el.querySelector('[data-testid="argocd-sync-dialog"]')!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(bff.argoSync).not.toHaveBeenCalled();

    // Confirming calls the BFF and announces the result.
    await component.confirmSync();
    fixture.detectChanges();
    expect(bff.argoSync).toHaveBeenCalledWith('games');
    const status = el.querySelector('[data-testid="argocd-status"]')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toContain('games');
  });

  it('cancelling the dialog never calls sync', async () => {
    await init();
    component.askSync('games');
    component.cancelSync();
    fixture.detectChanges();
    expect(component.confirming()).toBeNull();
    expect(bff.argoSync).not.toHaveBeenCalled();
  });

  // ── KEYBOARD (the aria-modal dialog: Escape closes + focus is managed) ──
  describe('KEYBOARD operability', () => {
    it('Escape on the sync dialog closes it without calling the BFF', async () => {
      document.body.appendChild(fixture.nativeElement);
      await init();
      component.askSync('games');
      fixture.detectChanges();
      await fixture.whenStable();
      const el: HTMLElement = fixture.nativeElement;
      const dialog = el.querySelector<HTMLElement>('[data-testid="argocd-sync-dialog"]')!;
      // Focus moves INTO the dialog on open (first focusable control).
      expect(dialog.contains(document.activeElement)).toBeTrue();

      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(component.confirming()).toBeNull();
      expect(bff.argoSync).not.toHaveBeenCalled();
      fixture.nativeElement.remove();
    });

    it('restores focus to the Sync trigger after the dialog closes', async () => {
      document.body.appendChild(fixture.nativeElement);
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const trigger = el.querySelector<HTMLButtonElement>('[data-sync="games"]')!;
      trigger.focus();
      component.askSync('games');
      fixture.detectChanges();
      await fixture.whenStable();

      const dialog = el.querySelector<HTMLElement>('[data-testid="argocd-sync-dialog"]')!;
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();
      // On close the directive restores focus to the element that opened it.
      expect(document.activeElement).toBe(trigger);
      fixture.nativeElement.remove();
    });
  });

  it('maps statuses to colour-modifier classes (paired with the text)', () => {
    expect(component.syncClass('Synced')).toBe('is-synced');
    expect(component.syncClass('OutOfSync')).toBe('is-outofsync');
    expect(component.healthClass('Healthy')).toBe('is-healthy');
    expect(component.healthClass('Degraded')).toBe('is-degraded');
    expect(component.healthClass('weird')).toBe('is-unknown');
  });

  describe('help text (sighted + low/no-sight)', () => {
    it('describes the app grid and the mutating Sync button with wired, informative help', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const help = el.querySelector('[data-testid="argocd-help"]')!;
      expect(help).withContext('visible help present').not.toBeNull();
      expect(help.id).toBe('argocd-help');
      expect(help.textContent!).toContain('mutating');

      const grid = el.querySelector('[data-testid="argocd-app-grid"]')!;
      expect(grid.getAttribute('aria-describedby')).toBe('argocd-help');

      const sync = el.querySelector<HTMLButtonElement>('[data-sync="games"]')!;
      expect(sync.getAttribute('aria-describedby')).toBe('argocd-help');
      // The Sync button has visible "Sync" text plus an explicit app-scoped name.
      expect(sync.getAttribute('aria-label')).toBe('Sync games');
    });
  });

  describe('capability gate (ArgoCD absent → graceful degradation)', () => {
    async function mountWithArgocd(present: boolean) {
      bff.platformCapabilities.and.resolveTo({ ...PLATFORM_CAPABILITIES_ABSENT, argocdPresent: present });
      // rebuild so ngOnInit re-reads (the PlatformCapabilitiesService caches per app).
      await TestBed.resetTestingModule()
        .configureTestingModule({
          imports: [ArgocdDashboardComponent],
          providers: [{ provide: BffService, useValue: bff }],
        })
        .compileComponents();
      fixture = TestBed.createComponent(ArgocdDashboardComponent);
      component = fixture.componentInstance;
      await init();
      return fixture.nativeElement as HTMLElement;
    }

    it('shows the capability-gate notice and hides the app grid + actions when ArgoCD is absent', async () => {
      const el = await mountWithArgocd(false);
      const gate = el.querySelector('[data-testid="capability-gate"]')!;
      expect(gate).withContext('gate notice present').not.toBeNull();
      expect(gate.getAttribute('data-capability')).toBe('argocd');
      expect(gate.classList).toContain('notice--warn');
      // actions are suppressed: no app grid, no sync buttons.
      expect(el.querySelector('[data-testid="argocd-app-grid"]')).toBeNull();
      expect(el.querySelector('[data-sync="games"]')).toBeNull();
      // and the dashboard never even dialled ArgoCD.
      expect(bff.argoApplications).not.toHaveBeenCalled();
    });

    it('renders the live dashboard (no gate) when ArgoCD is present', async () => {
      const el = await mountWithArgocd(true);
      expect(el.querySelector('[data-testid="capability-gate"]')).toBeNull();
      expect(el.querySelector('[data-testid="argocd-app-grid"]')).not.toBeNull();
      expect(bff.argoApplications).toHaveBeenCalled();
    });

    it('gives the gate notice an accessible name naming the missing capability', async () => {
      const el = await mountWithArgocd(false);
      const gate = el.querySelector('[data-testid="capability-gate"]')!;
      const name = gate.getAttribute('aria-label') ?? '';
      expect(name).withContext('non-empty accessible name').not.toBe('');
      expect(name.toLowerCase()).toContain('argocd');
    });
  });
});
