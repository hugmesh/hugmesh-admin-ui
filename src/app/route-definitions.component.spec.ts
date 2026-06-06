import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouteDefinitionsComponent } from './route-definitions.component';
import { BffService, RouteDefinition } from './bff.service';

describe('RouteDefinitionsComponent', () => {
  let fixture: ComponentFixture<RouteDefinitionsComponent>;
  let component: RouteDefinitionsComponent;
  let bff: jasmine.SpyObj<BffService>;

  const def: RouteDefinition = {
    pathPrefix: '/api/games/',
    downstreamUri: 'http://svc:8080',
    serviceName: 'games',
    requiredRole: null,
  };

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'routeDefinitions', 'upsertRouteDefinition', 'removeRouteDefinition',
    ]);
    bff.routeDefinitions.and.resolveTo([def]);
    await TestBed.configureTestingModule({
      imports: [RouteDefinitionsComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(RouteDefinitionsComponent);
    component = fixture.componentInstance;
  });

  it('loads route definitions on init and renders a row per definition', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(bff.routeDefinitions).toHaveBeenCalledTimes(1);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-route-prefix="/api/games/"]')).not.toBeNull();
  });

  it('upserts a trimmed definition and clears prefix + uri inputs', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.upsertRouteDefinition.and.resolveTo([def]);

    component.pathPrefix = '  /api/x/ ';
    component.downstreamUri = '  http://x:8080  ';
    await component.add();

    expect(bff.upsertRouteDefinition).toHaveBeenCalledWith(jasmine.objectContaining({
      pathPrefix: '/api/x/', downstreamUri: 'http://x:8080',
    }));
    expect(component.pathPrefix).toBe('');
    expect(component.downstreamUri).toBe('');
  });

  it('removes a definition by path prefix through the BFF', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.removeRouteDefinition.and.resolveTo([]);
    await component.remove('/api/games/');
    expect(bff.removeRouteDefinition).toHaveBeenCalledWith('/api/games/');
  });

  describe('accessibility', () => {
    it('associates each input with a <label for>', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      for (const id of ['rd-prefix', 'rd-uri', 'rd-service', 'rd-role']) {
        expect(el.querySelector(`#${id}`)).withContext(`#${id}`).not.toBeNull();
        expect(el.querySelector(`label[for="${id}"]`)).withContext(`label for #${id}`).not.toBeNull();
      }
    });

    it('announces a blank-form submit in role=alert/assertive and blocks the BFF call', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      bff.upsertRouteDefinition.calls.reset();
      component.pathPrefix = '';
      component.downstreamUri = '';
      await component.add();
      fixture.detectChanges();

      expect(bff.upsertRouteDefinition).not.toHaveBeenCalled();
      const el: HTMLElement = fixture.nativeElement;
      const alert = el.querySelector('[data-testid="rd-error"]')!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.getAttribute('aria-live')).toBe('assertive');
      expect(el.querySelector<HTMLInputElement>('#rd-prefix')!.getAttribute('aria-invalid')).toBe('true');
    });

    it('gives each remove button a descriptive aria-label naming its prefix', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const btn = el.querySelector<HTMLButtonElement>('[data-remove="/api/games/"]')!;
      expect(btn.getAttribute('type')).toBe('button');
      expect(btn.getAttribute('aria-label')).toContain('/api/games/');
    });
  });
});
