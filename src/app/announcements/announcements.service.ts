import { Injectable, computed, inject, signal } from '@angular/core';
import { SessionService } from '../session.service';

const CFG = {
  bff: (globalThis as any).__SNAP_BFF_URL__ ?? '',
};

/** Render format of an announcement body. */
export type AnnouncementFormat = 'html' | 'wysiwyg';
/** Lifecycle state. ACTIVE = published AND in-window AND the surface flag true. */
export type AnnouncementState = 'draft' | 'published' | 'archived';

/**
 * An admin announcement. Mirrors the SHARED API CONTRACT model exposed by
 * snapdragon-admin-bff-api at /bff/admin/announcements. `body_html` is the
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
  /** FORUM main page banner (consumed later by snapdragon-forum-ui). */
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
 * <p>This is the hand-written equivalent of the repo's ng-openapi-gen typed
 * client: this remote has no openapi codegen wired (no ng-openapi-gen in
 * package.json), so — per the contract's offline fallback — it is a minimal
 * typed service written DIRECTLY against the SHARED API CONTRACT
 * (/bff/admin/announcements, ROLE_ADMIN), using the same fetch + bearer-token
 * convention as {@link ../bff.service.ts BffService}. When codegen is later wired
 * the surface here (Announcement / AnnouncementInput + the CRUD methods) is the
 * shape the generated client must satisfy.
 *
 * <p>SECURITY: `body_html` is sanitised server-side by the BFF on create/update
 * (the authority). The store never trusts/echoes raw HTML into the DOM — the
 * editor preview renders it inside a sandboxed iframe.
 */
@Injectable({ providedIn: 'root' })
export class AnnouncementsStore {
  private readonly session = inject(SessionService);

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

  private headers(json = false): Record<string, string> {
    const t = this.session.session()?.bffToken;
    const h: Record<string, string> = { authorization: `Bearer ${t}` };
    if (json) h['content-type'] = 'application/json';
    return h;
  }

  /** GET /bff/admin/announcements — the full admin list (all states). */
  async refresh(): Promise<Announcement[]> {
    this.loading.set(true);
    try {
      const r = await fetch(`${CFG.bff}/bff/admin/announcements`, { headers: this.headers() });
      const list = r.ok ? ((await r.json()).announcements ?? []) : [];
      this.announcements.set(list);
      return list;
    } finally {
      this.loading.set(false);
    }
  }

  /** GET /bff/admin/announcements/{id}. */
  async get(id: string): Promise<Announcement | null> {
    const r = await fetch(`${CFG.bff}/bff/admin/announcements/${encodeURIComponent(id)}`, {
      headers: this.headers(),
    });
    return r.ok ? r.json() : null;
  }

  /** POST /bff/admin/announcements — create. Returns the server's stored row (sanitised). */
  async create(input: AnnouncementInput): Promise<Announcement> {
    return this.write('POST', '/bff/admin/announcements', input);
  }

  /** PUT /bff/admin/announcements/{id} — update. */
  async update(id: string, input: AnnouncementInput): Promise<Announcement> {
    return this.write('PUT', `/bff/admin/announcements/${encodeURIComponent(id)}`, input);
  }

  /** DELETE /bff/admin/announcements/{id}. Removes any propagated akkoma copy server-side. */
  async remove(id: string): Promise<void> {
    const r = await fetch(`${CFG.bff}/bff/admin/announcements/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: this.headers(),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
    this.announcements.update((cur) => cur.filter((a) => a.id !== id));
  }

  private async write(method: 'POST' | 'PUT', path: string, input: AnnouncementInput): Promise<Announcement> {
    const r = await fetch(`${CFG.bff}${path}`, {
      method, headers: this.headers(true), body: JSON.stringify(input),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
    const saved: Announcement = await r.json();
    // Merge the server's stored (sanitised) row into the collection.
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
