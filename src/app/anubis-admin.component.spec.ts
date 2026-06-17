import { TestBed } from '@angular/core/testing';
import { AnubisAdminComponent } from './anubis-admin.component';
import { BffService, AnubisStatus } from './bff.service';

const ENABLED_STATUS: AnubisStatus = {
  enabled: true, reachable: true, health: 'ok',
  managementUrl: 'http://localhost:9090', difficulty: 5,
};
const DISABLED_STATUS: AnubisStatus = {
  enabled: false, reachable: false, health: 'not-enabled',
  managementUrl: 'http://localhost:9090', difficulty: 5,
};

describe('AnubisAdminComponent', () => {
  let bff: jasmine.SpyObj<BffService>;

  function setup(status: AnubisStatus = ENABLED_STATUS) {
    bff = jasmine.createSpyObj<BffService>('BffService', ['anubisStatus', 'anubisMetrics']);
    bff.anubisStatus.and.resolveTo(status);
    bff.anubisMetrics.and.resolveTo({ enabled: status.enabled, raw: '', metrics: [] });
    TestBed.configureTestingModule({
      imports: [AnubisAdminComponent],
      providers: [{ provide: BffService, useValue: bff }],
    });
    return TestBed.createComponent(AnubisAdminComponent).componentInstance;
  }

  it('loads status and metrics on init', async () => {
    const c = setup();
    await c.ngOnInit();
    expect(bff.anubisStatus).toHaveBeenCalled();
    expect(bff.anubisMetrics).toHaveBeenCalled();
    expect(c.status()?.enabled).toBe(true);
    expect(c.loading()).toBe(false);
  });

  it('shows disabled status when anubis not enabled', async () => {
    const c = setup(DISABLED_STATUS);
    await c.ngOnInit();
    expect(c.status()?.enabled).toBe(false);
    expect(c.status()?.reachable).toBe(false);
  });

  it('sets metrics from response', async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', ['anubisStatus', 'anubisMetrics']);
    bff.anubisStatus.and.resolveTo(ENABLED_STATUS);
    bff.anubisMetrics.and.resolveTo({
      enabled: true, raw: 'anubis_requests_total 5\n',
      metrics: [{ name: 'anubis_requests_total', value: 5 }],
    });
    TestBed.configureTestingModule({
      imports: [AnubisAdminComponent],
      providers: [{ provide: BffService, useValue: bff }],
    });
    const c = TestBed.createComponent(AnubisAdminComponent).componentInstance;
    await c.ngOnInit();
    expect(c.metrics().length).toBe(1);
    expect(c.metrics()[0].name).toBe('anubis_requests_total');
    expect(c.rawMetrics()).toContain('anubis_requests_total');
  });

  it('toggleAutoRefresh stops and starts the timer', async () => {
    const c = setup();
    await c.ngOnInit();
    expect(c.autoRefresh()).toBe(true);
    c.toggleAutoRefresh();
    expect(c.autoRefresh()).toBe(false);
    c.toggleAutoRefresh();
    expect(c.autoRefresh()).toBe(true);
    c.ngOnDestroy();
  });

  it('toggleRaw flips the showRaw flag', () => {
    const c = setup();
    expect(c.showRaw()).toBe(false);
    c.toggleRaw();
    expect(c.showRaw()).toBe(true);
    c.toggleRaw();
    expect(c.showRaw()).toBe(false);
  });

  it('setTab switches active tab', () => {
    const c = setup();
    c.setTab('metrics');
    expect(c.activeTab()).toBe('metrics');
    c.setTab('status');
    expect(c.activeTab()).toBe('status');
  });

  it('clears timer on destroy', async () => {
    const c = setup();
    await c.ngOnInit();
    spyOn(globalThis, 'clearInterval');
    c.ngOnDestroy();
    expect(clearInterval).toHaveBeenCalled();
  });
});
