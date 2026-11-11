import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { workloadConsoleGuard } from './workload-console.guard';
import { SessionService } from './session.service';
import { BffService } from './bff.service';

describe('workloadConsoleGuard', () => {
  let session: jasmine.SpyObj<Pick<SessionService, 'loggedIn' | 'isAdmin' | 'isSuperadmin'>>;
  let bff: jasmine.SpyObj<Pick<BffService, 'workloadCapability'>>;

  beforeEach(() => {
    session = jasmine.createSpyObj<SessionService>('SessionService', ['loggedIn', 'isAdmin', 'isSuperadmin']);
    session.loggedIn.and.returnValue(true);
    session.isAdmin.and.returnValue(false);
    session.isSuperadmin.and.returnValue(false);
    bff = jasmine.createSpyObj<BffService>('BffService', ['workloadCapability']);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SessionService, useValue: session },
        { provide: BffService, useValue: bff },
      ],
    });
  });

  async function run(url = '/admin/workloads'): Promise<true | string> {
    const state = { url } as RouterStateSnapshot;
    const result = await (TestBed.runInInjectionContext(() => workloadConsoleGuard(null as never, state)) as Promise<unknown>);
    return result === true ? true : TestBed.inject(Router).serializeUrl(result as UrlTree);
  }

  it('sends a SIGNED-IN non-admin/non-superadmin to the host denied notice WITHOUT probing', async () => {
    expect(await run('/admin/workloads/terminal')).toBe('/home?denied=%2Fadmin%2Fworkloads%2Fterminal');
    expect(bff.workloadCapability).not.toHaveBeenCalled();
  });

  it('sends a signed-out caller to /login WITHOUT probing', async () => {
    session.loggedIn.and.returnValue(false);
    expect(await run()).toBe('/login');
    expect(bff.workloadCapability).not.toHaveBeenCalled();
  });

  it('allows an admin with a live grant (capability probe 200)', async () => {
    session.isAdmin.and.returnValue(true);
    bff.workloadCapability.and.resolveTo({ enabled: true, readOnly: true, domain: 'brandx' });
    expect(await run()).toBeTrue();
    expect(bff.workloadCapability).toHaveBeenCalled();
  });

  it('bounces an admin WITHOUT a live grant (capability probe 404 -> null) to /admin', async () => {
    session.isAdmin.and.returnValue(true);
    bff.workloadCapability.and.resolveTo(null);
    expect(await run()).toBe('/admin');
  });

  it('a superadmin still goes through the server-confirmed probe', async () => {
    session.isSuperadmin.and.returnValue(true);
    bff.workloadCapability.and.resolveTo({ enabled: true, readOnly: false, domain: 'brandx' });
    expect(await run()).toBeTrue();
    expect(bff.workloadCapability).toHaveBeenCalled();
  });
});
