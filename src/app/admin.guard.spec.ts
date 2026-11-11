import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { adminGuard } from './admin.guard';
import { SessionService } from './session.service';

describe('adminGuard', () => {
  let session: jasmine.SpyObj<Pick<SessionService, 'loggedIn' | 'isAdmin' | 'isSuperadmin'>>;

  beforeEach(() => {
    session = jasmine.createSpyObj<SessionService>('SessionService', ['loggedIn', 'isAdmin', 'isSuperadmin']);
    session.loggedIn.and.returnValue(true);
    session.isAdmin.and.returnValue(false);
    session.isSuperadmin.and.returnValue(false);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SessionService, useValue: session }],
    });
  });

  /** Run the guard for `url` (as the host mounts it, under /admin) and serialize a redirect. */
  function run(url = '/admin/mesh-tokens'): true | string {
    const state = { url } as RouterStateSnapshot;
    const result = TestBed.runInInjectionContext(() => adminGuard(null as never, state));
    return result === true ? true : TestBed.inject(Router).serializeUrl(result as UrlTree);
  }

  it('allows activation for an admin session', () => {
    session.isAdmin.and.returnValue(true);
    expect(run()).toBeTrue();
  });

  it('allows activation for a superadmin-ONLY session (admin-bff RoleHierarchy: SUPERADMIN > ADMIN)', () => {
    session.isSuperadmin.and.returnValue(true);
    expect(run()).toBeTrue();
  });

  it('sends a SIGNED-IN caller without admin/superadmin to the host denied notice, naming the refused console', () => {
    expect(run()).toBe('/home?denied=%2Fadmin%2Fmesh-tokens');
  });

  it('sends a signed-out caller to /login', () => {
    session.loggedIn.and.returnValue(false);
    expect(run()).toBe('/login');
  });
});
