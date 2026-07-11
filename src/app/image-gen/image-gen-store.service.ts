import { Injectable, computed, inject, signal } from '@angular/core';
import {
  BffService,
  ImageBuild,
  ImageBuildBatchBuild,
  ImageBuildBatchResult,
  ImageBuildEvent,
  ImageBuildStatus,
  ImageType,
  WorklistEnvelope,
} from '../bff.service';

/**
 * Live per-build stream state for one image in a worklist batch: the returned build projection,
 * the accumulated SSE events, and the per-build AbortController that tears its reader down
 * independently of its siblings.
 */
export interface BuildStream {
  build: ImageBuildBatchBuild;
  events: ImageBuildEvent[];
  abort: AbortController;
}

/** The terminal-or-live status a single stream reports (derived from its last event). */
export type LiveStatus = Extract<ImageBuildStatus, 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'ERROR'>;

/**
 * Datastore for the admin Image-generation console (ADMIN/SUPERADMIN). A single signal-backed
 * service shared by the worklist wizard, the N-card progress screen and the history table.
 *
 * <p>REFACTORED (item 1/8) from a single in-flight stream to an N-STREAM store: a
 * {@code Map<buildId, BuildStream>} fans out one SSE reader PER build in a worklist batch, each
 * with its OWN AbortController so a single card's stream can break/retry without disturbing the
 * others. The per-buildId selectors ({@link progressFor} / {@link finishedFor} /
 * {@link buildErrorFor} / {@link imageRefFor} / {@link liveStatusFor}) read the {@code streams()}
 * signal so they stay reactive in the progress-card template.
 *
 * <p>The SSE is consumed via the credentialed-fetch ReadableStream reader (NOT raw EventSource —
 * which cannot be aborted on teardown; the HttpOnly bff_ cookie rides via credentials:'include').
 * A stream error surfaces as a synthetic terminal event so the aria-live region announces it
 * instead of stalling. The reader already tolerates non-terminal {@code done:false} progress
 * frames (the item-8 NON-terminal /progress leg). NO secret is ever held here — the keys bundle is
 * a backend-guaranteed-non-secret download the UI only triggers.
 */
@Injectable({ providedIn: 'root' })
export class ImageGenStore {
  private readonly bff = inject(BffService);

  /** The selectable image types (label + wire value + hint). Static vocabulary mirroring the
   *  admin-bff closed ImageType vocabulary (primary | mesh-extension | client). */
  readonly imageTypes: ReadonlyArray<{ value: ImageType; label: string; hint: string }> = [
    { value: 'primary', label: 'Primary', hint: 'A full primary node image (boots the platform).' },
    { value: 'mesh-extension', label: 'Mesh extension', hint: 'Joins an existing tailnet/mesh as an extension node.' },
    { value: 'client', label: 'Client', hint: 'A laptop / thin-Chromebook client image (enterprise login).' },
  ];

  readonly builds = signal<ImageBuild[]>([]);
  /** Whether the generator launcher actually runs cluster Jobs (false = ships dark: a build is
   *  recorded QUEUED but no real image is produced — surfaced honestly). */
  readonly launchReal = signal<boolean>(false);

  /** The currently-opened build's detail row. */
  readonly detail = signal<ImageBuild | null>(null);

  /** The live per-build SSE streams of the in-flight batch, keyed by buildId (N-stream store).
   *  Empty when idle. Insertion order is submission order. */
  readonly streams = signal<Map<string, BuildStream>>(new Map());
  /** The batchId of the in-flight worklist submit, or null when idle. */
  readonly batchId = signal<string | null>(null);

  /** The build ids currently streamed, in submission order. */
  readonly buildIds = computed<string[]>(() => [...this.streams().keys()]);
  /** The per-build stream rows, in submission order — the N progress cards iterate this. */
  readonly streamList = computed<BuildStream[]>(() => [...this.streams().values()]);
  /** Number of in-flight builds that reached a terminal event. */
  readonly finishedCount = computed<number>(
    () => this.streamList().filter((s) => this.streamDone(s)).length,
  );
  /** True once EVERY in-flight build has reached a terminal event (drives the batch-done banner). */
  readonly allFinished = computed<boolean>(() => {
    const list = this.streamList();
    return list.length > 0 && list.every((s) => this.streamDone(s));
  });

  async refreshHistory(): Promise<void> {
    const list = await this.bff.listImageBuilds();
    this.builds.set(list.builds);
    this.launchReal.set(list.launchReal);
  }

  async openDetail(id: string): Promise<void> {
    this.detail.set(await this.bff.imageBuildDetail(id));
  }

  closeDetail(): void {
    this.detail.set(null);
  }

  /** Download a build's image (bearer fetch → Blob → synthetic anchor). False = none/denied. */
  downloadImage(id: string): Promise<boolean> {
    return this.bff.downloadImage(id);
  }

  /** Download a build's NON-SECRET keys bundle (only when ssh_keys_allowed; needs step-up).
   *  False = no bundle available. Throws the BFF {error} on a denial — notably a "requires
   *  step-up" 403 the component offers the inline MFA step-up dialog for. The UI never displays
   *  or persists a key — it only triggers the save. */
  downloadKeys(id: string, stepUpToken?: string): Promise<boolean> {
    return this.bff.downloadImageKeys(id, stepUpToken);
  }

  /**
   * Submit a worklist ENVELOPE as a batch (1..16 images) with ONE step-up token, then fan out
   * one SSE stream per returned build id. Returns the batch result. Any prior batch's streams are
   * torn down first.
   */
  async submitWorklistBatch(
    req: WorklistEnvelope,
    stepUpToken?: string,
  ): Promise<ImageBuildBatchResult> {
    const result = await this.bff.submitWorklistBatch(req, stepUpToken);
    this.beginBatch(result);
    return result;
  }

  /** Reset the live-batch view (abort every stream, clear the map + batchId). */
  reset(): void {
    for (const s of this.streams().values()) s.abort.abort();
    this.streams.set(new Map());
    this.batchId.set(null);
  }

  // ── per-build selectors (read streams() → reactive in the progress-card template) ──

  /** The accumulated SSE events for one build (empty when unknown). */
  eventsFor(id: string): ImageBuildEvent[] {
    return this.streams().get(id)?.events ?? [];
  }
  /** The latest progress percent of one build (0..100). */
  progressFor(id: string): number {
    const evs = this.eventsFor(id);
    return evs.length ? evs[evs.length - 1].percent : 0;
  }
  /** Whether one build has reached a terminal (done) event. */
  finishedFor(id: string): boolean {
    const evs = this.eventsFor(id);
    return evs.length > 0 && evs[evs.length - 1].done;
  }
  /** A terminal error message for one build, or '' when none. */
  buildErrorFor(id: string): string {
    return this.eventsFor(id).at(-1)?.error ?? '';
  }
  /** The non-secret image artifact pointer from one build's terminal event, or '' when none. */
  imageRefFor(id: string): string {
    const last = this.eventsFor(id).at(-1);
    return (last?.done && last.imageRef) || '';
  }
  /** The status one build reached: QUEUED (no events) / RUNNING / COMPLETED / ERROR. */
  liveStatusFor(id: string): LiveStatus {
    const evs = this.eventsFor(id);
    if (evs.length === 0) return 'QUEUED';
    const last = evs[evs.length - 1];
    if (!last.done) return 'RUNNING';
    return last.error ? 'ERROR' : 'COMPLETED';
  }

  /** The image type of one build (for the progress card heading), or '' when unknown. */
  imageTypeFor(id: string): ImageType | '' {
    return this.streams().get(id)?.build.imageType ?? '';
  }

  private streamDone(s: BuildStream): boolean {
    return s.events.length > 0 && s.events[s.events.length - 1].done;
  }

  /** Seed the N-stream map from a batch result and start one reader per build. */
  private beginBatch(result: ImageBuildBatchResult): void {
    this.reset();
    this.batchId.set(result.batchId);
    const map = new Map<string, BuildStream>();
    for (const b of result.builds) {
      map.set(b.id, { build: b, events: [], abort: new AbortController() });
    }
    this.streams.set(map);
    for (const b of result.builds) this.streamOne(b);
  }

  /** Append one SSE event to a build's stream (immutable Map update → signal fires). */
  private appendEvent(id: string, e: ImageBuildEvent): void {
    this.streams.update((cur) => {
      const st = cur.get(id);
      if (!st) return cur;
      const next = new Map(cur);
      next.set(id, { ...st, events: [...st.events, e] });
      return next;
    });
  }

  /** Open one build's SSE reader; on a stream break synthesise a terminal error frame (only if it
   *  had not already finished) so its card announces the failure rather than stalling. */
  private streamOne(build: ImageBuildBatchBuild): void {
    const st = this.streams().get(build.id);
    if (!st) return;
    this.bff
      .imageBuildEvents(build.id, (e) => this.appendEvent(build.id, e), st.abort.signal)
      .catch(() => {
        if (!this.finishedFor(build.id)) {
          this.appendEvent(build.id, {
            buildId: build.id,
            phase: 'error',
            percent: 100,
            message: 'progress stream interrupted',
            imageRef: null,
            keysRef: null,
            done: true,
            error: 'progress stream interrupted',
          });
        }
      })
      .finally(() => {
        void this.refreshHistory();
      });
  }
}
