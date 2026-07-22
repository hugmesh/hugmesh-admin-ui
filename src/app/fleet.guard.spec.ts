import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { fleetAdminGuard } from './fleet.guard';
import { SessionService } from './session.service';

describe('fleetAdminGuard', () => {
  let session: jasmine.SpyObj<Pick<SessionService, 'isFleetAdmin'>>;
  let parseUrlSpy: jasmine.Spy;

  beforeEach(() => {
    session = jasmine.createSpyObj<SessionService>('SessionService', ['isFleetAdmin']);
    parseUrlSpy = jasmine.createSpy('parseUrl').and.callFake((u: string) => ({ url: u } as unknown as UrlTree));
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionService, useValue: session },
        { provide: Router, useValue: { parseUrl: parseUrlSpy } },
      ],
    });
  });

  function run() {
    return TestBed.runInInjectionContext(() => fleetAdminGuard(null as never, null as never));
  }

  it('allows activation for a session with the fleet capability', () => {
    session.isFleetAdmin.and.returnValue(true);
    expect(run()).toBeTrue();
    expect(parseUrlSpy).not.toHaveBeenCalled();
  });

  it('redirects a caller without the fleet capability to /login', () => {
    session.isFleetAdmin.and.returnValue(false);
    const result = run() as UrlTree;
    expect(parseUrlSpy).toHaveBeenCalledWith('/login');
    expect((result as unknown as { url: string }).url).toBe('/login');
  });
});
