import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TestRun } from '../bff.service';
import { TestReportsStore } from './test-reports-store.service';

/**
 * Admin "Test reports" console (ROLE_ADMIN only, route-guarded). The durable
 * test-architecture run history (lean/heavy, timestamps, pass/fail, tier, source)
 * with: a RUN-on-demand form, a per-run report download, an inline per-(suite,role)
 * detail matrix, and a LIVE SSE progress widget (progressbar + event list) for an
 * in-flight run.
 *
 * <p>Wired to the EXISTING admin-bff TestReportsController:
 * GET /bff/admin/test-reports (list), GET /{id} (detail), GET /{id}/download
 * (tar.gz), POST /run (trigger), GET /{id}/events (SSE). Admin gating is
 * defence-in-depth (gateway + resource-server filter + @PreAuthorize); this UI
 * mirrors it but the admin-bff is the source of truth. SSE uses the bearer-fetch
 * ReadableStream reader (NOT EventSource) so the Casdoor Bearer is sent.
 */
@Component({
  selector: 'snap-test-reports',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './test-reports.component.html',
  styleUrl: './test-reports.component.scss',
})
export class TestReportsComponent implements OnInit, OnDestroy {
  readonly store = inject(TestReportsStore);

  tier: 'LEAN' | 'HEAVY' = 'LEAN';
  commitSha = '';
  readonly error = signal('');
  readonly running = signal(false);
  /** A polite note when a download has no bundle yet (run not finished/scrubbed). */
  readonly downloadNote = signal('');

  async ngOnInit(): Promise<void> {
    await this.store.refreshHistory();
  }

  ngOnDestroy(): void {
    this.store.reset();
  }

  /** A run produces a downloadable bundle only once it has a stored report_ref. */
  canDownload(run: TestRun): boolean {
    return !!run.report_ref;
  }

  async runNow(): Promise<void> {
    if (this.commitSha && !/^[0-9a-fA-F]{0,64}$/.test(this.commitSha.trim())) {
      this.error.set('Commit SHA must be a hex git sha (0-9, a-f).');
      return;
    }
    this.error.set('');
    this.running.set(true);
    try {
      await this.store.run({ tier: this.tier, commitSha: this.commitSha.trim() || null });
      this.commitSha = '';
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not start the run.');
    } finally {
      this.running.set(false);
    }
  }

  async toggleDetail(run: TestRun): Promise<void> {
    if (this.store.detail()?.run.id === run.id) {
      this.store.closeDetail();
      return;
    }
    await this.store.openDetail(run.id);
  }

  async download(run: TestRun): Promise<void> {
    this.downloadNote.set('');
    const ok = await this.store.bffDownload(run.id);
    if (!ok) {
      this.downloadNote.set('No report bundle is available for this run yet.');
    }
  }

  /** Stable, AT-friendly summary text for a run's outcome (never colour-alone). */
  outcomeText(run: TestRun): string {
    if (run.status === 'QUEUED' || run.status === 'RUNNING') return run.status.toLowerCase();
    if (run.status === 'ERROR') return 'error (inconclusive)';
    return `${run.passed} passed · ${run.failed} failed · ${run.skipped} skipped`;
  }
}
