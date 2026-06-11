import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Announcement, AnnouncementInput, AnnouncementsStore } from './announcements.service';
import { SessionService, SnapSession } from '../session.service';

/** Minimal fetch Response stub. */
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

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

describe('AnnouncementsStore', () => {
  let store: AnnouncementsStore;
  let fetchSpy: jasmine.Spy;
  const sessionSig = signal<SnapSession | null>(session('tok-1'));

  beforeEach(() => {
    sessionSig.set(session('tok-1'));
    TestBed.configureTestingModule({
      providers: [
        AnnouncementsStore,
        { provide: SessionService, useValue: { session: sessionSig } },
      ],
    });
    store = TestBed.inject(AnnouncementsStore);
    fetchSpy = spyOn(globalThis, 'fetch');
  });

  function lastUrl(): string { return String(fetchSpy.calls.mostRecent().args[0]); }
  function lastInit(): RequestInit { return (fetchSpy.calls.mostRecent().args[1] ?? {}) as RequestInit; }
  function authHeader(): string | undefined {
    return (lastInit().headers as Record<string, string>)?.['authorization'];
  }

  it('exposes the four user-facing surfaces in contract order', () => {
    expect(store.surfaces.map((s) => s.key)).toEqual([
      'target_home', 'target_login', 'target_akkoma', 'target_forum',
    ]);
  });

  it('GETs /bff/admin/announcements with a Bearer token and unwraps { announcements }', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ announcements: [announcement()] }));
    const list = await store.refresh();
    expect(lastUrl()).toContain('/bff/admin/announcements');
    expect(authHeader()).toBe('Bearer tok-1');
    expect(list.length).toBe(1);
    expect(store.announcements().length).toBe(1);
  });

  it('falls back to [] (not throw) when the list GET fails', async () => {
    fetchSpy.and.resolveTo(jsonResponse(null, { ok: false, status: 500 }));
    expect(await store.refresh()).toEqual([]);
  });

  it('POSTs the create body and merges the server row into the collection', async () => {
    const saved = announcement({ id: 'srv-1', state: 'published', target_home: true, priority: 5 });
    fetchSpy.and.resolveTo(jsonResponse(saved));
    const res = await store.create(input);
    expect(lastInit().method).toBe('POST');
    expect((lastInit().headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(String(lastInit().body))).toEqual(input);
    expect(res.id).toBe('srv-1');
    expect(store.announcements().map((a) => a.id)).toContain('srv-1');
  });

  it('PUTs the update to /{id} and replaces the existing row', async () => {
    store.announcements.set([announcement({ id: 'a-9', priority: 1 })]);
    fetchSpy.and.resolveTo(jsonResponse(announcement({ id: 'a-9', priority: 9 })));
    await store.update('a-9', { ...input, priority: 9 });
    expect(lastInit().method).toBe('PUT');
    expect(lastUrl()).toContain('/bff/admin/announcements/a-9');
    expect(store.announcements().find((a) => a.id === 'a-9')!.priority).toBe(9);
  });

  it('throws the BFF {error} message when a write fails', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ error: 'title required' }, { ok: false, status: 400 }));
    await expectAsync(store.create(input)).toBeRejectedWithError('title required');
  });

  it('DELETEs by id and drops the row from the collection', async () => {
    store.announcements.set([announcement({ id: 'd-1' }), announcement({ id: 'd-2' })]);
    fetchSpy.and.resolveTo(jsonResponse({ ok: true }));
    await store.remove('d-1');
    expect(lastInit().method).toBe('DELETE');
    expect(lastUrl()).toContain('/bff/admin/announcements/d-1');
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
