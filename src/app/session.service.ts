import { Injectable, signal, computed } from '@angular/core';

export interface SnapSession {
  id: string;                 // casdoor identity, e.g. google:alice@gmail.com
  label: string;              // display (email or discord handle)
  provider: 'google' | 'discord';
  roles: string[];
  registrationComplete: boolean;
  matrix: { token: string; userId: string } | null;
  mastodon: { token: string } | null;
}

/** Holds the logged-in session (persisted to localStorage) and derives the
 *  Casdoor-style role flags + the registration-complete gate the host uses to
 *  unlock the Matrix/Mastodon micro-frontends. */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly key = 'snap.session';
  private readonly channel = 'snap-session-change';
  readonly session = signal<SnapSession | null>(this.load());
  readonly loggedIn = computed(() => this.session() !== null);
  readonly isAdmin = computed(() => (this.session()?.roles ?? []).includes('admin'));
  readonly isSuperadmin = computed(() => (this.session()?.roles ?? []).includes('superadmin'));
  /** Games app-store DERIVED roles (materialized in Casdoor; surfaced lowercased,
   *  ROLE_-prefix-stripped, in session.roles). ADMIN = catalog-enable + create/run;
   *  RUNNER = mod-delegated run/stop only. */
  readonly isGamesServicesAdmin = computed(() => (this.session()?.roles ?? []).includes('games_services_admin'));
  readonly isGamesServicesRunner = computed(() => (this.session()?.roles ?? []).includes('games_services_runner'));
  /** Matrix/Mastodon are usable only after full registration completes. */
  readonly fullyRegistered = computed(() => this.session()?.registrationComplete === true);

  constructor() {
    // The host shell and each federated remote each hold their OWN SessionService
    // instance over the same localStorage key. Re-read on a same-document broadcast
    // (dispatched by whichever instance wrote) and on cross-tab storage events, so
    // every nav/guard reading this signal stays in sync — e.g. the login remote
    // completing registration must unlock the host shell's Matrix/Mastodon nav.
    if (typeof window !== 'undefined') {
      window.addEventListener(this.channel, () => this.session.set(this.load()));
      window.addEventListener('storage', (e) => { if (e.key === this.key) this.session.set(this.load()); });
    }
  }

  private load(): SnapSession | null {
    try { const raw = localStorage.getItem(this.key); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  }
  set(s: SnapSession): void { localStorage.setItem(this.key, JSON.stringify(s)); this.session.set(s); this.broadcast(); }
  patch(p: Partial<SnapSession>): void { const s = this.session(); if (s) this.set({ ...s, ...p }); }
  clear(): void { localStorage.removeItem(this.key); this.session.set(null); this.broadcast(); }
  /** Notify the other in-page SessionService instances (host + remotes) to re-read. */
  private broadcast(): void { if (typeof window !== 'undefined') window.dispatchEvent(new Event(this.channel)); }
}
