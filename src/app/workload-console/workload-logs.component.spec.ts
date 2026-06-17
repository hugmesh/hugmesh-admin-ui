import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkloadLogsComponent } from './workload-logs.component';
import { BffService, WorkloadLogLine } from '../bff.service';

describe('WorkloadLogsComponent', () => {
  let fixture: ComponentFixture<WorkloadLogsComponent>;
  let component: WorkloadLogsComponent;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(() => {
    bff = jasmine.createSpyObj<BffService>('BffService', ['streamWorkloadLogs']);
    TestBed.configureTestingModule({
      imports: [WorkloadLogsComponent],
      providers: [{ provide: BffService, useValue: bff }],
    });
    fixture = TestBed.createComponent(WorkloadLogsComponent);
    component = fixture.componentInstance;
  });

  it('refuses to start with a blank pod and shows an error', async () => {
    component.pod = '';
    await component.start();
    expect(component.error()).toBeTruthy();
    expect(bff.streamWorkloadLogs).not.toHaveBeenCalled();
  });

  it('streams redacted lines into the signal and announces start/stop', async () => {
    bff.streamWorkloadLogs.and.callFake(async (_ns, _pod, _c, onLine) => {
      onLine({ container: 'web', line: 'hello', ts: null } as WorkloadLogLine);
      onLine({ container: 'web', line: 'world', ts: null } as WorkloadLogLine);
    });
    component.pod = 'web-abc';
    await component.start();
    expect(bff.streamWorkloadLogs).toHaveBeenCalled();
    expect(component.lines().length).toBe(2);
    expect(component.lines()[0].line).toBe('hello');
    expect(component.statusMsg()).toContain('ended');
  });

  it('stop() aborts the stream and announces it', async () => {
    component.pod = 'web-abc';
    // never-resolving stream so we can stop it
    bff.streamWorkloadLogs.and.callFake(() => new Promise<void>(() => {}));
    const p = component.start();
    component.stop();
    expect(component.streaming()).toBeFalse();
    expect(component.statusMsg()).toContain('stopped');
    await Promise.race([p, Promise.resolve()]);
  });
});
