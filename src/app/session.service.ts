import { Injectable, signal, computed } from '@angular/core';

export interface SnapSession {
  id: string;                 // casdoor identity, e.g. google:alice@gmail.com
  label: string;              // display (email or discord handle)
  provider: 'google' | 'discord';
  roles: string[];
  bffToken: string;
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
  readonly session = signal<SnapSession | null>(this.load());
  readonly loggedIn = computed(() => this.session() !== null);
  readonly isAdmin = computed(() => (this.session()?.roles ?? []).includes('admin'));
  /** Matrix/Mastodon are usable only after full registration completes. */
  readonly fullyRegistered = computed(() => this.session()?.registrationComplete === true);

  private load(): SnapSession | null {
    try { const raw = localStorage.getItem(this.key); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  }
  set(s: SnapSession): void { localStorage.setItem(this.key, JSON.stringify(s)); this.session.set(s); }
  patch(p: Partial<SnapSession>): void { const s = this.session(); if (s) this.set({ ...s, ...p }); }
  clear(): void { localStorage.removeItem(this.key); this.session.set(null); }
}
