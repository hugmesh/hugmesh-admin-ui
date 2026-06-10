import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ArgocdDashboardComponent } from './argocd-dashboard.component';
import { BffService, ArgoApp, ArgoAppDetail } from './bff.service';

describe('ArgocdDashboardComponent', () => {
  let fixture: ComponentFixture<ArgocdDashboardComponent>;
  let component: ArgocdDashboardComponent;
  let bff: jasmine.SpyObj<BffService>;

  const games: ArgoApp = {
    name: 'games', project: 'snapdragon', namespace: 'snapdragon-games',
    syncStatus: 'OutOfSync', health: 'Degraded', revision: 'abc123',
  };
  const detail: ArgoAppDetail = {
    app: games,
    resourceTree: { nodes: [{
      group: 'apps', kind: 'Deployment', namespace: 'snapdragon-games', name: 'games',
      version: 'v1', syncStatus: '', health: 'Degraded', parentRefs: [],
    }] },
    message: 'replicas unavailable',
  };

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService',
      ['argoApplications', 'argoApplication', 'argoSync']);
    bff.argoApplications.and.resolveTo({ items: [games], unavailable: false });
    await TestBed.configureTestingModule({
      imports: [ArgocdDashboardComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(ArgocdDashboardComponent);
    component = fixture.componentInstance;
  });

  async function init() {
    fixture.detectChanges();
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

  it('maps statuses to colour-modifier classes (paired with the text)', () => {
    expect(component.syncClass('Synced')).toBe('is-synced');
    expect(component.syncClass('OutOfSync')).toBe('is-outofsync');
    expect(component.healthClass('Healthy')).toBe('is-healthy');
    expect(component.healthClass('Degraded')).toBe('is-degraded');
    expect(component.healthClass('weird')).toBe('is-unknown');
  });
});
