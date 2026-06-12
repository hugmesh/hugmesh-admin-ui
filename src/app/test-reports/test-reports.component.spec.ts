import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TestReportsComponent } from './test-reports.component';
import { TestReportsStore } from './test-reports-store.service';
import { BffService, TestRun, TestRunDetail } from '../bff.service';

function run(id: string, over: Partial<TestRun> = {}): TestRun {
  return {
    id, created_at: '2026-06-11T00:00:00Z', triggered_by: 'admin', tier: 'LEAN',
    trigger_source: 'ADMIN', status: 'COMPLETED', commit_sha: null, job_name: null,
    started_at: '2026-06-11T00:00:00Z', finished_at: '2026-06-11T00:01:00Z',
    total_tests: 10, passed: 9, failed: 1, skipped: 0, duration_ms: 60000,
    report_ref: 'runs/x/report.tar.gz', error: null, ...over,
  };
}

describe('TestReportsComponent', () => {
  let fixture: ComponentFixture<TestReportsComponent>;
  let component: TestReportsComponent;
  let bff: jasmine.SpyObj<BffService>;

  const finished = run('f1');
  const noReport = run('n1', { report_ref: null });

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'testReports', 'testReportDetail', 'runTestReport', 'downloadTestReport', 'streamTestRunEvents',
    ]);
    bff.testReports.and.resolveTo({ runs: [finished, noReport], launchReal: true });
    bff.runTestReport.and.resolveTo({ id: 'r2', status: 'QUEUED', tier: 'LEAN' });
    bff.downloadTestReport.and.resolveTo(true);
    bff.streamTestRunEvents.and.callFake(async (_id, onEvent) => {
      onEvent({ runId: 'r2', suite: null, role: null, state: 'passed', passed: 1, failed: 0, skipped: 0, percent: 100, message: 'done', done: true, error: null });
    });

    await TestBed.configureTestingModule({
      imports: [TestReportsComponent],
      providers: [TestReportsStore, { provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(TestReportsComponent);
    component = fixture.componentInstance;
  });

  async function init() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  // ── USER-SITUATIONAL (the admin's allowed actions + the disabled states) ─
  describe('USER-SITUATIONAL', () => {
    it('lists runs with outcome text (not colour alone)', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const row = el.querySelector(`[data-run="${finished.id}"]`)!;
      expect(row.querySelector('.t-outcome')!.textContent).toContain('passed');
      expect(row.querySelector('.t-outcome')!.textContent).toContain('failed');
    });

    it('offers download only for a run with a stored report bundle', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector(`[data-download="${finished.id}"]`)).not.toBeNull();
      expect(el.querySelector(`[data-download="${noReport.id}"]`)).toBeNull();
      expect(el.querySelector(`[data-no-report="${noReport.id}"]`)).not.toBeNull();
    });

    it('triggers a run via the run form', async () => {
      await init();
      component.tier = 'HEAVY';
      await component.runNow();
      expect(bff.runTestReport).toHaveBeenCalledWith({ tier: 'HEAVY', commitSha: null });
    });

    it('rejects a non-hex commit sha without calling the BFF', async () => {
      await init();
      component.commitSha = 'not-hex!!';
      await component.runNow();
      expect(bff.runTestReport).not.toHaveBeenCalled();
      expect(component.error()).toContain('hex');
    });

    it('shows live progress + a done message when a run completes', async () => {
      await init();
      await component.runNow();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="tr-progressbar"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="tr-done"]')).not.toBeNull();
    });

    it('surfaces an honest note when a download has no bundle', async () => {
      bff.downloadTestReport.and.resolveTo(false);
      await init();
      await component.download(finished);
      fixture.detectChanges();
      expect(component.downloadNote()).toContain('No report bundle');
    });

    it('announces the stub-seam when the launcher is not real', async () => {
      bff.testReports.and.resolveTo({ runs: [], launchReal: false });
      await init();
      expect(fixture.nativeElement.querySelector('[data-testid="tr-launch-stub"]')).not.toBeNull();
    });

    it('opens and closes the per-(suite,role) detail matrix', async () => {
      const detail: TestRunDetail = {
        run: finished,
        results: [
          { id: '1', run_id: finished.id, suite: 'auth', role: 'admin', state: 'passed', passed: 3, failed: 0, skipped: 0, duration_ms: 10, updated_at: null },
        ],
      };
      bff.testReportDetail.and.resolveTo(detail);
      await init();
      await component.toggleDetail(finished);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="tr-matrix"]')).not.toBeNull();
      expect(el.querySelector('[data-suite="auth"][data-role="admin"]')).not.toBeNull();

      await component.toggleDetail(finished); // toggle off
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="tr-matrix"]')).toBeNull();
    });
  });

  // ── CONCURRENT (teardown aborts the live stream) ──────────────────────
  describe('CONCURRENT', () => {
    it('resets the live-run stream on destroy', async () => {
      await init();
      await component.runNow();
      const spy = spyOn(component.store, 'reset').and.callThrough();
      component.ngOnDestroy();
      expect(spy).toHaveBeenCalled();
    });
  });
});
