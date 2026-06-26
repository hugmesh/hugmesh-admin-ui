import { Injectable, computed, inject, signal } from '@angular/core';
import {
  BffService,
  ImageBuild,
  ImageBuildEvent,
  ImageBuildTriggerResult,
  ImageType,
  TriggerImageBuildRequest,
} from '../bff.service';

/**
 * Datastore for the admin Image-generation console (ADMIN/SUPERADMIN). A single
 * signal-backed service (the platform's signal-datastore standard, cloned from
 * {@code TestReportsStore}) shared by the trigger form, the live progress view and the
 * history table so they observe one consistent view of: the build history, the selected
 * build's detail, and the LIVE progress of an in-flight build streamed from the admin-bff
 * SSE endpoint.
 *
 * <p>The SSE is consumed via the credentialed-fetch ReadableStream reader (NOT raw EventSource —
 * which cannot be aborted on teardown; the HttpOnly bff_ cookie rides via credentials:'include');
 * a stream error surfaces as a synthetic terminal
 * event so the aria-live region announces it instead of stalling. NO secret is ever held
 * here — the keys bundle is a backend-guaranteed-non-secret download the UI only triggers.
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

  /** Live SSE events for the in-flight build (cleared when a new build starts). */
  readonly buildEvents = signal<ImageBuildEvent[]>([]);
  /** The id of the build currently being streamed, or null when idle. */
  readonly activeBuildId = signal<string | null>(null);
  /** The trigger result of the build currently being streamed (carries sshKeysAllowed). */
  readonly activeBuild = signal<ImageBuildTriggerResult | null>(null);

  /** The latest progress percent of the in-flight build (0..100). */
  readonly progress = computed(() => {
    const evs = this.buildEvents();
    return evs.length ? evs[evs.length - 1].percent : 0;
  });
  /** Whether the in-flight build has reached a terminal (done) event. */
  readonly finished = computed(() => {
    const evs = this.buildEvents();
    return evs.length > 0 && evs[evs.length - 1].done;
  });
  /** A terminal error message for the in-flight build, or '' when none. */
  readonly buildError = computed(() => {
    const last = this.buildEvents().at(-1);
    return last?.error ?? '';
  });
  /** The non-secret image artifact pointer from the latest terminal event, or '' when none. */
  readonly imageRef = computed(() => {
    const last = this.buildEvents().at(-1);
    return (last?.done && last.imageRef) || '';
  });
  /** The status the active build reached: derived from the terminal event (COMPLETED / ERROR). */
  readonly liveStatus = computed<'QUEUED' | 'RUNNING' | 'COMPLETED' | 'ERROR'>(() => {
    const evs = this.buildEvents();
    if (evs.length === 0) return this.activeBuildId() ? 'QUEUED' : 'QUEUED';
    const last = evs[evs.length - 1];
    if (!last.done) return 'RUNNING';
    return last.error ? 'ERROR' : 'COMPLETED';
  });

  private abort?: AbortController;

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
   *  False = none/denied. The UI never displays or persists a key — it only triggers the save. */
  downloadKeys(id: string, stepUpToken?: string): Promise<boolean> {
    return this.bff.downloadImageKeys(id, stepUpToken);
  }

  /** Trigger a build and begin streaming its progress. Returns the trigger result. */
  async trigger(req: TriggerImageBuildRequest, stepUpToken?: string): Promise<ImageBuildTriggerResult> {
    const result = await this.bff.triggerImageBuild(req, stepUpToken);
    this.beginStream(result);
    return result;
  }

  /** Reset the live-build view (e.g. before starting a new build). */
  reset(): void {
    this.abort?.abort();
    this.abort = undefined;
    this.buildEvents.set([]);
    this.activeBuildId.set(null);
    this.activeBuild.set(null);
  }

  private beginStream(build: ImageBuildTriggerResult): void {
    this.reset();
    this.activeBuildId.set(build.id);
    this.activeBuild.set(build);
    this.abort = new AbortController();
    this.bff
      .imageBuildEvents(build.id, (e) => this.buildEvents.update((cur) => [...cur, e]), this.abort.signal)
      .catch(() => {
        if (!this.finished()) {
          this.buildEvents.update((cur) => [
            ...cur,
            {
              buildId: build.id,
              phase: 'error',
              percent: 100,
              message: 'progress stream interrupted',
              imageRef: null,
              keysRef: null,
              done: true,
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
