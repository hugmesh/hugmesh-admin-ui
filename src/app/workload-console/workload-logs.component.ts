import { Component, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, WorkloadLogLine } from '../bff.service';

/**
 * SUPERADMIN live log viewer — the SSE {@code logs -f} live-tail (DANGEROUS tier). Mirrors
 * the backup-store SSE signal pattern: a bearer fetch + ReadableStream reader pushing each
 * server-REDACTED line into a signal. Start/stop is announced via an aria-live region; the
 * log region is {@code aria-live="polite"} so a screen reader is not flooded line-by-line.
 *
 * <p>The stream is SA-only + dangerous-tier-gated + heartbeat-re-authorized server-side; the
 * BFF tears the stream down on a revoke/kill. The route is reachable only through the
 * grant guard, and the BFF re-checks the whole predicate.
 */
@Component({
  selector: 'hug-workload-logs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './workload-logs.component.html',
  styleUrl: './workload-console.component.scss',
})
export class WorkloadLogsComponent implements OnDestroy {
  private readonly bff = inject(BffService);

  /** The Kubernetes namespace of the target pod. */
  namespace = 'snapdragon-backend';
  /** The pod name to stream logs from. */
  pod = '';
  /** Optional container name (omit to use the first/only container). */
  container = '';

  /**
   * Live log lines, capped at the last 2000 entries to avoid unbounded memory growth.
   * Each line is a `WorkloadLogLine` with a container name, the (BFF-redacted) log text,
   * and an optional timestamp.
   */
  readonly lines = signal<WorkloadLogLine[]>([]);
  /** True while the SSE stream is open (drives the Start/Stop toggle). */
  readonly streaming = signal(false);
  /** Status message announced in an aria-live region (started / ended / stopped). */
  readonly statusMsg = signal('');
  /** Error message from the stream — empty on clean start/stop, set on network errors. */
  readonly error = signal('');

  /** The AbortController used to cancel the in-flight stream on `stop()` or component destroy. */
  private abort: AbortController | null = null;

  /**
   * Open the SSE log stream for the target pod. Uses the bearer-fetch + ReadableStream
   * pattern (NOT native `EventSource`) so the `Authorization: Bearer` header can be sent.
   * New lines are appended to `lines`, capped at the last 2000 entries.
   *
   * An `AbortError` on cancel is swallowed (it is the expected path for `stop()` and
   * `ngOnDestroy`); any other error is surfaced in the `error` signal.
   */
  async start(): Promise<void> {
    if (this.streaming() || !this.pod.trim()) {
      if (!this.pod.trim()) this.error.set('Enter a pod name.');
      return;
    }
    this.error.set('');
    this.lines.set([]);
    this.abort = new AbortController();
    this.streaming.set(true);
    this.statusMsg.set('Live log stream started.');
    try {
      await this.bff.streamWorkloadLogs(
        this.namespace, this.pod.trim(), this.container.trim() || undefined,
        // Append each line, keeping only the last 2000 (a sliding window to bound memory).
        (line) => this.lines.update((cur) => [...cur.slice(-2000), line]),
        this.abort.signal);
      this.statusMsg.set('Log stream ended.');
    } catch (e) {
      // AbortError is expected when stop() or ngOnDestroy cancels — swallow it silently.
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        this.error.set(e instanceof Error ? e.message : String(e));
      }
    } finally {
      this.streaming.set(false);
    }
  }

  /**
   * Cancel the in-flight log stream. The `AbortController` sends an abort signal to
   * the underlying `fetch` inside `BffService.streamWorkloadLogs`, which resolves the
   * stream cleanly.
   */
  stop(): void {
    this.abort?.abort();
    this.abort = null;
    this.streaming.set(false);
    this.statusMsg.set('Live log stream stopped.');
  }

  ngOnDestroy(): void {
    // Stop the stream on component teardown to avoid orphaned fetch connections.
    this.stop();
  }
}
