import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { gamesServicesGuard } from './games-services.guard';
import { SessionService } from './session.service';

describe('gamesServicesGuard', () => {
  let session: jasmine.SpyObj<Pick<SessionService, 'loggedIn' | 'isGamesServicesAdmin' | 'isGamesServicesRunner'>>;

  beforeEach(() => {
    session = jasmine.createSpyObj<SessionService>('SessionService',
      ['loggedIn', 'isGamesServicesAdmin', 'isGamesServicesRunner']);
    session.loggedIn.and.returnValue(true);
    session.isGamesServicesAdmin.and.returnValue(false);
    session.isGamesServicesRunner.and.returnValue(false);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SessionService, useValue: session }],
    });
  });

  function run(url = '/admin/games-services'): true | string {
    const state = { url } as RouterStateSnapshot;
    const result = TestBed.runInInjectionContext(() => gamesServicesGuard(null as never, state));
    return result === true ? true : TestBed.inject(Router).serializeUrl(result as UrlTree);
  }

  it('allows activation for a games-services ADMIN', () => {
    session.isGamesServicesAdmin.and.returnValue(true);
    expect(run()).toBeTrue();
  });

  it('allows activation for a games-services RUNNER', () => {
    session.isGamesServicesRunner.and.returnValue(true);
    expect(run()).toBeTrue();
  });

  it('sends a SIGNED-IN caller with neither games-services role to the host denied notice, not /login', () => {
    expect(run()).toBe('/home?denied=%2Fadmin%2Fgames-services');
  });

  it('sends a signed-out caller to /login', () => {
    session.loggedIn.and.returnValue(false);
    expect(run()).toBe('/login');
  });
});
