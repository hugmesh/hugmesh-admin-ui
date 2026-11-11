import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, provideRouter } from '@angular/router';
import { DENIED_PATH, refuseNavigation } from './guard-refusal';
import { SessionService } from './session.service';

describe('refuseNavigation (shared refusal for every route guard in this remote)', () => {
  let session: jasmine.SpyObj<Pick<SessionService, 'loggedIn'>>;

  beforeEach(() => {
    session = jasmine.createSpyObj<SessionService>('SessionService', ['loggedIn']);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SessionService, useValue: session }],
    });
  });

  function refuse(url: string): string {
    const tree = TestBed.runInInjectionContext(() => refuseNavigation({ url } as RouterStateSnapshot));
    return TestBed.inject(Router).serializeUrl(tree);
  }

  it('uses the host shell DENIED_PATH (/home), never the sign-in page', () => {
    expect(DENIED_PATH).toBe('/home');
  });

  it('sends a SIGNED-IN caller to /home?denied=<attempted url>', () => {
    session.loggedIn.and.returnValue(true);
    expect(refuse('/admin/egress-vpn')).toBe('/home?denied=%2Fadmin%2Fegress-vpn');
  });

  it('carries the attempted URL verbatim, including its query string', () => {
    session.loggedIn.and.returnValue(true);
    const tree = TestBed.runInInjectionContext(() => refuseNavigation({ url: '/admin/superadmin/domains?q=a&b=1' } as RouterStateSnapshot));
    expect(tree.queryParams).toEqual({ denied: '/admin/superadmin/domains?q=a&b=1' });
    expect(tree.root.children['primary'].segments.map((s) => s.path)).toEqual(['home']);
  });

  it('sends a signed-out caller to /login with no denied marker', () => {
    session.loggedIn.and.returnValue(false);
    expect(refuse('/admin/egress-vpn')).toBe('/login');
  });
});
