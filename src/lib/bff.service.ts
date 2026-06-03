import { Injectable, inject } from '@angular/core';
import { MatrixService } from '@snapdragon/matrix';
import { MastodonService } from '@snapdragon/mastodon';
import { SessionService, SnapSession } from './session.service';

const CFG = {
  bff: (globalThis as any).__SNAP_BFF_URL__ ?? '',
  matrix: (globalThis as any).__SNAP_MATRIX_URL__ ?? '',
  mastodon: (globalThis as any).__SNAP_MASTODON_URL__ ?? '',
  uptrace: (globalThis as any).__SNAP_UPTRACE_URL__ ?? 'https://uptrace.snapdragon.systems',
};

/**
 * Talks to the Spring admin BFF (backend namespace, behind the gateway), which
 * brokers to Casdoor through the snapdragon-pki gateway. Enforces:
 *   • registration is Google- or Discord-only AND only for admin-invited identities;
 *   • a TWO-STAGE flow — register creates the Casdoor account but the Matrix /
 *     Mastodon service tokens are only provisioned once full registration completes.
 */
@Injectable({ providedIn: 'root' })
export class BffService {
  private readonly matrix = inject(MatrixService);
  private readonly mastodon = inject(MastodonService);
  private readonly session = inject(SessionService);

  /** Re-apply stored service tokens to the data services on app (re)load. */
  applyTokens(): void {
    const s = this.session.session();
    if (s?.matrix) this.matrix.setAccessToken(s.matrix.token);
    if (s?.mastodon) this.mastodon.setAccessToken(s.mastodon.token);
  }

  private sessionFromBff(label: string, provider: 'google' | 'discord', r: any): SnapSession {
    return {
      id: r.id, label, provider, roles: r.roles ?? ['user'], bffToken: r.token,
      registrationComplete: !!r.registrationComplete, matrix: null, mastodon: null,
    };
  }

  /** Stage 1: register an invited identity (creates the Casdoor account). */
  async registerWithGoogle(email: string): Promise<{ ok: boolean; error?: string }> {
    return this.register('/bff/register/google', { email }, email, 'google');
  }
  async registerWithDiscord(username: string): Promise<{ ok: boolean; error?: string }> {
    return this.register('/bff/register/discord', { username }, username, 'discord');
  }
  private async register(path: string, body: any, label: string, provider: 'google' | 'discord') {
    const r = await fetch(`${CFG.bff}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: false, error: (await r.json().catch(() => ({}))).error || `HTTP ${r.status}` };
    this.session.set(this.sessionFromBff(label, provider, await r.json()));
    return { ok: true };
  }

  /** Sign in to an existing (already-registered) account. */
  async login(label: string, provider: 'google' | 'discord' = 'google'): Promise<{ ok: boolean; error?: string }> {
    const body = provider === 'discord' ? { username: label, provider } : { email: label, provider };
    const r = await fetch(`${CFG.bff}/bff/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: false, error: (await r.json().catch(() => ({}))).error || `HTTP ${r.status}` };
    const s = this.sessionFromBff(label, provider, await r.json());
    this.session.set(s);
    if (s.registrationComplete) await this.provisionServiceTokens();
    return { ok: true };
  }

  /** Stage 2: complete registration — ONLY THEN are service tokens issued. */
  async completeRegistration(): Promise<void> {
    const t = this.session.session()?.bffToken;
    await fetch(`${CFG.bff}/bff/register/complete`, { method: 'POST', headers: { authorization: `Bearer ${t}` } });
    // Mint the brokered Matrix/Mastodon tokens FIRST (the broker can be slow
    // against the real Synapse), THEN flip registrationComplete — so the
    // Matrix/Mastodon modules only unlock once their tokens are actually in
    // the session (avoids a race where the UI navigates without a token).
    await this.provisionServiceTokens();
    this.session.patch({ registrationComplete: true });
  }

  /** Acquire Matrix + Mastodon access tokens — brokered by the BFF, which mints
   *  them server-side against the real Synapse/Mastodon (the UI never holds
   *  homeserver admin creds). Only succeeds once registration is complete. */
  private async provisionServiceTokens(): Promise<void> {
    const t = this.session.session()?.bffToken;
    if (!t) return;
    const broker = async (svc: 'matrix' | 'mastodon') =>
      (await fetch(`${CFG.bff}/bff/provision/${svc}`, { method: 'POST', headers: { authorization: `Bearer ${t}` } })).json();
    const mx = await broker('matrix');
    const md = await broker('mastodon');
    this.session.patch({
      matrix: { token: mx.access_token, userId: mx.user_id },
      mastodon: { token: md.access_token },
    });
    this.applyTokens();
  }

  async allowlist(): Promise<{ emails: string[]; discord: string[] }> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/allowlist`, { headers: { authorization: `Bearer ${t}` } });
    return r.ok ? r.json() : { emails: [], discord: [] };
  }
  async invite(kind: 'email' | 'discord', value: string): Promise<{ emails: string[]; discord: string[] }> {
    const t = this.session.session()?.bffToken;
    const body = kind === 'email' ? { email: value } : { discord: value };
    const r = await fetch(`${CFG.bff}/bff/admin/allowlist`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify(body),
    });
    return r.ok ? r.json() : { emails: [], discord: [] };
  }

  /** Admin-only usage analytics aggregated by the BFF from ClickHouse. */
  async usage(): Promise<any> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/usage`, { headers: { authorization: `Bearer ${t}` } });
    return r.ok ? r.json() : { byModule: [], byAction: [], activeUsers: 0, totalEvents: 0 };
  }

  /** Admin-only observability UI (Uptrace), reached through the pki gateway. */
  uptraceUrl(): string { return CFG.uptrace; }

  /** Admin-only: list namespaces + which users are granted access to each. */
  async namespaceAccess(): Promise<{ namespaces: string[]; grants: { user: string; namespaces: string[] }[] }> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/namespace-access`, { headers: { authorization: `Bearer ${t}` } });
    return r.ok ? r.json() : { namespaces: [], grants: [] };
  }
  async grantNamespace(user: string, namespace: string) { return this.nsAccess('POST', user, namespace); }
  async revokeNamespace(user: string, namespace: string) { return this.nsAccess('DELETE', user, namespace); }
  private async nsAccess(method: string, user: string, namespace: string) {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/namespace-access`, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify({ user, namespace }),
    });
    return r.ok ? r.json() : { namespaces: [], grants: [] };
  }

  /** The signed-in user's own granted namespaces. */
  async myNamespaces(): Promise<string[]> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/me/namespaces`, { headers: { authorization: `Bearer ${t}` } });
    return r.ok ? (await r.json()).namespaces : [];
  }

  // ── Per-gateway role->URL external access rules ──────────────────
  // The admin-api persists these in Postgres (gateway_route_access); each
  // gateway caches them in Cassandra and denies external access unless the
  // caller's Casdoor roles match. Roles are owned by Casdoor.
  async routeAccess(): Promise<RouteRule[]> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/route-access`, { headers: { authorization: `Bearer ${t}` } });
    return r.ok ? (await r.json()).rules : [];
  }
  async addRouteRule(rule: Omit<RouteRule, 'id'>): Promise<RouteRule[]> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/route-access`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify(rule),
    });
    return r.ok ? (await r.json()).rules : [];
  }
  async removeRouteRule(id: string): Promise<RouteRule[]> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/route-access`, {
      method: 'DELETE', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify({ id }),
    });
    return r.ok ? (await r.json()).rules : [];
  }

  /** Latest delivered ISO download links (from the CI pipeline). */
  async isos(): Promise<{ name: string; url: string }[]> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/isos`, { headers: { authorization: `Bearer ${t}` } });
    return r.ok ? (await r.json()).isos : [];
  }
}

export interface RouteRule {
  id: string;
  gateway: string;
  url_pattern: string;
  role: string;
  casdoor_user?: string | null;
  allow: boolean;
}
