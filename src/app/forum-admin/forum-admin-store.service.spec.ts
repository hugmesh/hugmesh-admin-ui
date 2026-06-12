import { TestBed } from '@angular/core/testing';
import { ForumAdminStore, noteFor } from './forum-admin-store.service';
import { BffService, ForumEnvelope } from '../bff.service';

describe('ForumAdminStore', () => {
  let store: ForumAdminStore;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(() => {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'forumStats', 'forumUsers', 'forumCategories', 'forumModerationQueue', 'forumAudit',
      'forumBan', 'forumUnban', 'forumAssignGroup', 'forumCreateCategory',
      'forumApprove', 'forumReject', 'forumInstallStyle', 'forumInstallExtension',
    ]);
    const ok: ForumEnvelope = { result: 'ok' };
    bff.forumStats.and.resolveTo({ result: 'ok', topics: 3 });
    bff.forumUsers.and.resolveTo({ result: 'ok', users: [] });
    bff.forumCategories.and.resolveTo(ok);
    bff.forumModerationQueue.and.resolveTo(ok);
    bff.forumAudit.and.resolveTo(ok);
    bff.forumBan.and.resolveTo(ok);
    bff.forumUnban.and.resolveTo(ok);
    bff.forumAssignGroup.and.resolveTo(ok);
    bff.forumCreateCategory.and.resolveTo(ok);
    bff.forumApprove.and.resolveTo(ok);
    bff.forumReject.and.resolveTo(ok);
    bff.forumInstallStyle.and.resolveTo(ok);
    bff.forumInstallExtension.and.resolveTo(ok);

    TestBed.configureTestingModule({
      providers: [ForumAdminStore, { provide: BffService, useValue: bff }],
    });
    store = TestBed.inject(ForumAdminStore);
  });

  // ── USER-SITUATIONAL (admin loads + acts) ─────────────────────────────
  describe('USER-SITUATIONAL', () => {
    it('refreshAll loads every section', async () => {
      await store.refreshAll();
      expect(store.stats()).toEqual(jasmine.objectContaining({ topics: 3 }));
      expect(bff.forumUsers).toHaveBeenCalled();
      expect(bff.forumCategories).toHaveBeenCalled();
      expect(bff.forumModerationQueue).toHaveBeenCalled();
      expect(bff.forumAudit).toHaveBeenCalled();
    });

    it('sets a human ok note + refreshes the section after a create', async () => {
      await store.createCategory({ name: 'General', description: null, parentId: null });
      expect(bff.forumCreateCategory).toHaveBeenCalledWith({ name: 'General', description: null, parentId: null });
      expect(store.note()).toBe('Done.');
      expect(bff.forumCategories).toHaveBeenCalled();
    });

    it('honestly notes a STUBBED result (seam not wired)', async () => {
      bff.forumBan.and.resolveTo({ result: 'stubbed' });
      await store.ban('42', { reason: null });
      expect(store.note()).toContain('not connected');
    });

    it('honestly notes a degraded result', async () => {
      bff.forumInstallStyle.and.resolveTo({ result: 'degraded:breaker-open' });
      await store.installStyle({ name: 'prosilver' });
      expect(store.note()).toContain('degraded');
      expect(store.note()).toContain('breaker-open');
    });

    it('surfaces a hard BFF error from a mutation', async () => {
      bff.forumBan.and.rejectWith(new Error('forum unreachable'));
      await store.ban('42', { reason: null });
      expect(store.error()).toBe('forum unreachable');
    });
  });

  // ── CROSS-USER (an admin ban targets ANOTHER user; refresh re-reads) ───
  describe('CROSS-USER', () => {
    it('bans a specific target user then re-reads the user list', async () => {
      await store.ban('victim-1', { reason: 'spam' });
      expect(bff.forumBan).toHaveBeenCalledWith('victim-1', { reason: 'spam' });
      expect(bff.forumUsers).toHaveBeenCalled();
    });

    it('lifts a ban for a specific target user (reversible)', async () => {
      await store.unban('victim-1');
      expect(bff.forumUnban).toHaveBeenCalledWith('victim-1');
    });
  });

  describe('noteFor', () => {
    it('maps every result marker', () => {
      expect(noteFor({ result: 'ok' })).toBe('Done.');
      expect(noteFor({ result: 'stubbed' })).toContain('not connected');
      expect(noteFor({ result: 'degraded:x' })).toContain('degraded');
      expect(noteFor(null)).toBe('');
      expect(noteFor({})).toBe('');
    });
  });
});
