import { Injectable, computed, inject, signal } from '@angular/core';
import {
  BffService,
  StartTestRunRequest,
  TestRun,
  TestRunDetail,
  TestRunEvent,
} from '../bff.service';

/**
 * Datastore for the admin Test-Reports console (ROLE_ADMIN only). A single
 * signal-backed service (the platform's RxJS-subject/signal datastore standard)
 * shared by the list, detail and run views so they observe one consistent view
 * of: the run history, the selected run's per-(suite,role) matrix, and the LIVE
 * progress of an in-flight run streamed from the admin-bff SSE endpoint.
 *
 * <p>This is the {@code BackupStore} pattern cloned verbatim (job → run): the SSE
 * is consumed via the bearer-fetch ReadableStream reader (NOT raw EventSource —
 * which cannot send the Casdoor Bearer), a stream error surfaces as a synthetic
 * terminal event so the aria-live region announces it instead of stalling, and no
 * secret is ever held here (there is none on a test run).
 */
@Injectable({ providedIn: 'root' })
export class TestReportsStore {
  private readonly bff = inject(BffService);

  /** The selectable run tiers (label + wire value + hint). Static vocabulary
   *  mirroring the admin-bff closed TestRun tier vocabulary (LEAN|HEAVY). */
  readonly tiers: ReadonlyArray<{ value: 'LEAN' | 'HEAVY'; label: string; hint: string }> = [
    { value: 'LEAN', label: 'Lean', hint: 'fe / be / pki-ready suites (Pi-friendly).' },
    { value: 'HEAVY', label: 'Heavy', hint: 'x86-attach: Kafka + ClickHouse + observability paths.' },
  ];

  readonly runs = signal<TestRun[]>([]);
  /** Whether the launcher actually applies k8s Jobs (false = stub-seam: a run is
   *  recorded QUEUED but no real cluster Job is launched — surfaced honestly). */
  readonly launchReal = signal<boolean>(false);

  /** The currently-opened run's detail (summary + per-(suite,role) matrix). */
  readonly detail = signal<TestRunDetail | null>(null);

  /** Live SSE events for the in-flight run (cleared when a new run starts). */
  readonly runEvents = signal<TestRunEvent[]>([]);
  /** The id of the run currently being streamed, or null when idle. */
  readonly activeRunId = signal<string | null>(null);

  /** The latest progress percent of the in-flight run (0..100). */
  readonly progress = computed(() => {
    const evs = this.runEvents();
    return evs.length ? evs[evs.length - 1].percent : 0;
  });
  /** Whether the in-flight run has reached a terminal (done) event. */
  readonly finished = computed(() => {
    const evs = this.runEvents();
    return evs.length > 0 && evs[evs.length - 1].done;
  });
  /** A terminal error message for the in-flight run, or '' when none. */
  readonly runError = computed(() => {
    const last = this.runEvents().at(-1);
    return last?.error ?? '';
  });
  /** Rolling pass/fail/skip tally from the latest event (live-tally for a late
   *  subscriber). */
  readonly tally = computed(() => {
    const last = this.runEvents().at(-1);
    return last
      ? { passed: last.passed, failed: last.failed, skipped: last.skipped }
      : { passed: 0, failed: 0, skipped: 0 };
  });

  private abort?: AbortController;

  async refreshHistory(): Promise<void> {
    const list = await this.bff.testReports();
    this.runs.set(list.runs);
    this.launchReal.set(list.launchReal);
  }

  async openDetail(id: string): Promise<void> {
    this.detail.set(await this.bff.testReportDetail(id));
  }

  closeDetail(): void {
    this.detail.set(null);
  }

  /** Download a run's report bundle (bearer fetch → Blob → synthetic anchor).
   *  Returns false when there is no bundle / the request is denied. */
  bffDownload(id: string): Promise<boolean> {
    return this.bff.downloadTestReport(id);
  }

  /** Trigger a run on-demand and begin streaming its progress. Returns the id. */
  async run(req: StartTestRunRequest): Promise<string> {
    const { id } = await this.bff.runTestReport(req);
    this.beginStream(id);
    return id;
  }

  /** Reset the live-run view (e.g. before starting a new run). */
  reset(): void {
    this.abort?.abort();
    this.abort = undefined;
    this.runEvents.set([]);
    this.activeRunId.set(null);
  }

  private beginStream(runId: string): void {
    this.reset();
    this.activeRunId.set(runId);
    this.abort = new AbortController();
    this.bff
      .streamTestRunEvents(runId, (e) => this.runEvents.update((cur) => [...cur, e]), this.abort.signal)
      .catch(() => {
        if (!this.finished()) {
          this.runEvents.update((cur) => [
            ...cur,
            {
              runId,
              suite: null,
              role: null,
              state: 'failed',
              passed: 0,
              failed: 0,
              skipped: 0,
              percent: 100,
              done: true,
              message: 'progress stream interrupted',
              error: 'progress stream interrupted',
            },
          ]);
        }
      })
      .finally(() => {
        void this.refreshHistory();
      });
  }
}
