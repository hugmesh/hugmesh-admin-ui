import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Announcement, AnnouncementInput, AnnouncementsStore } from './announcements.service';
import { authInterceptor } from '../auth.interceptor';
import { SessionService, SnapSession } from '../session.service';

function session(bffToken: string): SnapSession {
  return {
    id: 'google:admin@gmail.com', label: 'admin@gmail.com', provider: 'google',
    roles: ['admin'], bffToken, registrationComplete: true, matrix: null, mastodon: null,
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

const input: AnnouncementInput = {
  title: 'Hello', body_html: '<p>hi</p>', format: 'wysiwyg', state: 'published',
  target_home: true, target_login: false, target_akkoma: false, target_forum: false,
  priority: 5, starts_at: null, ends_at: null, timezone: 'UTC', dismissible: true,
};

/**
 * The store now delegates to the generated AnnouncementAdminControllerService
 * (ng-openapi-gen). The wire behaviour is identical, so these tests assert the
 * same URL / method / body / Bearer-header contract — but via
 * HttpTestingController (the generated clients use HttpClient) and the shared
 * authInterceptor (which stamps the SAME session bffToken the fetch path did).
 */
describe('AnnouncementsStore', () => {
  let store: AnnouncementsStore;
  let httpMock: HttpTestingController;
  const sessionSig = signal<SnapSession | null>(session('tok-1'));

  beforeEach(() => {
    sessionSig.set(session('tok-1'));
    TestBed.configureTestingModule({
      providers: [
        AnnouncementsStore,
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: SessionService, useValue: { session: sessionSig } },
      ],
    });
    store = TestBed.inject(AnnouncementsStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('exposes the four user-facing surfaces in contract order', () => {
    expect(store.surfaces.map((s) => s.key)).toEqual([
      'target_home', 'target_login', 'target_akkoma', 'target_forum',
    ]);
  });

  it('GETs /bff/admin/announcements with a Bearer token and unwraps { announcements }', async () => {
    const p = store.refresh();
    const req = httpMock.expectOne('/bff/admin/announcements');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok-1');
    req.flush({ announcements: [announcement()] });
    const list = await p;
    expect(list.length).toBe(1);
    expect(store.announcements().length).toBe(1);
  });

  it('falls back to [] (not throw) when the list GET fails', async () => {
    const p = store.refresh();
    httpMock.expectOne('/bff/admin/announcements').flush(null, { status: 500, statusText: 'Server Error' });
    expect(await p).toEqual([]);
  });

  it('POSTs the create body and merges the server row into the collection', async () => {
    const saved = announcement({ id: 'srv-1', state: 'published', target_home: true, priority: 5 });
    const p = store.create(input);
    const req = httpMock.expectOne('/bff/admin/announcements');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(input);
    req.flush(saved);
    const res = await p;
    expect(res.id).toBe('srv-1');
    expect(store.announcements().map((a) => a.id)).toContain('srv-1');
  });

  it('PUTs the update to /{id} and replaces the existing row', async () => {
    store.announcements.set([announcement({ id: 'a-9', priority: 1 })]);
    const p = store.update('a-9', { ...input, priority: 9 });
    const req = httpMock.expectOne('/bff/admin/announcements/a-9');
    expect(req.request.method).toBe('PUT');
    req.flush(announcement({ id: 'a-9', priority: 9 }));
    await p;
    expect(store.announcements().find((a) => a.id === 'a-9')!.priority).toBe(9);
  });

  it('throws the BFF {error} message when a write fails', async () => {
    const p = store.create(input);
    httpMock.expectOne('/bff/admin/announcements').flush({ error: 'title required' }, { status: 400, statusText: 'Bad Request' });
    await expectAsync(p).toBeRejectedWithError('title required');
  });

  it('DELETEs by id and drops the row from the collection', async () => {
    store.announcements.set([announcement({ id: 'd-1' }), announcement({ id: 'd-2' })]);
    const p = store.remove('d-1');
    const req = httpMock.expectOne('/bff/admin/announcements/d-1');
    expect(req.request.method).toBe('DELETE');
    req.flush({ ok: true });
    await p;
    expect(store.announcements().map((a) => a.id)).toEqual(['d-2']);
  });

  it('sorts by priority desc then newest first', () => {
    store.announcements.set([
      announcement({ id: 'low', priority: 1, created_at: '2026-06-01T00:00:00Z' }),
      announcement({ id: 'high', priority: 9, created_at: '2026-06-02T00:00:00Z' }),
      announcement({ id: 'mid-new', priority: 5, created_at: '2026-06-09T00:00:00Z' }),
      announcement({ id: 'mid-old', priority: 5, created_at: '2026-06-03T00:00:00Z' }),
    ]);
    expect(store.sorted().map((a) => a.id)).toEqual(['high', 'mid-new', 'mid-old', 'low']);
  });
});
