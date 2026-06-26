import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { AnnouncementListComponent } from './announcement-list.component';
import { AnnouncementEditorComponent } from './announcement-editor.component';
import { Announcement, AnnouncementsStore } from './announcements.service';
import { SessionService, SnapSession } from '../session.service';

function session(): SnapSession {
  return {
    id: 'google:admin@gmail.com', label: 'admin@gmail.com', provider: 'google',
    roles: ['admin'], registrationComplete: true, matrix: null, mastodon: null,
  };
}

function announcement(over: Partial<Announcement> = {}): Announcement {
  return {
    id: 'a-1', title: 'Hello', body_html: '<p>hi</p>', format: 'wysiwyg', state: 'draft',
    target_home: false, target_login: false, target_akkoma: false, target_forum: false,
    priority: 0, starts_at: null, ends_at: null, timezone: 'UTC', dismissible: true,
    created_at: '2026-06-10T00:00:00Z', updated_at: '2026-06-10T00:00:00Z', ...over,
  };
}

describe('AnnouncementListComponent', () => {
  let fixture: ComponentFixture<AnnouncementListComponent>;
  let component: AnnouncementListComponent;
  let store: AnnouncementsStore;
  const sessionSig = signal<SnapSession | null>(session());

  const published = announcement({
    id: 'pub', title: 'Live one', state: 'published', target_home: true, target_login: true,
    priority: 5, starts_at: '2020-01-01T00:00:00Z', ends_at: '2999-01-01T00:00:00Z',
  });
  const draft = announcement({ id: 'drf', title: 'Draft one', state: 'draft', priority: 1 });
  const expired = announcement({
    id: 'exp', title: 'Expired', state: 'published', target_home: true,
    starts_at: '2020-01-01T00:00:00Z', ends_at: '2020-02-01T00:00:00Z',
  });

  let refreshSpy: jasmine.Spy;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnnouncementListComponent],
      providers: [
        AnnouncementsStore,
        { provide: SessionService, useValue: { session: sessionSig } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AnnouncementListComponent);
    component = fixture.componentInstance;
    store = TestBed.inject(AnnouncementsStore);
    // ngOnInit calls refresh(); stub it to set the collection synchronously so
    // the rendered rows are deterministic (the store's fetch wiring is covered
    // in the store spec). The default seeds three rows; tests can re-stub.
    refreshSpy = spyOn(store, 'refresh').and.callFake(async () => {
      const list = [published, draft, expired];
      store.announcements.set(list);
      return list;
    });
  });

  async function init() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('loads the announcements on init and renders a row per announcement', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(refreshSpy).toHaveBeenCalled();
    expect(el.querySelector('[data-announcement="pub"]')).not.toBeNull();
    expect(el.querySelector('[data-announcement="drf"]')).not.toBeNull();
  });

  it('marks a published, in-window announcement as live but not a draft or expired one', async () => {
    await init();
    expect(component.isActive(published)).toBeTrue();
    expect(component.isActive(draft)).toBeFalse();
    expect(component.isActive(expired)).toBeFalse();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-live-id="pub"]')).not.toBeNull();
    expect(el.querySelector('[data-live-id="drf"]')).toBeNull();
  });

  it('renders a target badge per targeted surface', async () => {
    await init();
    expect(component.targetLabels(published)).toContain('Home (logged-in top banner)');
    expect(component.targetLabels(published)).toContain('Login page (everyone)');
    expect(component.targetLabels(draft).length).toBe(0);
  });

  it('embeds the editor and seeds it when Edit is clicked', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="announcement-editor"]')).not.toBeNull();
    const editor = fixture.debugElement.query(By.directive(AnnouncementEditorComponent))
      .componentInstance as AnnouncementEditorComponent;

    el.querySelector<HTMLButtonElement>('[data-edit="pub"]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The embedded editor is seeded from the clicked row (id + title + targets)…
    expect(editor.editingId()).toBe('pub');
    expect(editor.title).toBe('Live one');
    expect(editor.isTargeted('target_home')).toBeTrue();
    // …and the title is reflected into the input via ngModel.
    expect((el.querySelector('#ann-title') as HTMLInputElement).value).toBe('Live one');
  });

  it('requires a confirm before deleting (two-step)', async () => {
    await init();
    spyOn(store, 'remove').and.resolveTo();
    const el: HTMLElement = fixture.nativeElement;

    el.querySelector<HTMLButtonElement>('[data-delete="pub"]')!.click();
    fixture.detectChanges();
    expect(component.confirmingDelete()).toBe('pub');
    expect(store.remove).not.toHaveBeenCalled();

    el.querySelector<HTMLButtonElement>('[data-confirm-delete="pub"]')!.click();
    await fixture.whenStable();
    expect(store.remove).toHaveBeenCalledWith('pub');
  });

  it('surfaces a delete error in a role=alert region', async () => {
    await init();
    spyOn(store, 'remove').and.rejectWith(new Error('still referenced'));
    component.askDelete(published);
    await component.confirmDelete(published);
    fixture.detectChanges();
    expect(component.error()).toBe('still referenced');
    const el: HTMLElement = fixture.nativeElement;
    const alert = el.querySelector('[data-testid="announcements-error"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
  });

  it('shows the empty-state row when there are no announcements', async () => {
    refreshSpy.and.callFake(async () => { store.announcements.set([]); return []; });
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="announcements-empty"]')).not.toBeNull();
  });

  describe('help text (sighted + low/no-sight)', () => {
    it('wires the New-announcement button to help that exists and is informative', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const newBtn = el.querySelector<HTMLButtonElement>('[data-testid="ann-new"]')!;
      const describedBy = newBtn.getAttribute('aria-describedby')!;
      expect(describedBy).toBe('announcements-new-help');
      const help = el.querySelector(`#${describedBy}`)!;
      expect(help).withContext('new-button help target exists').not.toBeNull();
      expect(help.textContent!.trim().length).toBeGreaterThan(20);
      // The visible intro is also present + carries a stable id.
      expect(el.querySelector('[data-testid="announcements-help"]')!.id).toBe('announcements-help');
    });

    it('gives per-row action buttons accessible names that identify the announcement', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const edit = el.querySelector<HTMLButtonElement>('[data-edit="pub"]')!;
      expect(edit.getAttribute('aria-label')).toBe('Edit announcement Live one');
      const del = el.querySelector<HTMLButtonElement>('[data-delete="pub"]')!;
      expect(del.getAttribute('aria-label')).toBe('Delete announcement Live one');
    });

    it('labels the delete confirm/cancel buttons with the announcement title', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      el.querySelector<HTMLButtonElement>('[data-delete="pub"]')!.click();
      fixture.detectChanges();
      const confirm = el.querySelector<HTMLButtonElement>('[data-confirm-delete="pub"]')!;
      expect(confirm.getAttribute('aria-label')).toBe('Permanently delete announcement Live one');
      const cancel = el.querySelector<HTMLButtonElement>('[data-testid="ann-cancel-delete"]')!;
      expect(cancel.getAttribute('aria-label')).toBe('Cancel deleting Live one');
    });
  });
});
