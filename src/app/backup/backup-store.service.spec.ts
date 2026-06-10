import { TestBed } from '@angular/core/testing';
import { BackupStore } from './backup-store.service';
import { BackupJobEvent, BffService } from '../bff.service';

describe('BackupStore', () => {
  let store: BackupStore;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(() => {
    bff = jasmine.createSpyObj<BffService>('BffService',
      ['backupHistory', 'usbDevices', 'startBackup', 'startRestore', 'streamJobEvents']);
    bff.backupHistory.and.resolveTo([]);
    bff.usbDevices.and.resolveTo([]);
    TestBed.configureTestingModule({
      providers: [BackupStore, { provide: BffService, useValue: bff }],
    });
    store = TestBed.inject(BackupStore);
  });

  it('exposes the closed scope vocabulary mirroring the BFF', () => {
    expect(store.scopes.map((s) => s.value)).toEqual(['etcd', 'secrets', 'postgres', 'pvc', 'config']);
  });

  it('startBackup streams the job events into signals and tracks progress', async () => {
    bff.startBackup.and.resolveTo({ id: 'job-1', status: 'QUEUED' });
    // Drive two events into the onEvent callback, then resolve the stream.
    bff.streamJobEvents.and.callFake(async (_id, onEvent) => {
      onEvent({ jobId: 'job-1', phase: 'etcd', percent: 40, message: 'processing etcd', done: false });
      onEvent({ jobId: 'job-1', phase: 'complete', percent: 100, message: 'done', done: true });
    });
    bff.backupHistory.and.resolveTo([]);

    const id = await store.startBackup({ scope: ['etcd'], target: 'CLUSTER', encrypt: false });
    expect(id).toBe('job-1');
    expect(store.activeJobId()).toBe('job-1');
    expect(store.jobEvents().length).toBe(2);
    expect(store.progress()).toBe(100);
    expect(store.finished()).toBeTrue();
    expect(store.jobError()).toBe('');
  });

  it('surfaces a terminal error event into jobError()', async () => {
    bff.startRestore.and.resolveTo({ id: 'r-1', status: 'QUEUED' });
    bff.streamJobEvents.and.callFake(async (_id, onEvent) => {
      const ev: BackupJobEvent = { jobId: 'r-1', phase: 'error', percent: 100, message: 'boom', done: true, error: 'boom' };
      onEvent(ev);
    });

    await store.startRestore({ backupId: '11111111-2222-3333-4444-555555555555' });
    expect(store.finished()).toBeTrue();
    expect(store.jobError()).toBe('boom');
  });

  it('synthesises a terminal error if the stream itself rejects', async () => {
    bff.startBackup.and.resolveTo({ id: 'job-x', status: 'QUEUED' });
    bff.streamJobEvents.and.rejectWith(new Error('network down'));

    await store.startBackup({ scope: ['config'], target: 'CLUSTER', encrypt: false });
    // allow the .catch microtask to run
    await Promise.resolve();
    expect(store.finished()).toBeTrue();
    expect(store.jobError()).toContain('interrupted');
  });

  it('reset clears the live-job view', async () => {
    bff.startBackup.and.resolveTo({ id: 'job-2', status: 'QUEUED' });
    bff.streamJobEvents.and.callFake(async (_id, onEvent) => {
      onEvent({ jobId: 'job-2', phase: 'etcd', percent: 10, message: 'x', done: false });
    });
    await store.startBackup({ scope: ['etcd'], target: 'CLUSTER', encrypt: false });
    store.reset();
    expect(store.activeJobId()).toBeNull();
    expect(store.jobEvents()).toEqual([]);
  });
});
