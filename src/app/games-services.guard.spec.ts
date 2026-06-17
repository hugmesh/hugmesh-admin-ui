import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { gamesServicesGuard } from './games-services.guard';
import { SessionService } from './session.service';

describe('gamesServicesGuard', () => {
  let session: jasmine.SpyObj<Pick<SessionService, 'isGamesServicesAdmin' | 'isGamesServicesRunner'>>;
  let parseUrlSpy: jasmine.Spy;

  beforeEach(() => {
    session = jasmine.createSpyObj<SessionService>('SessionService',
      ['isGamesServicesAdmin', 'isGamesServicesRunner']);
    parseUrlSpy = jasmine.createSpy('parseUrl').and.callFake((u: string) => ({ url: u } as unknown as UrlTree));
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionService, useValue: session },
        { provide: Router, useValue: { parseUrl: parseUrlSpy } },
      ],
    });
  });

  function run() {
    return TestBed.runInInjectionContext(() => gamesServicesGuard(null as never, null as never));
  }

  it('allows activation for a games-services ADMIN', () => {
    session.isGamesServicesAdmin.and.returnValue(true);
    session.isGamesServicesRunner.and.returnValue(false);
    expect(run()).toBeTrue();
    expect(parseUrlSpy).not.toHaveBeenCalled();
  });

  it('allows activation for a games-services RUNNER', () => {
    session.isGamesServicesAdmin.and.returnValue(false);
    session.isGamesServicesRunner.and.returnValue(true);
    expect(run()).toBeTrue();
    expect(parseUrlSpy).not.toHaveBeenCalled();
  });

  it('redirects a caller with neither games-services role to /login', () => {
    session.isGamesServicesAdmin.and.returnValue(false);
    session.isGamesServicesRunner.and.returnValue(false);
    const result = run() as UrlTree;
    expect(parseUrlSpy).toHaveBeenCalledWith('/login');
    expect((result as unknown as { url: string }).url).toBe('/login');
  });
});
