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
  selector: 'snap-workload-logs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './workload-logs.component.html',
  styleUrl: './workload-console.component.scss',
})
export class WorkloadLogsComponent implements OnDestroy {
  private readonly bff = inject(BffService);

  namespace = 'snapdragon-backend';
  pod = '';
  container = '';

  readonly lines = signal<WorkloadLogLine[]>([]);
  readonly streaming = signal(false);
  readonly statusMsg = signal('');
  readonly error = signal('');

  private abort: AbortController | null = null;

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
        (line) => this.lines.update((cur) => [...cur.slice(-2000), line]),
        this.abort.signal);
      this.statusMsg.set('Log stream ended.');
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        this.error.set(e instanceof Error ? e.message : String(e));
      }
    } finally {
      this.streaming.set(false);
    }
  }

  stop(): void {
    this.abort?.abort();
    this.abort = null;
    this.streaming.set(false);
    this.statusMsg.set('Live log stream stopped.');
  }

  ngOnDestroy(): void {
    this.stop();
  }
}
