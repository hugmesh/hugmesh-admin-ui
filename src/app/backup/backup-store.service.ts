import { Injectable, computed, inject, signal } from '@angular/core';
import { BackupJobEvent, BackupRecord, BffService, StartBackupRequest, StartRestoreRequest, UsbDevice } from '../bff.service';

/**
 * Datastore for the admin Backup & Recovery feature module. A single
 * signal-backed service (the platform's RxJS-subject/signal datastore standard)
 * shared by the Backup, Recovery and History components so they observe one
 * consistent view of: the backup history, the connected USB devices, and the
 * LIVE progress of the currently-running backup/restore job (streamed from the
 * BFF SSE endpoint).
 *
 * <p>SECURITY: passwords flow THROUGH the start* methods to the BFF and are never
 * held in this store (no password signal). Only non-secret job state is retained.
 */
@Injectable({ providedIn: 'root' })
export class BackupStore {
  private readonly bff = inject(BffService);

  /** The selectable backup scopes (label + wire value + hint). Static vocabulary
   *  mirroring the BFF's closed BackupScope enum. */
  readonly scopes: ReadonlyArray<{ value: string; label: string; hint: string }> = [
    { value: 'etcd', label: 'etcd snapshot', hint: 'Cluster control-plane state (incl. cluster Secrets).' },
    { value: 'secrets', label: 'Kubernetes Secrets', hint: 'Secrets across all namespaces.' },
    { value: 'postgres', label: 'Postgres databases', hint: 'Platform Postgres (pg_dump).' },
    { value: 'pvc', label: 'PVC data', hint: 'PersistentVolumeClaim volume data (rsync).' },
    { value: 'config', label: 'ConfigMaps / config', hint: 'Platform ConfigMaps + config manifests.' },
  ];

  readonly history = signal<BackupRecord[]>([]);
  readonly usbDevices = signal<UsbDevice[]>([]);

  /** Live SSE events for the in-flight job (cleared when a new job starts). */
  readonly jobEvents = signal<BackupJobEvent[]>([]);
  /** The id of the job currently being streamed, or null when idle. */
  readonly activeJobId = signal<string | null>(null);

  /** The latest progress percent of the in-flight job (0..100). */
  readonly progress = computed(() => {
    const evs = this.jobEvents();
    return evs.length ? evs[evs.length - 1].percent : 0;
  });
  /** Whether the in-flight job has reached a terminal (done) event. */
  readonly finished = computed(() => {
    const evs = this.jobEvents();
    return evs.length > 0 && evs[evs.length - 1].done;
  });
  /** A terminal error message for the in-flight job, or '' when none. */
  readonly jobError = computed(() => {
    const last = this.jobEvents().at(-1);
    return last?.error ?? '';
  });

  private abort?: AbortController;

  async refreshHistory(): Promise<void> {
    this.history.set(await this.bff.backupHistory());
  }

  async refreshUsbDevices(): Promise<void> {
    this.usbDevices.set(await this.bff.usbDevices());
  }

  /** Start a backup and begin streaming its progress. Returns the job id. */
  async startBackup(req: StartBackupRequest): Promise<string> {
    const { id } = await this.bff.startBackup(req);
    this.beginStream(id);
    return id;
  }

  /** Start a restore and begin streaming its progress. Returns the job id. */
  async startRestore(req: StartRestoreRequest): Promise<string> {
    const { id } = await this.bff.startRestore(req);
    this.beginStream(id);
    return id;
  }

  /** Reset the live-job view (e.g. before starting a new job from the same view). */
  reset(): void {
    this.abort?.abort();
    this.abort = undefined;
    this.jobEvents.set([]);
    this.activeJobId.set(null);
  }

  private beginStream(jobId: string): void {
    this.reset();
    this.activeJobId.set(jobId);
    this.abort = new AbortController();
    this.bff.streamJobEvents(jobId, (e) => this.jobEvents.update((cur) => [...cur, e]), this.abort.signal)
      .catch(() => {
        // A stream error (network/abort) surfaces as a synthetic terminal event so
        // the aria-live region announces it instead of silently stalling.
        if (!this.finished()) {
          this.jobEvents.update((cur) => [...cur, {
            jobId, phase: 'error', percent: 100, done: true, message: 'progress stream interrupted',
            error: 'progress stream interrupted',
          }]);
        }
      })
      .finally(() => { void this.refreshHistory(); });
  }
}
