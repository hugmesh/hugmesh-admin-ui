import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ForumAdminComponent } from './forum-admin.component';
import { ForumAdminStore } from './forum-admin-store.service';
import { BffService, ForumEnvelope } from '../bff.service';

describe('ForumAdminComponent', () => {
  let fixture: ComponentFixture<ForumAdminComponent>;
  let component: ForumAdminComponent;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'forumStats', 'forumUsers', 'forumCategories', 'forumModerationQueue', 'forumAudit',
      'forumBan', 'forumUnban', 'forumAssignGroup', 'forumCreateCategory',
      'forumApprove', 'forumReject', 'forumInstallStyle', 'forumInstallExtension',
    ]);
    const ok: ForumEnvelope = { result: 'ok' };
    bff.forumStats.and.resolveTo(ok);
    bff.forumUsers.and.resolveTo(ok);
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

    await TestBed.configureTestingModule({
      imports: [ForumAdminComponent],
      providers: [ForumAdminStore, { provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(ForumAdminComponent);
    component = fixture.componentInstance;
  });

  async function init() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  // ── USER-SITUATIONAL (admin's allowed actions + validation) ───────────
  describe('USER-SITUATIONAL', () => {
    it('starts on the stats tab and can switch tabs', async () => {
      await init();
      component.select('users');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="fa-panel-users"]')).not.toBeNull();
    });

    it('creates a category through the form', async () => {
      await init();
      component.select('categories');
      component.catName = 'General';
      await component.createCategory();
      expect(bff.forumCreateCategory).toHaveBeenCalledWith({ name: 'General', description: null, parentId: null });
    });

    it('blocks an empty category create without a BFF call', async () => {
      await init();
      component.select('categories');
      component.catName = '   ';
      await component.createCategory();
      expect(bff.forumCreateCategory).not.toHaveBeenCalled();
      expect(component.catFormError()).toContain('name');
    });

    it('rejects a non-numeric parent id', async () => {
      await init();
      component.catName = 'Child';
      component.catParentId = 'abc';
      await component.createCategory();
      expect(bff.forumCreateCategory).not.toHaveBeenCalled();
      expect(component.catFormError()).toContain('whole number');
    });

    it('installs a style (admin-only)', async () => {
      await init();
      component.styleName = 'prosilver';
      await component.installStyle();
      expect(bff.forumInstallStyle).toHaveBeenCalledWith({ name: 'prosilver' });
    });
  });

  // ── CROSS-USER (ban targets another user; approve targets a queue item) ─
  describe('CROSS-USER', () => {
    it('bans a target forum user with the entered reason', async () => {
      await init();
      component.banUserId = 'spammer-9';
      component.banReason = 'spam';
      await component.ban();
      expect(bff.forumBan).toHaveBeenCalledWith('spammer-9', { reason: 'spam' });
    });

    it('approves a queued item by id', async () => {
      await init();
      component.moderationId = 'post-5';
      await component.approve();
      expect(bff.forumApprove).toHaveBeenCalledWith('post-5');
    });
  });

  // ── MULTIUSER / DENY (the no-endpoint controls render disabled+helptext) ─
  describe('MULTIUSER / disabled-helptext (no backend, V7)', () => {
    it('renders the GAP controls aria-disabled (not native disabled) with helptext', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      for (const id of ['fa-gap-appeals', 'fa-gap-role-grant', 'fa-gap-external-client']) {
        const btn = el.querySelector(`[data-testid="${id}"]`)!;
        expect(btn).withContext(id).not.toBeNull();
        // aria-disabled, NOT the native disabled attribute (so AT reaches the helptext)
        expect(btn.getAttribute('aria-disabled')).toBe('true');
        expect(btn.hasAttribute('disabled')).toBeFalse();
        const describedby = btn.getAttribute('aria-describedby')!;
        expect(describedby).withContext(`${id} describedby`).toBeTruthy();
        expect(el.querySelector(`#${describedby}`)).withContext(`${id} helptext`).not.toBeNull();
      }
    });
  });
});
