import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GamesServicesComponent } from './games-services.component';
import { BffService, GameInstance, GameOffer } from '../bff.service';
import { SessionService, HugSession } from '../session.service';

const offers = (): GameOffer[] => [
  { slug: 'minetest', displayName: 'Luanti', licenseSpdx: 'LGPL-2.1-or-later', protocol: 'udp', maxInstances: 3, summary: 'voxel sandbox' },
  { slug: 'xonotic', displayName: 'Xonotic', licenseSpdx: 'GPL-2.0-or-later', protocol: 'udp', maxInstances: 2, summary: null },
];

const instance = (over: Partial<GameInstance> = {}): GameInstance => ({
  id: 'inst-1', domain: 'brandx', slug: 'minetest', name: 'world1', state: 'active',
  propagationState: 'applied', ownerSubject: 'alice', createdAt: '2026-06-01T00:00:00Z',
  endingAt: null, namespace: 'hugmesh-games-instances', nodePort: 31000,
  consolePath: '/games/servers/minetest/world1/', updatedAt: '2026-06-01T00:00:00Z', ...over,
});

function session(roles: string[]): HugSession {
  return {
    id: 'google:alice', label: 'alice', provider: 'google', roles,
    registrationComplete: true,
  };
}

describe('GamesServicesComponent', () => {
  let fixture: ComponentFixture<GamesServicesComponent>;
  let component: GamesServicesComponent;
  let bff: jasmine.SpyObj<BffService>;
  let sessionSvc: SessionService;

  async function setup(roles: string[]): Promise<void> {
    bff = jasmine.createSpyObj<BffService>('BffService',
      ['gamesOfferedCatalog', 'gamesInstances', 'createGameInstance', 'gameInstanceAction']);
    bff.gamesOfferedCatalog.and.resolveTo(offers());
    bff.gamesInstances.and.resolveTo([instance()]);
    await TestBed.configureTestingModule({
      imports: [GamesServicesComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    sessionSvc = TestBed.inject(SessionService);
    sessionSvc.set(session(roles));
    fixture = TestBed.createComponent(GamesServicesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => sessionSvc?.clear());

  // ── USER-SITUATIONAL ──────────────────────────────────────────────────────

  it('lists the offered catalog + instances on init', async () => {
    await setup(['games_services_admin']);
    expect(bff.gamesOfferedCatalog).toHaveBeenCalledTimes(1);
    expect(bff.gamesInstances).toHaveBeenCalledTimes(1);
    expect(component.offers().length).toBe(2);
    expect(component.instances().length).toBe(1);
  });

  it('admin can create an instance; the new row is prepended', async () => {
    await setup(['games_services_admin']);
    bff.createGameInstance.and.resolveTo(instance({ id: 'inst-2', name: 'world2', state: 'pending' }));
    component.slug = 'minetest';
    component.name = 'world2';
    await component.create();
    expect(bff.createGameInstance).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ slug: 'minetest', name: 'world2' }));
    expect(component.instances()[0].name).toBe('world2');
  });

  it('admin create with TTL converts hours to seconds', async () => {
    await setup(['games_services_admin']);
    bff.createGameInstance.and.resolveTo(instance({ id: 'inst-3', name: 'timed' }));
    component.slug = 'minetest';
    component.name = 'timed';
    component.ttlHours = '2';
    await component.create();
    expect(bff.createGameInstance).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ ttlSeconds: 7200 }));
  });

  // ── MULTIUSER / DENY (runner) ───────────────────────────────────────────────

  it('runner cannot create: canCreate is false and create is a no-op', async () => {
    await setup(['games_services_runner']);
    expect(component.canCreate()).toBeFalse();
    component.slug = 'minetest';
    component.name = 'nope';
    await component.create();
    expect(bff.createGameInstance).not.toHaveBeenCalled();
  });

  it('runner sees the create form disabled + the runner help text', async () => {
    await setup(['games_services_runner']);
    const el: HTMLElement = fixture.nativeElement;
    const createBtn = el.querySelector<HTMLButtonElement>('[data-testid="gs-create"]')!;
    expect(createBtn.disabled).toBeTrue();
    expect(el.querySelector('[data-testid="gs-runner-help"]')).not.toBeNull();
  });

  // ── run/stop (admin OR runner) ───────────────────────────────────────────────

  it('runner can run/stop: terminate calls the BFF and updates the row', async () => {
    await setup(['games_services_runner']);
    bff.gameInstanceAction.and.resolveTo(instance({ state: 'terminated' }));
    await component.act(instance(), 'terminate');
    expect(bff.gameInstanceAction).toHaveBeenCalledOnceWith('inst-1', 'terminate');
    expect(component.instances()[0].state).toBe('terminated');
  });

  // ── error surfacing ──────────────────────────────────────────────────────────

  it('surfaces the BFF creation-gate 403 verbatim in formError', async () => {
    await setup(['games_services_admin']);
    bff.createGameInstance.and.rejectWith(new Error('instance quota reached for \'minetest\' in this domain (3/3)'));
    component.slug = 'minetest';
    component.name = 'overquota';
    await component.create();
    expect(component.formError()).toContain('quota reached');
  });

  it('rejects a non-DNS-label instance name without calling the BFF', async () => {
    await setup(['games_services_admin']);
    component.slug = 'minetest';
    component.name = 'Bad Name!';
    await component.create();
    expect(bff.createGameInstance).not.toHaveBeenCalled();
    expect(component.formError()).toContain('DNS label');
  });

  // ── ACCESSIBILITY ──────────────────────────────────────────────────────────

  it('labels the view + renders errors in a role=alert live region', async () => {
    await setup(['games_services_admin']);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[aria-labelledby="gs-heading"]')).not.toBeNull();
    bff.createGameInstance.and.rejectWith(new Error('boom'));
    component.slug = 'minetest';
    component.name = 'world9';
    await component.create();
    fixture.detectChanges();
    const alert = el.querySelector('[data-testid="gs-form-error"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });
});
