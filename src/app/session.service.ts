import { Injectable, signal, computed } from '@angular/core';

/**
 * The session payload persisted to localStorage under the `hug.session` key.
 * Written by the login remote after a successful SSO callback and read by every
 * federated remote (admin-ui, admin-bff surfaces) to gate navigation. Every BFF
 * call rides the HttpOnly `bff_` cookie (`credentials: 'include'`); the gateway's
 * BffCookieToBearerWebFilter turns it into the bearer server-side, so this
 * payload no longer carries a client-held bearer token or provider credentials.
 */
export interface HugSession {
  /** Casdoor subject — unique identity string, e.g. `google:alice@gmail.com`. */
  id: string;
  /** Human-readable display name (email or Discord handle). */
  label: string;
  /** The OIDC provider used to authenticate. */
  provider: 'google' | 'discord';
  /** Lowercase Casdoor roles, ROLE_-prefix-stripped (e.g. `['admin', 'superadmin']`). */
  roles: string[];
  /** True once the user has completed the Casdoor registration wizard (username, profile). */
  registrationComplete: boolean;
}

/**
 * Cross-remote session store for the HugMesh admin shell. Holds the logged-in
 * {@link HugSession} in an Angular signal backed by `localStorage['hug.session']` and
 * derives the Casdoor-style role flags the guards and components gate on.
 *
 * Because native-federation mounts each remote in its OWN Angular injector, the host
 * shell and every remote each instantiate their own `SessionService` over the SAME
 * localStorage key. Cross-instance synchronisation is achieved via:
 *  - A custom `BroadcastChannel`-style `window` event (`hug-session-change`) fired by
 *    whichever instance writes, so all in-page consumers (e.g. the login remote
 *    completing registration must immediately unlock the host shell's nav).
 *  - The standard `storage` event for cross-tab synchronisation.
 *
 * @see {@link BffService} — every admin-bff call rides the shared `bff_` cookie.
 * @see {@link adminGuard} — gates on `isAdmin()`.
 * @see {@link superadminGuard} — gates on `isSuperadmin()`.
 * @see {@link gamesServicesGuard} — gates on `isGamesServicesAdmin()` or `isGamesServicesRunner()`.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  /** The localStorage key shared by every federated remote. */
  private readonly key = 'hug.session';
  /** The in-page broadcast event name fired after every write so sibling instances reload. */
  private readonly channel = 'hug-session-change';

  /** The live session state. Null when logged out. */
  readonly session = signal<HugSession | null>(this.load());
  /** True when a session is present (logged in). */
  readonly loggedIn = computed(() => this.session() !== null);
  /** True when the session carries the Casdoor `admin` role (ROLE_ADMIN). */
  readonly isAdmin = computed(() => (this.session()?.roles ?? []).includes('admin'));
  /** True when the session carries the Casdoor `superadmin` role (ROLE_SUPERADMIN). */
  readonly isSuperadmin = computed(() => (this.session()?.roles ?? []).includes('superadmin'));

  /**
   * True when the session may reach the FLEET-OWNER surface (`/my-fleet`, the public
   * `/bff/admin/phone-fleet/**` plane). Mirrors the admin-bff's coarse gate
   * `hasAnyRole('FLEET_ADMIN','ADMIN','SUPERADMIN')`: a dedicated `fleet_admin` capability
   * OR the broader `admin`/`superadmin` roles (a superadmin/admin is a superset). The BFF is
   * the authoritative gate — it additionally enforces the per-subject ENTITLEMENT (an
   * un-entitled admin sees a fail-soft empty fleet), so this only governs UI reachability.
   */
  readonly isFleetAdmin = computed(() => {
    const roles = this.session()?.roles ?? [];
    return roles.includes('fleet_admin') || roles.includes('admin') || roles.includes('superadmin');
  });

  /**
   * Games app-store DERIVED roles (materialised in Casdoor; surfaced lowercased,
   * `ROLE_`-prefix-stripped, in `session.roles`).
   *
   * `games_services_admin` = catalog-enable + create/run (intersection of ROLE_GAMES_SERVICES and ROLE_ADMIN).
   * `games_services_runner` = mod-delegated run/stop only (intersection of ROLE_GAMES_SERVICES and ROLE_MOD).
   */
  readonly isGamesServicesAdmin = computed(() => (this.session()?.roles ?? []).includes('games_services_admin'));
  /** True for a games-services runner (run/stop only, no catalog create). */
  readonly isGamesServicesRunner = computed(() => (this.session()?.roles ?? []).includes('games_services_runner'));

  /**
   * True once the user has completed the Casdoor registration wizard. The Matrix and
   * Mastodon micro-frontends in the host shell are gated on this being true (the login
   * remote sets `registrationComplete` after the wizard step).
   */
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

  /**
   * Read and parse the session from localStorage. Returns null on any parse error
   * (corrupt JSON, missing key) so callers never see an unhandled exception.
   */
  private load(): HugSession | null {
    try { const raw = localStorage.getItem(this.key); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  }

  /**
   * Persist a new session to localStorage, update the signal, and broadcast to
   * sibling instances so they reload immediately.
   *
   * @param s - The session payload to persist (e.g. after a successful login callback).
   */
  set(s: HugSession): void { localStorage.setItem(this.key, JSON.stringify(s)); this.session.set(s); this.broadcast(); }

  /**
   * Merge a partial update into the current session (e.g. flipping
   * `registrationComplete` after the wizard completes). A no-op when not logged in.
   *
   * @param p - The partial fields to merge into the current session.
   */
  patch(p: Partial<HugSession>): void { const s = this.session(); if (s) this.set({ ...s, ...p }); }

  /**
   * Remove the session from localStorage, clear the signal, and broadcast. Used by the
   * logout flow to ensure every remote and the host shell drop their session immediately.
   */
  clear(): void { localStorage.removeItem(this.key); this.session.set(null); this.broadcast(); }

  /**
   * Fire a `hug-session-change` window event so every in-page `SessionService` instance
   * (host + each loaded remote) re-reads localStorage. Does nothing on SSR.
   */
  private broadcast(): void { if (typeof window !== 'undefined') window.dispatchEvent(new Event(this.channel)); }
}
