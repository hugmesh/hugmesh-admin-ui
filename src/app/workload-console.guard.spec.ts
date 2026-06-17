import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { workloadConsoleGuard } from './workload-console.guard';
import { SessionService } from './session.service';
import { BffService } from './bff.service';

describe('workloadConsoleGuard', () => {
  let session: jasmine.SpyObj<Pick<SessionService, 'isAdmin' | 'isSuperadmin'>>;
  let bff: jasmine.SpyObj<Pick<BffService, 'workloadCapability'>>;
  let parseUrlSpy: jasmine.Spy;

  beforeEach(() => {
    session = jasmine.createSpyObj<SessionService>('SessionService', ['isAdmin', 'isSuperadmin']);
    bff = jasmine.createSpyObj<BffService>('BffService', ['workloadCapability']);
    parseUrlSpy = jasmine.createSpy('parseUrl').and.callFake((u: string) => ({ url: u } as unknown as UrlTree));
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionService, useValue: session },
        { provide: BffService, useValue: bff },
        { provide: Router, useValue: { parseUrl: parseUrlSpy } },
      ],
    });
  });

  function run() {
    return TestBed.runInInjectionContext(() => workloadConsoleGuard(null as never, null as never)) as Promise<unknown>;
  }

  it('bounces a non-admin/non-superadmin to /login WITHOUT probing', async () => {
    session.isAdmin.and.returnValue(false);
    session.isSuperadmin.and.returnValue(false);
    const result = await run() as UrlTree;
    expect(bff.workloadCapability).not.toHaveBeenCalled();
    expect((result as unknown as { url: string }).url).toBe('/login');
  });

  it('allows an admin with a live grant (capability probe 200)', async () => {
    session.isAdmin.and.returnValue(true);
    session.isSuperadmin.and.returnValue(false);
    bff.workloadCapability.and.resolveTo({ enabled: true, readOnly: true, domain: 'brandx' });
    expect(await run()).toBeTrue();
    expect(bff.workloadCapability).toHaveBeenCalled();
  });

  it('bounces an admin WITHOUT a live grant (capability probe 404 -> null) to /admin', async () => {
    session.isAdmin.and.returnValue(true);
    session.isSuperadmin.and.returnValue(false);
    bff.workloadCapability.and.resolveTo(null);
    const result = await run() as UrlTree;
    expect((result as unknown as { url: string }).url).toBe('/admin');
  });

  it('a superadmin still goes through the server-confirmed probe', async () => {
    session.isAdmin.and.returnValue(false);
    session.isSuperadmin.and.returnValue(true);
    bff.workloadCapability.and.resolveTo({ enabled: true, readOnly: false, domain: 'brandx' });
    expect(await run()).toBeTrue();
    expect(bff.workloadCapability).toHaveBeenCalled();
  });
});
