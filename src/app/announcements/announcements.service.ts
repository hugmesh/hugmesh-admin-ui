import { Injectable, computed, inject, signal } from '@angular/core';
import { AnnouncementAdminControllerService } from '../api/services/announcement-admin-controller.service';
import { Announcement as GenAnnouncement } from '../api/models/announcement';
import { AnnouncementRequest as GenAnnouncementRequest } from '../api/models/announcement-request';

/** Render format of an announcement body. */
export type AnnouncementFormat = 'html' | 'wysiwyg';
/** Lifecycle state. ACTIVE = published AND in-window AND the surface flag true. */
export type AnnouncementState = 'draft' | 'published' | 'archived';

/**
 * An admin announcement. Mirrors the SHARED API CONTRACT model exposed by
 * hugmesh-admin-bff-api at /bff/admin/announcements. `body_html` is the
 * SERVER-SANITISED HTML (the BFF is the authority); every surface still renders
 * it inside a sandboxed null-origin iframe. The PER-SURFACE target flags let one
 * announcement appear on any combination of the logged-in HOME banner, the public
 * LOGIN page, akkoma (as a local-only admin announcement) and the FORUM main page.
 */
export interface Announcement {
  id: string;
  title: string;
  /** SERVER-SANITISED admin HTML. Never rendered via raw innerHTML — sandboxed iframe only. */
  body_html: string;
  format: AnnouncementFormat;
  state: AnnouncementState;
  /** Logged-in HOME top banner. */
  target_home: boolean;
  /** Public LOGIN page (shown to everyone, incl. anonymous visitors). */
  target_login: boolean;
  /** Propagated to akkoma/Mastodon as a LOCAL-ONLY (not federated-out) admin announcement. */
  target_akkoma: boolean;
  /** FORUM main page banner (consumed later by hugmesh-forum-ui). */
  target_forum: boolean;
  /** Display priority, descending (higher shows first). */
  priority: number;
  /** ISO-8601 start; null = active immediately. */
  starts_at: string | null;
  /** ISO-8601 end; null = open-ended. */
  ends_at: string | null;
  /** IANA timezone the schedule is authored in (e.g. "Europe/London"). */
  timezone: string;
  /** Whether users may dismiss the banner. */
  dismissible: boolean;
  /** JWT subject of the creating admin (server-set). */
  created_by?: string | null;
  /** Id of the created akkoma announcement, kept for removal (server-set). */
  akkoma_ref?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** The mutable fields an admin sends on create/update (server owns the rest). */
export interface AnnouncementInput {
  title: string;
  body_html: string;
  format: AnnouncementFormat;
  state: AnnouncementState;
  target_home: boolean;
  target_login: boolean;
  target_akkoma: boolean;
  target_forum: boolean;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  dismissible: boolean;
}

/**
 * Typed datastore for the admin Announcements feature module. A single
 * signal-backed service (the platform's RxJS-subject/signal datastore standard)
 * shared by the List + Editor views so they observe one consistent view of the
 * announcements collection.
 *
 * <p><b>ng-openapi-gen migration (pilot):</b> this service now DELEGATES every
 * call to the generated, typed {@link AnnouncementAdminControllerService} (under
 * {@code src/app/api}, generated from the admin-bff-api OpenAPI spec) instead of
 * hand-rolling {@code fetch} + bearer-token URLs. The generated client calls the
 * SAME same-origin {@code /bff/admin/announcements} paths (its {@code rootUrl}
 * defaults to ''), and the {@code authInterceptor} sets {@code withCredentials} so
 * the request rides the SAME HttpOnly {@code bff_} cookie (the gateway turns it
 * into the bearer server-side) — so the wire calls (URL/method/body/auth) are
 * equivalent. This store keeps its OWN public {@link Announcement} /
 * {@link AnnouncementInput} types so the List + Editor components consuming it
 * need NO change; the generated model is bridged at the delegation boundary
 * (the list response is a {@code Map<String,Object>}, narrowed via
 * {@code as unknown as}). It maps to the admin-bff AnnouncementAdminController
 * (ROLE_ADMIN). When other admin features migrate, the surface here is the shape
 * the generated client satisfies.
 *
 * <p>SECURITY: `body_html` is sanitised server-side by the BFF on create/update
 * (the authority). The store never trusts/echoes raw HTML into the DOM — the
 * editor preview renders it inside a sandboxed iframe.
 */
@Injectable({ providedIn: 'root' })
export class AnnouncementsStore {
  private readonly api = inject(AnnouncementAdminControllerService);

  /** The full announcements collection (admin view: all states). */
  readonly announcements = signal<Announcement[]>([]);
  /** Set while a list/CRUD call is in flight (drives busy affordances). */
  readonly loading = signal<boolean>(false);

  /** The four user-facing surfaces an announcement can target. Static vocabulary. */
  readonly surfaces: ReadonlyArray<{ key: keyof AnnouncementInput; label: string; hint: string }> = [
    { key: 'target_home', label: 'Home (logged-in top banner)', hint: 'Shown to signed-in users on the home page top banner.' },
    { key: 'target_login', label: 'Login page (everyone)', hint: 'Shown on the public login page to all visitors, including anonymous.' },
    { key: 'target_akkoma', label: 'Mastodon / akkoma', hint: 'Posted to akkoma as a LOCAL-ONLY admin announcement (not federated out).' },
    { key: 'target_forum', label: 'Forum main page', hint: 'Shown on the forum main page banner (consumed by the forum UI).' },
  ];

  /** Announcements sorted for the manage list: priority desc, then newest first. */
  readonly sorted = computed(() =>
    [...this.announcements()].sort(
      (a, b) => b.priority - a.priority || (b.created_at ?? '').localeCompare(a.created_at ?? ''),
    ),
  );

  /** GET /bff/admin/announcements — the full admin list (all states).
   *  Delegates to the generated client; the BFF returns a Map
   *  ({@code { announcements: [...] }}), so the body is narrowed via
   *  {@code as unknown as}. Falls back to [] (never throws) on error. */
  async refresh(): Promise<Announcement[]> {
    this.loading.set(true);
    try {
      const body = await this.api.announcementAdminList();
      const list = ((body as unknown as { announcements?: Announcement[] }).announcements ?? []) as Announcement[];
      this.announcements.set(list);
      return list;
    } catch {
      this.announcements.set([]);
      return [];
    } finally {
      this.loading.set(false);
    }
  }

  /** GET /bff/admin/announcements/{id}. Returns null when the row is absent/errors. */
  async get(id: string): Promise<Announcement | null> {
    try {
      const saved = await this.api.announcementAdminGet({ id });
      return (saved as unknown as Announcement) ?? null;
    } catch {
      return null;
    }
  }

  /** POST /bff/admin/announcements — create. Returns the server's stored row (sanitised). */
  async create(input: AnnouncementInput): Promise<Announcement> {
    const saved = await this.write(
      this.api.announcementAdminCreate({ body: input as unknown as GenAnnouncementRequest }),
    );
    return this.merge(saved);
  }

  /** PUT /bff/admin/announcements/{id} — update. */
  async update(id: string, input: AnnouncementInput): Promise<Announcement> {
    const saved = await this.write(
      this.api.announcementAdminUpdate({ id, body: input as unknown as GenAnnouncementRequest }),
    );
    return this.merge(saved);
  }

  /** DELETE /bff/admin/announcements/{id}. Removes any propagated akkoma copy server-side. */
  async remove(id: string): Promise<void> {
    await this.write(this.api.announcementAdminDelete({ id }));
    this.announcements.update((cur) => cur.filter((a) => a.id !== id));
  }

  /** Await a generated-client call, surfacing the BFF {@code {error}} message
   *  (preserved from the old fetch path) as the thrown {@link Error}. */
  private async write<T>(call: Promise<T>): Promise<T> {
    try {
      return await call;
    } catch (e: unknown) {
      const err = e as { error?: { error?: string }; message?: string; status?: number };
      throw new Error(err?.error?.error ?? (err?.status ? `HTTP ${err.status}` : err?.message) ?? 'request failed');
    }
  }

  /** Merge the server's stored (sanitised) row into the collection. */
  private merge(savedGen: GenAnnouncement): Announcement {
    const saved = savedGen as unknown as Announcement;
    this.announcements.update((cur) => {
      const idx = cur.findIndex((a) => a.id === saved.id);
      if (idx === -1) return [...cur, saved];
      const next = [...cur];
      next[idx] = saved;
      return next;
    });
    return saved;
  }
}
