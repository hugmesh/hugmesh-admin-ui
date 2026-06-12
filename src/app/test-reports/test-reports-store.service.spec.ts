import { TestBed } from '@angular/core/testing';
import { TestReportsStore } from './test-reports-store.service';
import { BffService, TestRun, TestRunDetail } from '../bff.service';

function run(id: string, over: Partial<TestRun> = {}): TestRun {
  return {
    id,
    created_at: '2026-06-11T00:00:00Z',
    triggered_by: 'admin',
    tier: 'LEAN',
    trigger_source: 'ADMIN',
    status: 'COMPLETED',
    commit_sha: null,
    job_name: null,
    started_at: '2026-06-11T00:00:00Z',
    finished_at: '2026-06-11T00:01:00Z',
    total_tests: 10,
    passed: 9,
    failed: 1,
    skipped: 0,
    duration_ms: 60000,
    report_ref: 'runs/x/report.tar.gz',
    error: null,
    ...over,
  };
}

describe('TestReportsStore', () => {
  let store: TestReportsStore;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(() => {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'testReports',
      'testReportDetail',
      'runTestReport',
      'downloadTestReport',
      'streamTestRunEvents',
    ]);
    bff.testReports.and.resolveTo({ runs: [run('r1')], launchReal: true });
    bff.runTestReport.and.resolveTo({ id: 'r2', status: 'QUEUED', tier: 'LEAN' });
    bff.downloadTestReport.and.resolveTo(true);
    bff.streamTestRunEvents.and.callFake(async (_id, onEvent) => {
      onEvent({
        runId: 'r2', suite: 'auth', role: 'admin', state: 'passed',
        passed: 5, failed: 0, skipped: 0, percent: 50, message: 'auth ok', done: false, error: null,
      });
      onEvent({
        runId: 'r2', suite: null, role: null, state: 'passed',
        passed: 10, failed: 0, skipped: 0, percent: 100, message: 'done', done: true, error: null,
      });
    });

    TestBed.configureTestingModule({
      providers: [TestReportsStore, { provide: BffService, useValue: bff }],
    });
    store = TestBed.inject(TestReportsStore);
  });

  // ── USER-SITUATIONAL (the admin's own console state) ──────────────────
  describe('USER-SITUATIONAL', () => {
    it('loads run history + the launchReal flag', async () => {
      await store.refreshHistory();
      expect(store.runs().length).toBe(1);
      expect(store.launchReal()).toBeTrue();
    });

    it('opens and closes a run detail matrix', async () => {
      const detail: TestRunDetail = { run: run('r1'), results: [] };
      bff.testReportDetail.and.resolveTo(detail);
      await store.openDetail('r1');
      expect(store.detail()?.run.id).toBe('r1');
      store.closeDetail();
      expect(store.detail()).toBeNull();
    });

    it('triggers a run then streams progress to completion', async () => {
      const id = await store.run({ tier: 'LEAN', commitSha: null });
      expect(id).toBe('r2');
      expect(bff.runTestReport).toHaveBeenCalledWith({ tier: 'LEAN', commitSha: null });
      // streamed two events synchronously via the fake
      expect(store.runEvents().length).toBe(2);
      expect(store.finished()).toBeTrue();
      expect(store.progress()).toBe(100);
      expect(store.tally()).toEqual({ passed: 10, failed: 0, skipped: 0 });
      expect(store.runError()).toBe('');
    });

    it('delegates the download to the BFF', async () => {
      expect(await store.bffDownload('r1')).toBeTrue();
      expect(bff.downloadTestReport).toHaveBeenCalledWith('r1');
    });
  });

  // ── CONCURRENT / CONFLICTING (a new run supersedes an in-flight stream) ─
  describe('CONCURRENT', () => {
    it('reset() aborts the active stream and clears live state', async () => {
      await store.run({ tier: 'LEAN', commitSha: null });
      expect(store.activeRunId()).toBe('r2');
      store.reset();
      expect(store.activeRunId()).toBeNull();
      expect(store.runEvents()).toEqual([]);
    });

    it('surfaces a stream error as a synthetic terminal event (no silent stall)', async () => {
      bff.streamTestRunEvents.and.rejectWith(new Error('boom'));
      await store.run({ tier: 'HEAVY', commitSha: null });
      expect(store.finished()).toBeTrue();
      expect(store.runError()).toContain('interrupted');
    });
  });
});
