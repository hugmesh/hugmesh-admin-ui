import { TestBed } from '@angular/core/testing';
import { ImageGenStore } from './image-gen-store.service';
import {
  BffService,
  ImageBuildBatchResult,
  ImageBuildEvent,
  WorklistEnvelope,
} from '../bff.service';

/** Build a batch result of N QUEUED builds (b0..b{n-1}). */
function batch(n: number): ImageBuildBatchResult {
  return {
    batchId: 'batch-1',
    builds: Array.from({ length: n }, (_, i) => ({
      id: `b${i}`,
      status: 'QUEUED' as const,
      imageType: 'primary' as const,
      domain: 'brand',
      sshKeysAllowed: false,
    })),
  };
}

function ev(buildId: string, over: Partial<ImageBuildEvent> = {}): ImageBuildEvent {
  return {
    buildId,
    phase: 'running',
    percent: 50,
    message: 'debootstrap',
    imageRef: null,
    keysRef: null,
    done: false,
    error: null,
    ...over,
  };
}

const ENVELOPE: WorklistEnvelope = {
  schema: 'snapdragon-worklist/v1',
  base: null,
  entries: [{ targetUser: 'a@brand', imageType: 'primary', hardwareClass: 'x86', sshKeysAllowed: false }],
  maxConcurrent: 1,
};

describe('ImageGenStore (N-stream)', () => {
  let store: ImageGenStore;
  let bff: jasmine.SpyObj<BffService>;
  // Per-build event callbacks captured from imageBuildEvents so tests can drive frames manually.
  let onEventFor: Record<string, (e: ImageBuildEvent) => void>;
  // Resolver per build so we control when each stream's promise settles.
  let resolveStream: Record<string, () => void>;

  beforeEach(() => {
    onEventFor = {};
    resolveStream = {};
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'submitWorklistBatch', 'imageBuildEvents', 'listImageBuilds',
    ]);
    bff.listImageBuilds.and.resolveTo({ builds: [], launchReal: true });
    bff.imageBuildEvents.and.callFake((id: string, onEvent: (e: ImageBuildEvent) => void) => {
      onEventFor[id] = onEvent;
      return new Promise<void>((res) => { resolveStream[id] = res; });
    });
    TestBed.configureTestingModule({
      providers: [ImageGenStore, { provide: BffService, useValue: bff }],
    });
    store = TestBed.inject(ImageGenStore);
  });

  it('fans out ONE SSE stream per returned build id', async () => {
    bff.submitWorklistBatch.and.resolveTo(batch(3));
    await store.submitWorklistBatch(ENVELOPE);
    expect(bff.imageBuildEvents).toHaveBeenCalledTimes(3);
    expect(store.buildIds()).toEqual(['b0', 'b1', 'b2']);
    expect(store.batchId()).toBe('batch-1');
  });

  it('passes the envelope + single step-up token straight through', async () => {
    bff.submitWorklistBatch.and.resolveTo(batch(1));
    await store.submitWorklistBatch(ENVELOPE, 'step-up-1');
    expect(bff.submitWorklistBatch).toHaveBeenCalledWith(ENVELOPE, 'step-up-1');
  });

  it('accumulates events per build INDEPENDENTLY (no cross-talk)', async () => {
    bff.submitWorklistBatch.and.resolveTo(batch(2));
    await store.submitWorklistBatch(ENVELOPE);
    onEventFor['b0'](ev('b0', { percent: 20 }));
    onEventFor['b1'](ev('b1', { percent: 70 }));
    onEventFor['b0'](ev('b0', { percent: 40 }));
    expect(store.eventsFor('b0').length).toBe(2);
    expect(store.eventsFor('b1').length).toBe(1);
    expect(store.progressFor('b0')).toBe(40);
    expect(store.progressFor('b1')).toBe(70);
  });

  it('derives per-build liveStatus (QUEUED → RUNNING → COMPLETED / ERROR)', async () => {
    bff.submitWorklistBatch.and.resolveTo(batch(2));
    await store.submitWorklistBatch(ENVELOPE);
    expect(store.liveStatusFor('b0')).toBe('QUEUED');
    onEventFor['b0'](ev('b0'));
    expect(store.liveStatusFor('b0')).toBe('RUNNING');
    onEventFor['b0'](ev('b0', { phase: 'complete', percent: 100, done: true, imageRef: 'r0' }));
    expect(store.liveStatusFor('b0')).toBe('COMPLETED');
    expect(store.imageRefFor('b0')).toBe('r0');

    onEventFor['b1'](ev('b1', { phase: 'error', percent: 100, done: true, error: 'boom' }));
    expect(store.liveStatusFor('b1')).toBe('ERROR');
    expect(store.buildErrorFor('b1')).toBe('boom');
  });

  it('tolerates NON-terminal progress frames without marking a build finished', async () => {
    bff.submitWorklistBatch.and.resolveTo(batch(1));
    await store.submitWorklistBatch(ENVELOPE);
    onEventFor['b0'](ev('b0', { phase: 'partition', percent: 10, done: false }));
    onEventFor['b0'](ev('b0', { phase: 'kernel', percent: 60, done: false }));
    expect(store.finishedFor('b0')).toBeFalse();
    expect(store.progressFor('b0')).toBe(60);
  });

  it('reports finishedCount + allFinished across the batch', async () => {
    bff.submitWorklistBatch.and.resolveTo(batch(2));
    await store.submitWorklistBatch(ENVELOPE);
    onEventFor['b0'](ev('b0', { done: true, percent: 100 }));
    expect(store.finishedCount()).toBe(1);
    expect(store.allFinished()).toBeFalse();
    onEventFor['b1'](ev('b1', { done: true, percent: 100 }));
    expect(store.finishedCount()).toBe(2);
    expect(store.allFinished()).toBeTrue();
  });

  it('synthesises a terminal error frame when a stream breaks before finishing', async () => {
    bff.submitWorklistBatch.and.resolveTo(batch(1));
    // Make this build's reader reject.
    bff.imageBuildEvents.and.callFake(() => Promise.reject(new Error('conn reset')));
    await store.submitWorklistBatch(ENVELOPE);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.liveStatusFor('b0')).toBe('ERROR');
    expect(store.buildErrorFor('b0')).toContain('interrupted');
  });

  it('does NOT synthesise an error when the stream ends AFTER a terminal frame', async () => {
    bff.submitWorklistBatch.and.resolveTo(batch(1));
    await store.submitWorklistBatch(ENVELOPE);
    onEventFor['b0'](ev('b0', { done: true, percent: 100, imageRef: 'r0' }));
    resolveStream['b0'](); // stream completes cleanly
    await Promise.resolve();
    expect(store.buildErrorFor('b0')).toBe('');
    expect(store.liveStatusFor('b0')).toBe('COMPLETED');
  });

  it('gives each build its OWN AbortController and aborts them all on reset', async () => {
    bff.submitWorklistBatch.and.resolveTo(batch(2));
    await store.submitWorklistBatch(ENVELOPE);
    const signals = store.streamList().map((s) => s.abort.signal);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.every((sig) => sig.aborted)).toBeFalse();
    store.reset();
    expect(signals.every((sig) => sig.aborted)).toBeTrue();
    expect(store.buildIds()).toEqual([]);
    expect(store.batchId()).toBeNull();
  });

  it('refreshes the history when a stream settles', async () => {
    bff.submitWorklistBatch.and.resolveTo(batch(1));
    await store.submitWorklistBatch(ENVELOPE);
    resolveStream['b0']();
    await Promise.resolve();
    await Promise.resolve();
    expect(bff.listImageBuilds).toHaveBeenCalled();
  });

  it('tears down a prior batch before starting a new one', async () => {
    bff.submitWorklistBatch.and.resolveTo(batch(2));
    await store.submitWorklistBatch(ENVELOPE);
    const first = store.streamList().map((s) => s.abort.signal);
    bff.submitWorklistBatch.and.resolveTo({
      batchId: 'batch-2',
      builds: [{ id: 'z0', status: 'QUEUED', imageType: 'client', domain: 'brand', sshKeysAllowed: false }],
    });
    await store.submitWorklistBatch(ENVELOPE);
    expect(first.every((sig) => sig.aborted)).toBeTrue();
    expect(store.buildIds()).toEqual(['z0']);
    expect(store.batchId()).toBe('batch-2');
  });
});
