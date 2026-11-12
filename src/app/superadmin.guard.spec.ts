import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { superadminGuard } from './superadmin.guard';
import { SessionService } from './session.service';

describe('superadminGuard', () => {
  let session: jasmine.SpyObj<Pick<SessionService, 'loggedIn' | 'isSuperadmin'>>;

  beforeEach(() => {
    session = jasmine.createSpyObj<SessionService>('SessionService', ['loggedIn', 'isSuperadmin']);
    session.loggedIn.and.returnValue(true);
    session.isSuperadmin.and.returnValue(false);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SessionService, useValue: session }],
    });
  });

  function run(url = '/admin/device-licenses'): true | string {
    const state = { url } as RouterStateSnapshot;
    const result = TestBed.runInInjectionContext(() => superadminGuard(null as never, state));
    return result === true ? true : TestBed.inject(Router).serializeUrl(result as UrlTree);
  }

  it('allows activation for a superadmin session', () => {
    session.isSuperadmin.and.returnValue(true);
    expect(run()).toBeTrue();
  });

  it('sends a SIGNED-IN non-superadmin (e.g. a plain admin) to the host denied notice, not /login', () => {
    expect(run()).toBe('/home?denied=%2Fadmin%2Fdevice-licenses');
  });

  it('names the console that was actually refused (the URL comes from the router state, query included)', () => {
    expect(run('/admin/superadmin/anubis?tab=metrics')).toBe('/home?denied=%2Fadmin%2Fsuperadmin%2Fanubis%3Ftab%3Dmetrics');
  });

  it('sends a signed-out caller to /login', () => {
    session.loggedIn.and.returnValue(false);
    expect(run()).toBe('/login');
  });
});
