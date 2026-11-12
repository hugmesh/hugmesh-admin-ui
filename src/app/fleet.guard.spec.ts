import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { fleetAdminGuard } from './fleet.guard';
import { SessionService } from './session.service';

describe('fleetAdminGuard', () => {
  let session: jasmine.SpyObj<Pick<SessionService, 'loggedIn' | 'isFleetAdmin'>>;

  beforeEach(() => {
    session = jasmine.createSpyObj<SessionService>('SessionService', ['loggedIn', 'isFleetAdmin']);
    session.loggedIn.and.returnValue(true);
    session.isFleetAdmin.and.returnValue(false);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SessionService, useValue: session }],
    });
  });

  function run(url = '/admin/my-fleet'): true | string {
    const state = { url } as RouterStateSnapshot;
    const result = TestBed.runInInjectionContext(() => fleetAdminGuard(null as never, state));
    return result === true ? true : TestBed.inject(Router).serializeUrl(result as UrlTree);
  }

  it('allows activation for a session with the fleet capability', () => {
    session.isFleetAdmin.and.returnValue(true);
    expect(run()).toBeTrue();
  });

  it('sends a SIGNED-IN caller without the fleet capability to the host denied notice, not /login', () => {
    expect(run()).toBe('/home?denied=%2Fadmin%2Fmy-fleet');
  });

  it('sends a signed-out caller to /login', () => {
    session.loggedIn.and.returnValue(false);
    expect(run()).toBe('/login');
  });
});
