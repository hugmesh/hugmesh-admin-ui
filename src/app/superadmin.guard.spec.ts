import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { superadminGuard } from './superadmin.guard';
import { SessionService } from './session.service';

describe('superadminGuard', () => {
  let session: jasmine.SpyObj<Pick<SessionService, 'isSuperadmin'>>;
  let parseUrlSpy: jasmine.Spy;

  beforeEach(() => {
    session = jasmine.createSpyObj<SessionService>('SessionService', ['isSuperadmin']);
    parseUrlSpy = jasmine.createSpy('parseUrl').and.callFake((u: string) => ({ url: u } as unknown as UrlTree));
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionService, useValue: session },
        { provide: Router, useValue: { parseUrl: parseUrlSpy } },
      ],
    });
  });

  function run() {
    // CanActivateFn runs in an injection context; the route/state args are unused.
    return TestBed.runInInjectionContext(() => superadminGuard(null as never, null as never));
  }

  it('allows activation for a superadmin session', () => {
    session.isSuperadmin.and.returnValue(true);
    expect(run()).toBeTrue();
    expect(parseUrlSpy).not.toHaveBeenCalled();
  });

  it('redirects a non-superadmin session to /login', () => {
    session.isSuperadmin.and.returnValue(false);
    const result = run() as UrlTree;
    expect(parseUrlSpy).toHaveBeenCalledWith('/login');
    expect((result as unknown as { url: string }).url).toBe('/login');
  });
});
