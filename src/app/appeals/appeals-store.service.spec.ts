import { TestBed } from '@angular/core/testing';
import { AppealsStore } from './appeals-store.service';
import { BffService, ModerationRequest } from '../bff.service';

/** A decided moderation row as the decide-proxy returns it (status flipped). */
function row(over: Partial<ModerationRequest> = {}): ModerationRequest {
  return {
    id: 7,
    requester: 'mod@brand-x',
    kind: 'user-removal',
    target: '@spammer:brand-x',
    reason: 'spam',
    status: 'approved',
    modReferrer: 'mod@brand-x',
    adminDecider: 'admin@brand-x',
    ts: '2026-06-12T00:00:00Z',
    domain: 'DOMAIN_brandx',
    ...over,
  };
}

describe('AppealsStore', () => {
  let store: AppealsStore;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(() => {
    bff = jasmine.createSpyObj<BffService>('BffService', ['decideModeration']);
    bff.decideModeration.and.resolveTo(row());
    TestBed.configureTestingModule({
      providers: [AppealsStore, { provide: BffService, useValue: bff }],
    });
    store = TestBed.inject(AppealsStore);
  });

  // ── USER-SITUATIONAL (an admin decides an appeal) ──────────────────────
  describe('USER-SITUATIONAL', () => {
    it('forwards id + approve=true to the decide-proxy and records the decided row', async () => {
      const decided = await store.decide(7, true);
      expect(bff.decideModeration).toHaveBeenCalledWith(7, true);
      expect(decided).toEqual(jasmine.objectContaining({ id: 7, status: 'approved' }));
      expect(store.decided().map((r) => r.id)).toEqual([7]);
      expect(store.note()).toContain('approved');
      expect(store.error()).toBe('');
      expect(store.deciding()).toBeNull();
    });

    it('forwards approve=false for a deny and notes a denial', async () => {
      bff.decideModeration.and.resolveTo(row({ id: 9, status: 'denied' }));
      await store.decide(9, false);
      expect(bff.decideModeration).toHaveBeenCalledWith(9, false);
      expect(store.decided()[0].status).toBe('denied');
      expect(store.note()).toContain('denied');
    });

    it('prepends each new decision (newest first)', async () => {
      bff.decideModeration.and.resolveTo(row({ id: 1, status: 'approved' }));
      await store.decide(1, true);
      bff.decideModeration.and.resolveTo(row({ id: 2, status: 'denied' }));
      await store.decide(2, false);
      expect(store.decided().map((r) => r.id)).toEqual([2, 1]);
    });

    it('reconciles a re-decided id to a single, authoritative row', async () => {
      bff.decideModeration.and.resolveTo(row({ id: 5, status: 'approved' }));
      await store.decide(5, true);
      bff.decideModeration.and.resolveTo(row({ id: 5, status: 'denied' }));
      await store.decide(5, false);
      const fives = store.decided().filter((r) => r.id === 5);
      expect(fives.length).toBe(1);
      expect(fives[0].status).toBe('denied');
    });

    it('surfaces the BFF/federation error and records nothing on a failure', async () => {
      bff.decideModeration.and.rejectWith(new Error('federation-api unreachable'));
      const decided = await store.decide(7, true);
      expect(decided).toBeNull();
      expect(store.error()).toBe('federation-api unreachable');
      expect(store.decided().length).toBe(0);
      expect(store.deciding()).toBeNull();
    });

    it('reset clears the session record + notes', async () => {
      await store.decide(7, true);
      store.reset();
      expect(store.decided().length).toBe(0);
      expect(store.note()).toBe('');
      expect(store.error()).toBe('');
    });
  });

  // ── CROSS-USER (an admin decides a SPECIFIC target's appeal) ───────────
  describe('CROSS-USER', () => {
    it('decides the appeal for the exact id requested (no cross-id leakage)', async () => {
      bff.decideModeration.and.resolveTo(row({ id: 42, target: '@victim:brand-x' }));
      await store.decide(42, true);
      expect(bff.decideModeration).toHaveBeenCalledOnceWith(42, true);
      expect(store.decided()[0].target).toBe('@victim:brand-x');
    });
  });

  // ── CONCURRENT-CONFLICTING (busy/optimistic in-flight state) ───────────
  describe('CONCURRENT/OPTIMISTIC', () => {
    it('marks the deciding id + busy while a decide is in flight, then clears', async () => {
      let resolve!: (r: ModerationRequest) => void;
      bff.decideModeration.and.returnValue(new Promise<ModerationRequest>((r) => (resolve = r)));
      const p = store.decide(7, true);
      // in flight: optimistic markers set
      expect(store.deciding()).toBe(7);
      expect(store.busy()).toBeTrue();
      resolve(row());
      await p;
      expect(store.deciding()).toBeNull();
      expect(store.busy()).toBeFalse();
    });

    it('clears the error/note at the start of a new decision', async () => {
      bff.decideModeration.and.rejectWith(new Error('boom'));
      await store.decide(7, true);
      expect(store.error()).toBe('boom');
      bff.decideModeration.and.resolveTo(row());
      await store.decide(7, true);
      expect(store.error()).toBe('');
      expect(store.note()).toContain('approved');
    });
  });
});
