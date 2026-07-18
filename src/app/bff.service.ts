import { Injectable, inject } from '@angular/core';
import { SessionService } from './session.service';

const CFG = {
  // Bare references (no globalThis/typeof guard) throw ReferenceError: nothing
  // in this build ever DECLARES __SNAP_BFF_URL__/__SNAP_UPTRACE_URL__ as real
  // globals — runtime-config.d.ts is a TypeScript-only ambient declaration, not
  // an injection mechanism (unlike login-ui's snap-config.js entrypoint script,
  // which actually sets window.__SNAP_*__). mfa.service.ts in this same repo
  // already uses the correct globalThis-guarded form; this just matches it.
  bff: (globalThis as any).__SNAP_BFF_URL__ ?? '',
  uptrace: (globalThis as any).__SNAP_UPTRACE_URL__ ?? 'https://uptrace.snapdragon.systems',
};

/** Admin-only usage analytics aggregated by the BFF from ClickHouse (GET /bff/admin/usage). */
export interface UsageStats {
  byModule: { module: string; events: number; users: number }[];
  byAction: { action: string; events: number }[];
  activeUsers: number;
  totalEvents: number;
}

/**
 * Talks to the Spring admin BFF (backend namespace, behind the gateway), which
 * brokers to Casdoor through the snapdragon-pki gateway. As a federated remote
 * the Admin console only needs the admin-scoped endpoints (allowlist, usage,
 * namespace access); the registration / login / Matrix-Mastodon service-token
 * broker flow lives in the login remote, which writes the shared `snap.session`
 * (id/label/roles) that this remote reads via SessionService. Every call sends
 * `credentials: 'include'` so the HttpOnly `bff_` cookie rides the request; the
 * gateway's BffCookieToBearerWebFilter turns it into the bearer server-side (the
 * browser never holds an admin bearer).
 */
@Injectable({ providedIn: 'root' })
export class BffService {
  private readonly session = inject(SessionService);

  async allowlist(): Promise<{ emails: string[]; discord: string[] }> {
    const r = await fetch(`${CFG.bff}/bff/admin/allowlist`, { credentials: 'include' });
    return r.ok ? r.json() : { emails: [], discord: [] };
  }
  async invite(kind: 'email' | 'discord', value: string): Promise<{ emails: string[]; discord: string[] }> {
    const body = kind === 'email' ? { email: value } : { discord: value };
    const r = await fetch(`${CFG.bff}/bff/admin/allowlist`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify(body),
    });
    return r.ok ? r.json() : { emails: [], discord: [] };
  }

  /** Admin-only usage analytics aggregated by the BFF from ClickHouse. */
  async usage(): Promise<UsageStats> {
    const r = await fetch(`${CFG.bff}/bff/admin/usage`, { credentials: 'include' });
    return r.ok ? r.json() : { byModule: [], byAction: [], activeUsers: 0, totalEvents: 0 };
  }

  /** Admin-only observability UI (Uptrace), reached through the pki gateway. */
  uptraceUrl(): string { return CFG.uptrace; }

  /** Admin-only: list namespaces + which users are granted access to each. */
  async namespaceAccess(): Promise<{ namespaces: string[]; grants: { user: string; namespaces: string[] }[] }> {
    const r = await fetch(`${CFG.bff}/bff/admin/namespace-access`, { credentials: 'include' });
    return r.ok ? r.json() : { namespaces: [], grants: [] };
  }
  async grantNamespace(user: string, namespace: string) { return this.nsAccess('POST', user, namespace); }
  async revokeNamespace(user: string, namespace: string) { return this.nsAccess('DELETE', user, namespace); }
  private async nsAccess(method: string, user: string, namespace: string) {
    const r = await fetch(`${CFG.bff}/bff/admin/namespace-access`, {
      method, headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ user, namespace }),
    });
    return r.ok ? r.json() : { namespaces: [], grants: [] };
  }

  /** The signed-in user's own granted namespaces. */
  async myNamespaces(): Promise<string[]> {
    const r = await fetch(`${CFG.bff}/bff/me/namespaces`, { credentials: 'include' });
    return r.ok ? (await r.json()).namespaces : [];
  }

  // ── Delegation / access-roles + domain-lock (ADMIN-only, AdminController) ──
  // The narrow, verified-against-AdminController delegation surface. Three WIRED
  // capabilities — access-role suspend/clear, domain-lock add/remove, and the
  // namespace-access grant/revoke above. There is NO general role grant/revoke,
  // no external-client grant, and no appeals-adjudication endpoint in admin-bff
  // (the console renders those disabled+helptext). Admin gating is defence-in-
  // depth (gateway + resource-server filter + @PreAuthorize("hasRole('ADMIN')"));
  // this mirrors it but the admin-bff is the source of truth.
  //
  //   ACCESS-ROLE SUSPENSION (ban / timed-suspend; the access_suspension table):
  //     GET    /bff/admin/access-roles            → { suspensions:[AccessSuspension] }
  //     POST   /bff/admin/access-roles/{role}/{user}  { ttlSeconds?, reason? }
  //              role ∈ ROLE_MATRIX|ROLE_MASTODON|PROFILE (closed vocab); no body = permanent
  //              → { suspended:AccessSuspension, suspensions:[...] }
  //     DELETE /bff/admin/access-roles/{role}/{user}  → { suspensions:[...] }   (lift)
  //   DOMAIN-LOCK (force local-only marker; ADD-semantics, KEEPS the base role):
  //     GET    /bff/admin/domain-lock             → { domainLocks:[DomainLock] }
  //     POST   /bff/admin/domain-lock/{role}/{user}   { reason? }
  //              role ∈ ROLE_MATRIX_DOMAINLOCKED|ROLE_MASTODON_DOMAINLOCKED
  //              → { locked:DomainLock, domainLocks:[...] }
  //     DELETE /bff/admin/domain-lock/{role}/{user}   → { domainLocks:[...] }   (unlock)

  /** All active access-role suspensions (the ban/suspend desired-state table). */
  async accessRoles(): Promise<AccessRolesView> {
    const r = await fetch(`${CFG.bff}/bff/admin/access-roles`, { credentials: 'include' });
    return r.ok ? r.json() : { suspensions: [] };
  }
  /** Suspend (ban) a user from a platform access role. ttlSeconds null/absent =
   *  PERMANENT; a positive value auto-restores at TTL. Throws the BFF {error} on a
   *  validation reject (e.g. a role outside the closed vocabulary → 400/422). */
  async suspendAccessRole(role: AccessRole, user: string, body: SuspensionBody = {}): Promise<AccessRolesResult> {
    return this.accessRoleSend('POST', role, user, body);
  }
  /** Lift (clear) a user's active suspension on a role. A no-op server-side if none. */
  async clearAccessRole(role: AccessRole, user: string): Promise<AccessRolesResult> {
    return this.accessRoleSend('DELETE', role, user);
  }
  private async accessRoleSend(method: 'POST' | 'DELETE', role: AccessRole, user: string,
                               body?: SuspensionBody): Promise<AccessRolesResult> {
    const init: RequestInit = { method, headers: {}, credentials: 'include' };
    // Only POST carries an (optional) body. Omit an empty body so the endpoint's
    // optional-body branch applies (a permanent suspension needs no body at all).
    if (method === 'POST' && body && (body.ttlSeconds != null || body.reason)) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const r = await fetch(
      `${CFG.bff}/bff/admin/access-roles/${encodeURIComponent(role)}/${encodeURIComponent(user)}`, init);
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }

  /** All active domain-locks (force local-only markers). */
  async domainLocks(): Promise<DomainLocksView> {
    const r = await fetch(`${CFG.bff}/bff/admin/domain-lock`, { credentials: 'include' });
    return r.ok ? r.json() : { domainLocks: [] };
  }
  /** Add a domain-lock (force local-only) marker for a user on a platform. */
  async lockDomain(role: DomainLockRole, user: string, reason?: string): Promise<DomainLockResult> {
    return this.domainLockSend('POST', role, user, reason);
  }
  /** Remove a domain-lock for a user on a platform. A no-op server-side if none. */
  async unlockDomain(role: DomainLockRole, user: string): Promise<DomainLockResult> {
    return this.domainLockSend('DELETE', role, user);
  }
  private async domainLockSend(method: 'POST' | 'DELETE', role: DomainLockRole, user: string,
                               reason?: string): Promise<DomainLockResult> {
    const init: RequestInit = { method, headers: {}, credentials: 'include' };
    if (method === 'POST' && reason) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
      init.body = JSON.stringify({ reason });
    }
    const r = await fetch(
      `${CFG.bff}/bff/admin/domain-lock/${encodeURIComponent(role)}/${encodeURIComponent(user)}`, init);
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }

  /** Extract the BFF's {error} message (string or object) for a thrown rejection. Falls back to
   *  {note} for the handful of hand-rolled non-ApiException bodies (e.g. AdminSshKeyIssuanceController's
   *  darkResponse(), `{dark:true, note:"..."}`) that don't carry the standard {error} shape. */
  private async errorOf(r: Response): Promise<string> {
    const body = await r.json().catch(() => ({}));
    const err = body.error ?? body.note ?? `HTTP ${r.status}`;
    return typeof err === 'string' ? err : JSON.stringify(err);
  }

  // ── ACCOUNT-BAN appeal inbox (ADMIN/SUPERADMIN, admin-bff /bff/admin/account-appeals) ──
  // DISTINCT from the moderation "Appeals" console below: that domain is CONTENT
  // moderation (federation-api ModerationRequest rows over posts/profiles). This is
  // the ACCOUNT-level ban/suspension appeal a curtailed principal files against their
  // OWN access_suspension PROFILE row via POST /bff/me/appeal (login-ui). An APPROVE
  // decide here CLEARS the underlying suspension server-side (SuspensionService.clear)
  // — never a bare status flip — so "access restored" is a real, observable effect.
  //
  //   GET  /bff/admin/account-appeals                        → [AccountAppeal]
  //   POST /bff/admin/account-appeals/{id}/decide?status=APPROVED|DENIED
  //                                                          → { decided, status }

  /** The brand's account-appeal inbox (own brand; SUPERADMIN all). A dark/denied
   *  surface yields [] (no existence leak). */
  async accountAppeals(): Promise<AccountAppeal[]> {
    const r = await fetch(`${CFG.bff}/bff/admin/account-appeals`, { credentials: 'include' });
    return r.ok ? r.json() : [];
  }

  /** Decide an account-ban appeal (CAS PENDING -> APPROVED|DENIED, single-winner,
   *  brand-scoped). An APPROVED decide restores the appellant's PROFILE access
   *  server-side FIRST; if that restore fails the whole call fails (surfaced via the
   *  thrown error) and the appeal stays PENDING — never a false "approved". Returns
   *  the affected row count (decided:0 = already decided / out of scope). */
  async decideAccountAppeal(id: string, status: 'APPROVED' | 'DENIED'): Promise<{ decided: number; status: string }> {
    const r = await fetch(
      `${CFG.bff}/bff/admin/account-appeals/${encodeURIComponent(id)}/decide?status=${encodeURIComponent(status)}`,
      { method: 'POST', credentials: 'include' });
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }

  // ── Appeals adjudication / moderation DECIDE (ADMIN-only, decide-proxy) ──
  // The admin-ui Appeals console's DECIDE action. The admin-bff does NOT own the
  // moderation_requests table — its AdminController PROXIES to snapdragon-federation-
  // api's POST /api/federation/moderation/{id}/decide, forwarding the caller's Casdoor
  // JWT so federation-api applies its OWN @PreAuthorize(ADMIN|SUPERADMIN) + per-domain
  // scope (a brand-X admin can only decide brand-X rows; a brand-Y id is invisible/404
  // — cross-domain DENY enforced downstream). admin-bff re-applies hasRole('ADMIN') as
  // defence-in-depth and @Positive-validates the {id}. Endpoint (admin-bff #26):
  //   POST /bff/admin/moderation/{id}/decide?approve=<bool> → ModerationRequest (row
  //        with status flipped to 'approved' | 'denied', adminDecider stamped).
  //
  // DEPENDENCY / GAP: there is NO admin-bff endpoint to LIST pending moderation
  // requests yet. federation-api exposes GET /api/federation/moderation?status= (MOD/
  // ADMIN), but admin-bff does NOT proxy it (FederationApiClient has only decide()),
  // and this remote talks only to admin-bff. So the console drives the decide action by
  // the known item id (the flow surfaced from the federation moderation system / mod
  // tooling) and surfaces the decided row, rather than fabricating a list. When an
  // admin-bff list proxy lands, the console gains a live pending-queue table.

  /** Approve OR deny a referred moderation request by id (the appeals decide-proxy).
   *  Returns the updated row (status → approved|denied). Throws the BFF {error} on a
   *  reject (non-numeric/non-positive id → 400; downstream unreachable → 502; a row in
   *  another domain → 404). */
  async decideModeration(id: number, approve: boolean): Promise<ModerationRequest> {
    const r = await fetch(
      `${CFG.bff}/bff/admin/moderation/${encodeURIComponent(String(id))}/decide?approve=${approve}`,
      { method: 'POST', credentials: 'include' });
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }

  // ── Per-gateway role->URL external access rules ──────────────────
  // The admin-api persists these in Postgres (gateway_route_access); each
  // gateway caches them in Cassandra and denies external access unless the
  // caller's Casdoor roles match. Roles are owned by Casdoor.
  async routeAccess(): Promise<RouteRule[]> {
    const r = await fetch(`${CFG.bff}/bff/admin/route-access`, { credentials: 'include' });
    return r.ok ? (await r.json()).rules : [];
  }
  async addRouteRule(rule: Omit<RouteRule, 'id'>): Promise<RouteRule[]> {
    const r = await fetch(`${CFG.bff}/bff/admin/route-access`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(rule),
    });
    return r.ok ? (await r.json()).rules : [];
  }
  async removeRouteRule(id: string): Promise<RouteRule[]> {
    const r = await fetch(`${CFG.bff}/bff/admin/route-access`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ id }),
    });
    return r.ok ? (await r.json()).rules : [];
  }

  // Gateway route DEFINITIONS — admin-editable url_registry rows the gateway turns
  // into live Spring Cloud Gateway routes (path_prefix -> downstream_uri). Distinct
  // from route-access above (which is role→URL allow/deny). The BFF wraps the list
  // as { routes: [...] }, same convention as route-access's { rules: [...] }.
  async routeDefinitions(): Promise<RouteDefinition[]> {
    const r = await fetch(`${CFG.bff}/bff/admin/routes`, { credentials: 'include' });
    return r.ok ? (await r.json()).routes : [];
  }
  async upsertRouteDefinition(def: RouteDefinition): Promise<RouteDefinition[]> {
    const r = await fetch(`${CFG.bff}/bff/admin/routes`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(def),
    });
    return r.ok ? (await r.json()).routes : [];
  }
  async removeRouteDefinition(pathPrefix: string): Promise<RouteDefinition[]> {
    const r = await fetch(`${CFG.bff}/bff/admin/routes/${encodeURIComponent(pathPrefix)}`, {
      method: 'DELETE', credentials: 'include',
    });
    return r.ok ? (await r.json()).routes : [];
  }

  /** Latest delivered ISO download links (from the CI pipeline). */
  async isos(): Promise<{ name: string; url: string }[]> {
    const r = await fetch(`${CFG.bff}/bff/admin/isos`, { credentials: 'include' });
    return r.ok ? (await r.json()).isos : [];
  }

  // ── Platform-capability detection (graceful degradation of infra consoles) ──
  // The BFF reports which FOUNDATIONAL infra is present on this deployment so the
  // admin UI can show a "not possible without that" notice + suppress actions on
  // infra-dependent consoles instead of erroring. The BFF probes READ-ONLY and
  // FAILS SAFE (a capability is `false` + a warning when it cannot be detected);
  // the BFF stays the authoritative gate on every action (this only changes what
  // the UI shows). On a non-OK / network failure here we ALSO fail safe — every
  // capability absent + a warning — so a transient BFF outage degrades, not errors.
  async platformCapabilities(): Promise<PlatformCapabilities> {
    try {
      const r = await fetch(`${CFG.bff}/bff/admin/platform-capabilities`, {
        credentials: 'include',
      });
      if (r.ok) return (await r.json()) as PlatformCapabilities;
    } catch {
      // fall through to the fail-safe absent envelope
    }
    return PLATFORM_CAPABILITIES_ABSENT;
  }

  // ── ArgoCD dashboard (role-secured proxy in the admin BFF) ───────────
  // The BFF is the single contract; ArgoCD's own URL/token never leave the
  // cluster. Reads reflect LIVE ArgoCD state. The one mutating call (sync) needs
  // a typed confirmation token equal to the app name. When ArgoCD is not wired
  // the BFF returns 503 — surfaced here as the {argocdEnabled:false} state so the
  // dashboard can show an honest "ArgoCD not connected" message.
  async argoApplications(): Promise<ArgoAppList> {
    const r = await fetch(`${CFG.bff}/bff/admin/argocd/applications`, { credentials: 'include' });
    if (r.status === 503) return { items: [], unavailable: true };
    return r.ok ? { items: (await r.json()).items ?? [], unavailable: false } : { items: [], unavailable: false };
  }
  async argoApplication(name: string): Promise<ArgoAppDetail | null> {
    const r = await fetch(`${CFG.bff}/bff/admin/argocd/applications/${encodeURIComponent(name)}`, {
      credentials: 'include',
    });
    return r.ok ? r.json() : null;
  }
  /** Trigger a sync — the BFF requires {confirm: name} (typed confirmation). */
  async argoSync(name: string): Promise<ArgoSyncResult | null> {
    const r = await fetch(`${CFG.bff}/bff/admin/argocd/applications/${encodeURIComponent(name)}/sync`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ confirm: name }),
    });
    return r.ok ? r.json() : null;
  }

  // ── Unified admin-task wizard (validate → preview → apply per step) ──
  async adminTasks(): Promise<TaskDef[]> {
    const r = await fetch(`${CFG.bff}/bff/admin/tasks`, { credentials: 'include' });
    return r.ok ? (await r.json()).tasks : [];
  }
  async validateStep(taskId: string, stepId: string, input: Record<string, unknown>): Promise<ValidationResult> {
    return this.taskPhase<ValidationResult>(taskId, stepId, 'validate', input,
      { valid: false, errors: [], warnings: [] });
  }
  async previewStep(taskId: string, stepId: string, input: Record<string, unknown>): Promise<PreviewResult> {
    return this.taskPhase<PreviewResult>(taskId, stepId, 'preview', input,
      { summary: '', changes: [], validation: { valid: false, errors: [], warnings: [] } });
  }
  async applyStep(taskId: string, stepId: string, input: Record<string, unknown>): Promise<ApplyResult> {
    return this.taskPhase<ApplyResult>(taskId, stepId, 'apply', input,
      { applied: false, message: 'request failed', data: {} });
  }
  private async taskPhase<T>(taskId: string, stepId: string, phase: string,
                             input: Record<string, unknown>, fallback: T): Promise<T> {
    const r = await fetch(`${CFG.bff}/bff/admin/tasks/${taskId}/steps/${stepId}/${phase}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(input),
    });
    return r.ok ? r.json() : fallback;
  }

  // ── Cloud Backup & Recovery (ADMIN-only, BFF /bff/admin/backups|restores) ──
  // The BFF orchestrates a Kubernetes backup/restore worker Job and streams its
  // progress over SSE. The plaintext password is sent ONCE to start an encrypted
  // backup / restore and is never stored client-side; only the BFF derives the
  // PBKDF2 verifier (stored) and the worker derives the AES-256 key.

  /** Start a backup. Returns the new backup id (or throws the BFF {error}). */
  async startBackup(req: StartBackupRequest): Promise<StartJobResult> {
    return this.postJob('/bff/admin/backups', req);
  }

  /** Start a restore of an existing backup. Returns the restore job id. */
  async startRestore(req: StartRestoreRequest): Promise<StartJobResult> {
    return this.postJob('/bff/admin/restores', req);
  }

  /** Backup + restore history (newest first). */
  async backupHistory(): Promise<BackupRecord[]> {
    const r = await fetch(`${CFG.bff}/bff/admin/backups`, { credentials: 'include' });
    return r.ok ? (await r.json()).backups : [];
  }

  /** Connected/mountable USB devices offered as targets/sources (+ backups on them). */
  async usbDevices(): Promise<UsbDevice[]> {
    const r = await fetch(`${CFG.bff}/bff/admin/usb-devices`, { credentials: 'include' });
    return r.ok ? (await r.json()).devices : [];
  }

  // ── Test-Reports console (ADMIN-only, BFF /bff/admin/test-reports) ──────
  // The durable test-architecture run history + on-demand trigger + bearer-gated
  // report download + LIVE SSE progress. Endpoints (admin-bff TestReportsController):
  //   GET    /bff/admin/test-reports          → { runs:[TestRun], launchReal }
  //   GET    /bff/admin/test-reports/{id}      → TestRunDetail { run, results:[] }
  //   GET    /bff/admin/test-reports/{id}/download → application/gzip tar.gz
  //   POST   /bff/admin/test-reports/run        → { id, status:'QUEUED', tier }
  //   GET    /bff/admin/test-reports/{id}/events  → SSE Flux<TestRunEvent>
  // Admin gating is defence-in-depth (gateway + resource-server filter +
  // @PreAuthorize); this UI mirrors it but the API is the source of truth.

  /** Newest-first run history + whether the launcher really applies k8s Jobs. */
  async testReports(): Promise<TestReportsList> {
    const r = await fetch(`${CFG.bff}/bff/admin/test-reports`, { credentials: 'include' });
    return r.ok ? r.json() : { runs: [], launchReal: false };
  }

  /** One run's summary + per-(suite,role) matrix (the detail view). */
  async testReportDetail(id: string): Promise<TestRunDetail | null> {
    const r = await fetch(`${CFG.bff}/bff/admin/test-reports/${encodeURIComponent(id)}`, {
      credentials: 'include',
    });
    return r.ok ? r.json() : null;
  }

  /** Trigger a run on-demand. Returns the new run id (or throws the BFF {error}). */
  async runTestReport(req: StartTestRunRequest): Promise<StartTestRunResult> {
    const r = await fetch(`${CFG.bff}/bff/admin/test-reports/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(req),
    });
    if (r.ok) return r.json();
    const err = (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`;
    throw new Error(err);
  }

  /**
   * Download a run's stored report bundle (re-scrubbed tar.gz). Uses a credentialed
   * fetch (NOT a plain <a href>) so the HttpOnly bff_ cookie is sent, then hands the
   * Blob to a synthetic, object-URL-backed anchor so the browser saves the file.
   * Returns false (no throw) when the run has no bundle / the request is denied,
   * so the caller can surface an honest "no report available" message.
   */
  async downloadTestReport(id: string): Promise<boolean> {
    const r = await fetch(`${CFG.bff}/bff/admin/test-reports/${encodeURIComponent(id)}/download`, {
      headers: { accept: 'application/gzip' }, credentials: 'include',
    });
    if (!r.ok) return false;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = `test-report-${id.replace(/[^A-Za-z0-9._-]/g, '_')}.tar.gz`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
    return true;
  }

  /**
   * Subscribe to the SSE progress stream for a test run id. Like
   * {@link streamJobEvents} this uses a credentialed fetch + ReadableStream reader
   * (NOT raw EventSource, which cannot be aborted on teardown). The HttpOnly bff_
   * cookie rides via credentials:'include'. Parses each SSE `data:` line as a
   * TestRunEvent and invokes `onEvent`; resolves when the stream completes.
   * `signal` lets the caller abort on component teardown.
   */
  async streamTestRunEvents(runId: string, onEvent: (e: TestRunEvent) => void,
                            signal?: AbortSignal): Promise<void> {
    const r = await fetch(`${CFG.bff}/bff/admin/test-reports/${encodeURIComponent(runId)}/events`, {
      headers: { accept: 'text/event-stream' }, credentials: 'include', signal,
    });
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data:')) {
            try { onEvent(JSON.parse(line.slice(5).trim()) as TestRunEvent); } catch { /* skip keep-alive */ }
          }
        }
      }
    }
  }

  // ── Image-generation console (ADMIN/SUPERADMIN, BFF /bff/admin/image-builds) ──
  // Trigger an image build for a target user, stream SSE progress, download the
  // built image, and (only when ssh_keys_allowed + step-up) download the NON-SECRET
  // keys bundle. Endpoints (admin-bff ImageBuildController):
  //   GET    /bff/admin/image-builds              → { builds:[ImageBuild], launchReal }
  //   GET    /bff/admin/image-builds/{id}         → ImageBuild
  //   POST   /bff/admin/image-builds              → { id, status, imageType, domain, sshKeysAllowed }
  //   GET    /bff/admin/image-builds/{id}/events  → SSE Flux<ImageBuildEvent>
  //   GET    /bff/admin/image-builds/{id}/image   → application/octet-stream .img
  //   GET    /bff/admin/image-builds/{id}/keys    → application/gzip .tar.gz (X-ImageGen-StepUp)
  // The trigger + keys download additionally require the X-ImageGen-StepUp header
  // (the platform step-up token). Gating is defence-in-depth (gateway + filter +
  // @PreAuthorize + own-domain wall); the admin-bff is the source of truth.

  /** Newest-first build history + whether the generator launcher really runs (false =
   *  ships dark: a build is recorded QUEUED but no real cluster Job runs). */
  async listImageBuilds(): Promise<ImageBuildList> {
    const r = await fetch(`${CFG.bff}/bff/admin/image-builds`, { credentials: 'include' });
    return r.ok ? r.json() : { builds: [], launchReal: false };
  }

  /** One build's detail row (own-domain scoped). */
  async imageBuildDetail(id: string): Promise<ImageBuild | null> {
    const r = await fetch(`${CFG.bff}/bff/admin/image-builds/${encodeURIComponent(id)}`, {
      credentials: 'include',
    });
    return r.ok ? r.json() : null;
  }

  /**
   * Trigger a build for a target user. The optional step-up token is sent in the
   * X-ImageGen-StepUp header (the BFF requires it for the privileged trigger). Returns
   * the new build's projection, or throws the BFF {error} (e.g. 403 "requires step-up",
   * 503 when the feature ships dark / disabled).
   */
  async triggerImageBuild(req: TriggerImageBuildRequest, stepUpToken?: string): Promise<ImageBuildTriggerResult> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (stepUpToken) headers['X-ImageGen-StepUp'] = stepUpToken;
    const r = await fetch(`${CFG.bff}/bff/admin/image-builds`, {
      method: 'POST', headers, credentials: 'include', body: JSON.stringify(req),
    });
    if (r.ok) return r.json();
    const err = (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`;
    throw new Error(err);
  }

  /**
   * Trigger a WORKLIST BATCH — up to 16 images from one worklist envelope
   * ({@code {schema:'snapdragon-worklist/v1', base, entries, maxConcurrent}}) in a SINGLE
   * step-up-authorised POST to {@code /bff/admin/image-builds/batch}. Plumbing is byte-identical
   * to {@link triggerImageBuild}: the optional step-up token rides the X-ImageGen-StepUp header
   * (ONE step-up authorises the whole batch, mirroring the BFF's single {@code mfaStepUp.consume()}
   * per batch), the HttpOnly bff_ cookie rides via credentials:'include', and the BFF stamps every
   * build's domain server-side (there is intentionally NO domain field on the wire — a client can
   * never pick a tenant). Returns {@code {batchId, builds:[…]}} (each build's shape identical to the
   * single trigger's projection), or throws the BFF {error} (403 "requires step-up", 400 on a
   * malformed/oversized envelope, 503 when the feature ships dark).
   */
  async submitWorklistBatch(req: WorklistEnvelope, stepUpToken?: string): Promise<ImageBuildBatchResult> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (stepUpToken) headers['X-ImageGen-StepUp'] = stepUpToken;
    const r = await fetch(`${CFG.bff}/bff/admin/image-builds/batch`, {
      method: 'POST', headers, credentials: 'include', body: JSON.stringify(req),
    });
    if (r.ok) return r.json();
    const err = (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`;
    throw new Error(err);
  }

  /**
   * Subscribe to the SSE progress stream for a build id. Like {@link streamTestRunEvents}
   * this uses a credentialed fetch + ReadableStream reader (NOT raw EventSource, which cannot
   * be aborted on teardown); the HttpOnly bff_ cookie rides via credentials:'include'. Parses
   * each SSE `data:` line as an ImageBuildEvent and invokes `onEvent`; resolves when the stream
   * completes. `signal` lets the caller abort on teardown.
   */
  async imageBuildEvents(buildId: string, onEvent: (e: ImageBuildEvent) => void,
                         signal?: AbortSignal): Promise<void> {
    const r = await fetch(`${CFG.bff}/bff/admin/image-builds/${encodeURIComponent(buildId)}/events`, {
      headers: { accept: 'text/event-stream' }, credentials: 'include', signal,
    });
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data:')) {
            try { onEvent(JSON.parse(line.slice(5).trim()) as ImageBuildEvent); } catch { /* skip keep-alive */ }
          }
        }
      }
    }
  }

  /**
   * Download a build's image (.img). Credentialed fetch → Blob → synthetic object-URL anchor
   * (NOT a plain <a href>, so the HttpOnly bff_ cookie is sent). Returns false (no throw) when
   * the image is not available / the request is denied, so the caller can surface an honest note.
   */
  async downloadImage(id: string): Promise<boolean> {
    const r = await fetch(`${CFG.bff}/bff/admin/image-builds/${encodeURIComponent(id)}/image`, {
      headers: { accept: 'application/octet-stream' }, credentials: 'include',
    });
    if (!r.ok) return false;
    return this.saveBlob(await r.blob(), `snapdragon-image-${id.replace(/[^A-Za-z0-9._-]/g, '_')}.img`);
  }

  /**
   * Download a build's NON-SECRET SSH-keys bundle (.tar.gz). Only meaningful when the build's
   * sshKeysAllowed is true; the BFF additionally requires a satisfied step-up — EITHER the
   * X-ImageGen-StepUp token header OR a fresh Casdoor-MFA stamp on the caller's session (the "A5
   * UNIFIED step-up"; see `ImageGenStepUpGate`). The bundle is guaranteed non-secret by the
   * backend (keysRef is a build-artifacts pointer, never a private dial key) — the UI just
   * triggers the download and NEVER displays or persists any key. Throws the BFF {error} on a
   * non-2xx (mirrors {@link triggerImageBuild}) so a step-up-required 403 can be distinguished
   * from "no bundle available" and offered the inline MFA step-up dialog
   * ({@code isStepUpRequiredError}); returns true on a successful save.
   */
  async downloadImageKeys(id: string, stepUpToken?: string): Promise<boolean> {
    const headers: Record<string, string> = { accept: 'application/gzip' };
    if (stepUpToken) headers['X-ImageGen-StepUp'] = stepUpToken;
    const r = await fetch(`${CFG.bff}/bff/admin/image-builds/${encodeURIComponent(id)}/keys`, { headers, credentials: 'include' });
    if (!r.ok) throw new Error(await this.errorOf(r));
    return this.saveBlob(await r.blob(), `snapdragon-keys-${id.replace(/[^A-Za-z0-9._-]/g, '_')}.tar.gz`);
  }

  /**
   * The image-build package + image catalog, served VERBATIM by the admin-bff
   * ({@code imagegen/ImageCatalogController} GET /bff/admin/image-builds/catalog) from the
   * generator's vendored `packages-catalog.json` + `image-catalog.json`. Feeds the
   * package-selection modal (the per-platform package tree + adhoc add-on options) and the
   * wizard's role/platform/desktop-class gating. ADMIN/SUPERADMIN + own-domain scoped by the
   * BFF. Returns null (no throw) when the catalog is unavailable so a caller can degrade
   * honestly (a dark/denied console shows an empty tree, never a crash). The LIVE tier split
   * (essential / default-removable / available) is NOT in this payload — only the `gate:'base'`
   * always-on floor is declared; the builder resolves the rest at image-build time.
   */
  async imageBuildCatalog(): Promise<ImageBuildCatalog | null> {
    const r = await fetch(`${CFG.bff}/bff/admin/image-builds/catalog`, { credentials: 'include' });
    return r.ok ? r.json() : null;
  }

  /** Hand a Blob to a synthetic, object-URL-backed anchor so the browser saves the file. */
  private saveBlob(blob: Blob, filename: string): boolean {
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
    return true;
  }

  // ── Forum admin console (ADMIN-only, BFF /bff/admin/forum/**) ───────────
  // PROXIES the full phpBB ACP capability through admin-bff ForumAdminController.
  // Every response is the ForumOutcome envelope: the returned payload merged with a
  // `result` marker (`ok` | `stubbed` | `degraded:<reason>`) the console surfaces.
  // GET endpoints: /stats /usage /users /users/{id} /categories /moderation-queue /audit
  // Mutations: POST /users/{id}/ban (+DELETE), /users/{id}/groups, /categories,
  //   /moderation/{id}/approve|reject, /styles, /extensions.

  async forumStats(): Promise<ForumEnvelope> { return this.forumGet('/stats'); }
  async forumUsage(): Promise<ForumEnvelope> { return this.forumGet('/usage'); }
  async forumUsers(): Promise<ForumEnvelope> { return this.forumGet('/users'); }
  async forumUser(id: string): Promise<ForumEnvelope> { return this.forumGet(`/users/${encodeURIComponent(id)}`); }
  async forumCategories(): Promise<ForumEnvelope> { return this.forumGet('/categories'); }
  async forumModerationQueue(): Promise<ForumEnvelope> { return this.forumGet('/moderation-queue'); }
  async forumAudit(): Promise<ForumEnvelope> { return this.forumGet('/audit'); }

  async forumBan(id: string, req: ForumBanRequest): Promise<ForumEnvelope> {
    return this.forumSend('POST', `/users/${encodeURIComponent(id)}/ban`, req);
  }
  async forumUnban(id: string): Promise<ForumEnvelope> {
    return this.forumSend('DELETE', `/users/${encodeURIComponent(id)}/ban`);
  }
  async forumAssignGroup(id: string, req: ForumGroupRequest): Promise<ForumEnvelope> {
    return this.forumSend('POST', `/users/${encodeURIComponent(id)}/groups`, req);
  }
  async forumCreateCategory(req: ForumCategoryRequest): Promise<ForumEnvelope> {
    return this.forumSend('POST', '/categories', req);
  }
  async forumApprove(id: string): Promise<ForumEnvelope> {
    return this.forumSend('POST', `/moderation/${encodeURIComponent(id)}/approve`);
  }
  async forumReject(id: string): Promise<ForumEnvelope> {
    return this.forumSend('POST', `/moderation/${encodeURIComponent(id)}/reject`);
  }
  async forumInstallStyle(req: ForumInstallRequest): Promise<ForumEnvelope> {
    return this.forumSend('POST', '/styles', req);
  }
  async forumInstallExtension(req: ForumInstallRequest): Promise<ForumEnvelope> {
    return this.forumSend('POST', '/extensions', req);
  }

  private async forumGet(path: string): Promise<ForumEnvelope> {
    const r = await fetch(`${CFG.bff}/bff/admin/forum${path}`, { credentials: 'include' });
    return r.ok ? r.json() : { result: `degraded:HTTP ${r.status}` };
  }
  private async forumSend(method: string, path: string, body?: unknown): Promise<ForumEnvelope> {
    const init: RequestInit = { method, headers: {}, credentials: 'include' };
    if (body !== undefined) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const r = await fetch(`${CFG.bff}/bff/admin/forum${path}`, init);
    if (r.ok) return r.json();
    const err = (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`;
    throw new Error(err);
  }

  // ── Device-license registry console (SUPERADMIN-only, BFF /bff/admin/device-licenses) ──
  // The single source of truth for device physical-ownership, domain-residency and
  // SSH operate-licenses. The list view is ADMIN-readable (own-domain, scoped by the
  // BFF) but every MUTATION below is hasRole('SUPERADMIN') at the BFF; this console is
  // superadmin-route-guarded as defence-in-depth. Grants PIN the exact SSH public-key
  // fingerprints the operator may present; revoke is a CAS state flip (never a delete =
  // audit) returning the refreshed device list. Endpoints (admin-bff DeviceLicensesController):
  //   GET    /bff/admin/device-licenses                         → { devices:[DeviceRegistration] }
  //   POST   /bff/admin/device-licenses/{id}/grant              → { devices } (per-DEVICE license)
  //   POST   /bff/admin/device-licenses/domains/{domain}/grant  → { devices } (per-DOMAIN license)
  //   DELETE /bff/admin/device-licenses/licenses/{id}           → { devices } (CAS revoke)

  /** All registered devices with owner, domain residency + their active licenses. */
  async devices(): Promise<DeviceRegistration[]> {
    const r = await fetch(`${CFG.bff}/bff/admin/device-licenses`, { credentials: 'include' });
    return r.ok ? (await r.json()).devices : [];
  }

  /** Grant a per-DEVICE SSH operate-license to an operator, pinning their key fingerprints. */
  async grantDeviceLicense(deviceId: string, operator: string, keyFingerprints: string[]): Promise<DeviceRegistration[]> {
    return this.licenseMutation('POST',
      `/bff/admin/device-licenses/${encodeURIComponent(deviceId)}/grant`,
      { operator, keyFingerprints });
  }

  /** Grant a per-DOMAIN SSH operate-license (covers every device resident in the domain). */
  async grantDomainLicense(domain: string, operator: string, keyFingerprints: string[]): Promise<DeviceRegistration[]> {
    return this.licenseMutation('POST',
      `/bff/admin/device-licenses/domains/${encodeURIComponent(domain)}/grant`,
      { operator, keyFingerprints });
  }

  /** Revoke a license by id (CAS state flip, never deleted). Returns the refreshed list. */
  async revokeLicense(licenseId: string): Promise<DeviceRegistration[]> {
    return this.licenseMutation('DELETE',
      `/bff/admin/device-licenses/licenses/${encodeURIComponent(licenseId)}`);
  }

  private async licenseMutation(method: string, path: string, body?: unknown): Promise<DeviceRegistration[]> {
    const init: RequestInit = { method, headers: {}, credentials: 'include' };
    if (body !== undefined) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const r = await fetch(`${CFG.bff}${path}`, init);
    if (r.ok) return (await r.json()).devices ?? [];
    const err = (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`;
    throw new Error(err);
  }

  // ── SSH key-ISSUANCE console (SUPERADMIN-only mutations, BFF /bff/admin/ssh-issue) ──
  // Distinct from the license grants above: a GRANT pins an operator's OWN, already-held
  // key fingerprint; ISSUANCE here MINTS a brand-new Ed25519 keypair for an operator and
  // registers its fingerprint into the same device_ssh_license registry, then streams the
  // private key back ONCE. SHIPS DARK (app.ssh-issue.enabled=false by default): the list
  // response's `enabled` field is the honest signal — the console suppresses issue/download/
  // revoke and shows a notice when false, mirroring image-gen's capability-gate posture.
  // Every mutating verb requires a fresh step-up: EITHER the X-SshKeyIssue-StepUp header OR
  // (once wired) a fresh Casdoor-MFA stamp on the caller's own session (the A5 UNIFIED
  // step-up already implemented server-side by SshKeyIssueStepUpGate) — a 403 whose message
  // contains "requires step-up" is the shared `isStepUpRequiredError` contract. Endpoints
  // (admin-bff AdminSshKeyIssuanceController):
  //   GET    /bff/admin/ssh-issue/devices/{deviceId}/issued-keys → { deviceId, enabled, issuedKeys }
  //   POST   /bff/admin/ssh-issue/issue?deviceId=                → SshIssueResult (X-SshKeyIssue-StepUp)
  //   GET    /bff/admin/ssh-issue/issued/{id}/private-key        → application/octet-stream (one-time)
  //   DELETE /bff/admin/ssh-issue/issued/{id}                    → { revoked, id } (X-SshKeyIssue-StepUp)

  /** The issued-keys list for one device (ADMIN/SUPERADMIN, own-domain scoped by the BFF).
   *  Degrades to an empty, not-enabled list on a denied/failed read (no existence leak),
   *  matching {@link devices}/{@link pendingNodes}'s never-throw list convention. */
  async issuedSshKeys(deviceId: string): Promise<AdminSshIssuedKeyList> {
    const r = await fetch(`${CFG.bff}/bff/admin/ssh-issue/devices/${encodeURIComponent(deviceId)}/issued-keys`,
      { credentials: 'include' });
    return r.ok ? r.json() : { deviceId, enabled: false, issuedKeys: [] };
  }

  /** Mint a fresh Ed25519 credential for {@code deviceId} (SUPERADMIN-only, step-up gated).
   *  The optional step-up token rides X-SshKeyIssue-StepUp; throws the BFF {error} on a
   *  non-2xx (403 "requires step-up", 403 own-domain/superadmin-owned deny, 503 ships dark)
   *  so a step-up-required 403 can be distinguished and offered the inline MFA dialog. */
  async issueSshKey(deviceId: string, stepUpToken?: string): Promise<AdminSshIssueResult> {
    const headers: Record<string, string> = {};
    if (stepUpToken) headers['X-SshKeyIssue-StepUp'] = stepUpToken;
    const r = await fetch(`${CFG.bff}/bff/admin/ssh-issue/issue?deviceId=${encodeURIComponent(deviceId)}`,
      { method: 'POST', headers, credentials: 'include' });
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }

  /** Download an issued credential's ONE-TIME private key (SUPERADMIN-only, step-up gated).
   *  Credentialed fetch → Blob → synthetic object-URL anchor (never a plain <a href>, so the
   *  HttpOnly bff_ cookie is sent and no key bytes ever touch a URL/history entry). Throws the
   *  BFF {error} on a non-2xx (403 "requires step-up", 410 Gone if already downloaded/expired,
   *  503 ships dark). */
  async downloadSshPrivateKey(issuedKeyId: string, stepUpToken?: string): Promise<boolean> {
    const headers: Record<string, string> = { accept: 'application/octet-stream' };
    if (stepUpToken) headers['X-SshKeyIssue-StepUp'] = stepUpToken;
    const r = await fetch(`${CFG.bff}/bff/admin/ssh-issue/issued/${encodeURIComponent(issuedKeyId)}/private-key`,
      { headers, credentials: 'include' });
    if (!r.ok) throw new Error(await this.errorOf(r));
    return this.saveBlob(await r.blob(), `snapdragon-ssh-${issuedKeyId.replace(/[^A-Za-z0-9._-]/g, '_')}`);
  }

  /** Revoke an issued credential (SUPERADMIN-only, step-up gated). A dark-ships refusal is a
   *  normal 200 body `{dark:true, revoked:false, id}` (the controller never surfaces it as an
   *  error for this verb) — only a role/step-up/own-domain deny throws. */
  async revokeSshKey(issuedKeyId: string, stepUpToken?: string): Promise<AdminSshRevokeResult> {
    const headers: Record<string, string> = {};
    if (stepUpToken) headers['X-SshKeyIssue-StepUp'] = stepUpToken;
    const r = await fetch(`${CFG.bff}/bff/admin/ssh-issue/issued/${encodeURIComponent(issuedKeyId)}`,
      { method: 'DELETE', headers, credentials: 'include' });
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }

  // ── Device PENDING pick-list (machine_key_fp AUTO-CAPTURE; SUPERADMIN assigns) ──
  // The single source of truth for a device's identity is HEADSCALE (it mints the
  // machine keys). The superadmin picks a headscale-ENROLLED node from this pending
  // list and assigns owner_type/domain/image_type; the machine_key_fp is an OPAQUE
  // TOKEN captured from headscale — NEVER typed, edited, or normalised in the UI. The
  // BFF re-validates the fp against headscale at register (still enrolled + mesh
  // matches, else 409). admin-bff #68 (ships dark / advisory until a live control node
  // confirms the canonical fp field). Endpoints (admin-bff DeviceLicenseController):
  //   GET  /bff/admin/device-licenses/pending  → { nodes:[PendingNode] }
  //   POST /bff/admin/device-licenses/register  (opaque machineKeyFp) → Device

  /** The pending pick-list: every headscale-enrolled node LEFT-JOINed with the
   *  registry. ADMIN sees own-domain registered rows; SUPERADMIN also sees the
   *  unregistered (registered=false) candidates available to assign. */
  async pendingNodes(): Promise<PendingNode[]> {
    const r = await fetch(`${CFG.bff}/bff/admin/device-licenses/pending`, {
      credentials: 'include',
    });
    return r.ok ? (await r.json()).nodes ?? [] : [];
  }

  /** Register (assign) a pending headscale-enrolled node. The {@link RegisterDeviceInput.machineKeyFp}
   *  is the OPAQUE token straight from the pending list — passed through verbatim (the BFF
   *  re-validates it against headscale). Returns the created/idempotent device row. */
  async registerFromPending(input: RegisterDeviceInput): Promise<DeviceRegistration> {
    const r = await fetch(`${CFG.bff}/bff/admin/device-licenses/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(input),
    });
    if (r.ok) return (await r.json()) as DeviceRegistration;
    const err = (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`;
    throw new Error(err);
  }

  // ── Egress-VPN console (SUPERADMIN-only, BFF /bff/admin/egress-vpn) ────────────
  // Admins/superadmins import provider-downloaded VPN configs (ProtonVPN WireGuard
  // .conf first-class; OpenVPN .ovpn fallback) that mesh NODES use for OUTGOING /
  // egress traffic on public flows. The list view is ADMIN-readable (own-domain,
  // scoped by the BFF) but every MUTATION is hasRole('SUPERADMIN'); this console is
  // superadmin-route-guarded as defence-in-depth. The .conf text is sent for
  // parse-validation only — the BFF stores a secret_ref + parsed metadata, NEVER the
  // private key (secrets off-DB / off-git). Endpoints (admin-bff EgressVpnController):
  //   GET    /bff/admin/egress-vpn                                  → { configs:[], assignments:[] }
  //   POST   /bff/admin/egress-vpn/configs                          → VpnConfigRow (422 on bad config)
  //   DELETE /bff/admin/egress-vpn/configs/{id}                     → { revoked }
  //   POST   /bff/admin/egress-vpn/configs/{id}/assign/node/{fp}    → VpnNodeAssignmentRow
  //   POST   /bff/admin/egress-vpn/configs/{id}/assign/domain/{dom} → VpnNodeAssignmentRow
  //   DELETE /bff/admin/egress-vpn/assignments/{id}                 → { revoked }

  /** Every imported VPN config + every active assignment (own-domain for an ADMIN,
   *  all brands for a SUPERADMIN — the BFF scopes the read). */
  async egressVpn(): Promise<{ configs: VpnConfigRow[]; assignments: VpnNodeAssignmentRow[] }> {
    const r = await fetch(`${CFG.bff}/bff/admin/egress-vpn`, { credentials: 'include' });
    if (!r.ok) return { configs: [], assignments: [] };
    const body = await r.json();
    return { configs: body.configs ?? [], assignments: body.assignments ?? [] };
  }

  /** Import a provider VPN config. The .conf/.ovpn text is parse-validated by the BFF
   *  (a malformed config → 422 {error}); only a secret_ref + metadata are persisted. */
  async importVpnConfig(req: ImportVpnConfigRequest): Promise<VpnConfigRow> {
    const r = await fetch(`${CFG.bff}/bff/admin/egress-vpn/configs`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(req),
    });
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }

  /** Revoke a config (CAS — never deleted; cascade-revokes its assignments). */
  async revokeVpnConfig(configId: string): Promise<number> {
    return this.vpnRevoke(`/bff/admin/egress-vpn/configs/${encodeURIComponent(configId)}`);
  }

  /** Assign a config to ONE node (by its machine_key_fp), optionally narrowed to a
   *  single public service (akkoma/tuwunel/coturn; blank = all). */
  async assignVpnNode(configId: string, nodeFp: string, serviceSlug?: string): Promise<VpnNodeAssignmentRow> {
    return this.vpnAssign(
      `/bff/admin/egress-vpn/configs/${encodeURIComponent(configId)}/assign/node/${encodeURIComponent(nodeFp)}`,
      serviceSlug);
  }

  /** Assign a config to a whole DOMAIN (all that brand's public pods), optionally
   *  narrowed to a single public service. */
  async assignVpnDomain(configId: string, domain: string, serviceSlug?: string): Promise<VpnNodeAssignmentRow> {
    return this.vpnAssign(
      `/bff/admin/egress-vpn/configs/${encodeURIComponent(configId)}/assign/domain/${encodeURIComponent(domain)}`,
      serviceSlug);
  }

  /** Un-assign (revoke an assignment) by id (CAS — never deleted). */
  async revokeVpnAssignment(assignmentId: string): Promise<number> {
    return this.vpnRevoke(`/bff/admin/egress-vpn/assignments/${encodeURIComponent(assignmentId)}`);
  }

  private async vpnAssign(path: string, serviceSlug?: string): Promise<VpnNodeAssignmentRow> {
    const body = serviceSlug && serviceSlug.trim() ? { serviceSlug: serviceSlug.trim() } : {};
    const r = await fetch(`${CFG.bff}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(body),
    });
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }

  private async vpnRevoke(path: string): Promise<number> {
    const r = await fetch(`${CFG.bff}${path}`, { method: 'DELETE', credentials: 'include' });
    if (r.ok) return (await r.json()).revoked ?? 0;
    throw new Error(await this.errorOf(r));
  }

  // ── Domain registry console (SUPERADMIN-only, BFF /bff/admin/domains) ──────────
  // The RUNTIME source of truth for the cluster's brands/domains (multi-tenancy PR9),
  // the SUPERADMIN-managed twin of the build-time brands/domains.conf. EVERY endpoint is
  // @PreAuthorize("hasRole('SUPERADMIN')") at the BFF (DomainRegistryController); this
  // console is superadmin-route-guarded as defence-in-depth. The list is a bare JSON array
  // (Flux<DomainResponse>); create returns the single persisted DomainResponse. A duplicate
  // cluster_domain is a clean 409 carrying the {error} message. There is NO delete — a
  // domain is SOFT-DISABLED via PUT with enabled:false. Endpoints:
  //   GET  /bff/admin/domains                  → [DomainResponse]
  //   GET  /bff/admin/domains/{clusterDomain}  → DomainResponse (404 if none)
  //   POST /bff/admin/domains                  → DomainResponse (201; 409 on duplicate)
  //   PUT  /bff/admin/domains/{clusterDomain}  → DomainResponse (404 if none)

  /** Every registered domain (the SUPERADMIN brand-list surface). */
  async listDomains(): Promise<DomainResponse[]> {
    const r = await fetch(`${CFG.bff}/bff/admin/domains`, { credentials: 'include' });
    return r.ok ? r.json() : [];
  }

  /** Register a new domain. Returns the persisted row, or throws the BFF {error}
   *  (a duplicate cluster_domain → 409; a malformed body → 400). */
  async createDomain(req: CreateDomainRequest): Promise<DomainResponse> {
    const r = await fetch(`${CFG.bff}/bff/admin/domains`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(req),
    });
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }

  private async postJob(path: string, body: unknown): Promise<StartJobResult> {
    const r = await fetch(`${CFG.bff}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(body),
    });
    if (r.ok) return r.json();
    const err = (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`;
    throw new Error(err);
  }

  /**
   * Subscribe to the SSE progress stream for a backup OR restore job id. Uses a
   * credentialed fetch (not EventSource, which cannot be aborted on teardown) so the
   * HttpOnly bff_ cookie rides via credentials:'include'. Parses the SSE `data:`
   * JobEvent lines and invokes `onEvent` for each; resolves when the stream
   * completes. `signal` lets the caller abort (component teardown).
   */
  async streamJobEvents(jobId: string, onEvent: (e: BackupJobEvent) => void,
                        signal?: AbortSignal): Promise<void> {
    const r = await fetch(`${CFG.bff}/bff/admin/backups/${encodeURIComponent(jobId)}/events`, {
      headers: { accept: 'text/event-stream' }, credentials: 'include', signal,
    });
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line; each frame may carry a data: line.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data:')) {
            try { onEvent(JSON.parse(line.slice(5).trim()) as BackupJobEvent); } catch { /* skip keep-alive */ }
          }
        }
      }
    }
  }

  // ── OIDC provider default-role mappings ──────────────────────────────────
  async oidcProviderRoles(): Promise<OidcProviderMapping[]> {
    const r = await fetch(`${CFG.bff}/bff/admin/oidc-providers/roles`, { credentials: 'include' });
    if (!r.ok) return [];
    const body: { providers: OidcProviderMapping[] } = await r.json();
    return body.providers ?? [];
  }

  async setOidcProviderRoles(provider: string, roles: string[]): Promise<void> {
    await fetch(`${CFG.bff}/bff/admin/oidc-providers/${encodeURIComponent(provider)}/roles`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ roles }),
    });
  }

  async clearOidcProviderRoles(provider: string): Promise<void> {
    await fetch(`${CFG.bff}/bff/admin/oidc-providers/${encodeURIComponent(provider)}/roles`, {
      method: 'DELETE', credentials: 'include',
    });
  }

  // ── Node-storage console (ADMIN-capable, BFF /bff/admin/device-storage-pools) ──
  // ADDITIONAL storage an operator ATTACHES to a specific mesh node so services can use
  // SPACE on that node (schema 085). DELIBERATE DIVERGENCE from device-licenses: storage is
  // ADMIN-CAPABLE (not superadmin-only) but OWNERSHIP-gated downstream in the BFF — an ADMIN
  // acts ONLY on own-domain ADMIN-owned nodes (DENY -> 403), any SUPERADMIN-owned node is
  // SUPERADMIN-only, SUPERADMIN unrestricted. The pool/assignment domain is stamped from the
  // node's RESIDENCY by the BFF, never the caller. Over-subscription / unknown-node -> 422.
  // Endpoints (admin-bff StoragePoolController):
  //   GET    /bff/admin/device-storage-pools                          → { pools, assignments }
  //   POST   /bff/admin/device-storage-pools/{deviceId}/pools         → StoragePool (attach)
  //   DELETE /bff/admin/device-storage-pools/pools/{poolId}           → { detached }
  //   POST   /bff/admin/device-storage-pools/pools/{poolId}/assignments → ServiceAssignment
  //   DELETE /bff/admin/device-storage-pools/assignments/{assignmentId} → { revoked }

  /** Pools + assignments VISIBLE to the caller (ADMIN own-domain, SUPERADMIN all). */
  async storagePools(): Promise<{ pools: StoragePool[]; assignments: ServiceAssignment[] }> {
    const r = await fetch(`${CFG.bff}/bff/admin/device-storage-pools`, {
      credentials: 'include',
    });
    if (!r.ok) return { pools: [], assignments: [] };
    const body = await r.json();
    return { pools: body.pools ?? [], assignments: body.assignments ?? [] };
  }

  /** Attach additional storage to a node. Throws the BFF {error} (403 ownership DENY /
   *  422 unknown-node). */
  async attachPool(deviceId: string, body: AttachPoolBody): Promise<StoragePool> {
    return this.storageMutation('POST',
      `/bff/admin/device-storage-pools/${encodeURIComponent(deviceId)}/pools`, body);
  }

  /** Detach a pool (refused by the BFF with 422 while it still has an active assignment). */
  async detachPool(poolId: string): Promise<{ detached: number }> {
    return this.storageMutation('DELETE',
      `/bff/admin/device-storage-pools/pools/${encodeURIComponent(poolId)}`);
  }

  /** Assign a service to a pool (capacity-aware; over-subscription / exclusivity → 422). */
  async assignService(poolId: string, body: AssignServiceBody): Promise<ServiceAssignment> {
    return this.storageMutation('POST',
      `/bff/admin/device-storage-pools/pools/${encodeURIComponent(poolId)}/assignments`, body);
  }

  /** Revoke an assignment (CAS state flip, never deleted = audit). */
  async revokeAssignment(assignmentId: string): Promise<{ revoked: number }> {
    return this.storageMutation('DELETE',
      `/bff/admin/device-storage-pools/assignments/${encodeURIComponent(assignmentId)}`);
  }

  private async storageMutation<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: {}, credentials: 'include' };
    if (body !== undefined) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const r = await fetch(`${CFG.bff}${path}`, init);
    if (r.ok) return r.json() as Promise<T>;
    throw new Error(await this.errorOf(r));
  }

  // ── Node-radio console (ADMIN-capable, BFF /bff/admin/device-radios) ───────
  // A Meshtastic LoRa RADIO an operator ATTACHES to a specific mesh node so the
  // meshbridge optional service (mesh↔Matrix bridge) can reach the LoRa mesh through that
  // node (schema 300). CLONES the node-storage divergence: radios are ADMIN-CAPABLE (not
  // superadmin-only) but OWNERSHIP-gated downstream in the BFF — an ADMIN acts ONLY on
  // own-domain ADMIN-owned nodes (DENY -> 403), any SUPERADMIN-owned node is
  // SUPERADMIN-only, SUPERADMIN unrestricted. The radio domain is stamped from the node's
  // RESIDENCY by the BFF, never the caller. Mixed transport shape / unknown-node -> 422.
  // Endpoints (admin-bff RadioDeviceController):
  //   GET    /bff/admin/device-radios                      → { radios }
  //   POST   /bff/admin/device-radios/{deviceId}/radios    → NodeRadio (attach)
  //   DELETE /bff/admin/device-radios/radios/{radioId}     → { detached }

  /** Radios VISIBLE to the caller (ADMIN own-domain, SUPERADMIN all). */
  async radios(): Promise<NodeRadio[]> {
    const r = await fetch(`${CFG.bff}/bff/admin/device-radios`, {
      credentials: 'include',
    });
    if (!r.ok) return [];
    const body = await r.json();
    return body.radios ?? [];
  }

  /** Attach a radio to a node. Throws the BFF {error} (403 ownership DENY /
   *  422 unknown-node or mixed transport shape). */
  async attachRadio(deviceId: string, body: AttachRadioBody): Promise<NodeRadio> {
    return this.radioMutation('POST',
      `/bff/admin/device-radios/${encodeURIComponent(deviceId)}/radios`, body);
  }

  /** Detach a radio (CAS state flip, never deleted = audit). */
  async detachRadio(radioId: string): Promise<{ detached: number }> {
    return this.radioMutation('DELETE',
      `/bff/admin/device-radios/radios/${encodeURIComponent(radioId)}`);
  }

  private async radioMutation<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: {}, credentials: 'include' };
    if (body !== undefined) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const r = await fetch(`${CFG.bff}${path}`, init);
    if (r.ok) return r.json() as Promise<T>;
    throw new Error(await this.errorOf(r));
  }

  // ── Games app-store (games-services control plane) ──────────────────────────
  // The operator UI reads the offered catalog + lists/creates/run-stops instances.
  // Authz is enforced at the BFF (the games-services derived roles + DomainScope);
  // this console additionally greys-out create for a runner (the BFF is the real gate).
  //   GET  /bff/games-services/catalog            → [GameOffer]      (offered + enabled for the domain)
  //   GET  /bff/games-services/instances          → [GameInstance]   (own brand)
  //   POST /bff/games-services/instances          → GameInstance     (201; 403 on the creation gate)
  //   POST /bff/games-services/instances/{id}/{suspend|resume|terminate} → GameInstance

  /** The catalog servers offered + enabled for the caller's domain. */
  async gamesOfferedCatalog(): Promise<GameOffer[]> {
    const r = await fetch(`${CFG.bff}/bff/games-services/catalog`, { credentials: 'include' });
    return r.ok ? r.json() : [];
  }

  /** The caller's own-brand instances. */
  async gamesInstances(): Promise<GameInstance[]> {
    const r = await fetch(`${CFG.bff}/bff/games-services/instances`, { credentials: 'include' });
    return r.ok ? r.json() : [];
  }

  /** Request a new instance. Returns the persisted row, or throws the BFF {error}
   *  (the creation gate → 403; a duplicate name → 409). */
  async createGameInstance(req: CreateGameInstanceRequest): Promise<GameInstance> {
    const r = await fetch(`${CFG.bff}/bff/games-services/instances`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(req),
    });
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }

  /** Run/stop transition (suspend | resume | terminate). Returns the updated row. */
  async gameInstanceAction(id: string, action: 'suspend' | 'resume' | 'terminate'): Promise<GameInstance> {
    const r = await fetch(
      `${CFG.bff}/bff/games-services/instances/${encodeURIComponent(id)}/${action}`,
      { method: 'POST', credentials: 'include' });
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }

  // ── Anubis bot-challenge sidecar (SUPERADMIN only) ────────────────────────
  async anubisStatus(): Promise<AnubisStatus> {
    const r = await fetch(`${CFG.bff}/bff/admin/anubis/status`, { credentials: 'include' });
    return r.ok ? r.json() : { enabled: false, managementUrl: '', difficulty: 0, health: 'error', reachable: false };
  }

  async anubisMetrics(): Promise<AnubisMetricsResponse> {
    const r = await fetch(`${CFG.bff}/bff/admin/anubis/metrics`, { credentials: 'include' });
    return r.ok ? r.json() : { enabled: false, raw: '', metrics: [] };
  }

  // ── Workload Console (podman/OpenShift-equivalent pod-mgmt + live-log + TTY) ──
  // The whole surface 404s when the feature is dark (generator gate off / DB master flag
  // off / no active grant) — the capability probe is the server-confirmed gate the
  // workloadConsoleGuard + the HIDDEN menu entry read. ADMIN reads /bff/admin/workloads/**
  // (read-only own-domain, grant-gated); SUPERADMIN reaches /bff/superadmin/workloads/**.

  /** The capability probe — 200 (with a body) iff the caller has a live grant/role on the
   *  workload console; 404 on deny (no existence leak). Returns null on any non-200. */
  async workloadCapability(): Promise<WorkloadCapability | null> {
    try {
      const r = await fetch(`${CFG.bff}/bff/admin/workloads/capability`, {
        credentials: 'include',
      });
      return r.ok ? (await r.json()) as WorkloadCapability : null;
    } catch {
      return null;
    }
  }

  /** Pods for one namespace (ADMIN own-domain attributed). */
  async workloadPods(namespace: string): Promise<WorkloadPod[]> {
    return this.workloadGet<WorkloadPod[]>(`/bff/admin/workloads/pods/${encodeURIComponent(namespace)}`, []);
  }

  /** All pods across the app-tier allowlist (SUPERADMIN cross-cluster view). */
  async workloadAllPods(): Promise<WorkloadPod[]> {
    return this.workloadGet<WorkloadPod[]>(`/bff/superadmin/workloads/pods`, []);
  }

  async workloadInspect(namespace: string, name: string): Promise<WorkloadPodInspect | null> {
    return this.workloadGet<WorkloadPodInspect | null>(
      `/bff/admin/workloads/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, null);
  }

  async workloadMetrics(namespace: string): Promise<WorkloadMetric[]> {
    return this.workloadGet<WorkloadMetric[]>(`/bff/admin/workloads/metrics/${encodeURIComponent(namespace)}`, []);
  }

  async workloadEvents(namespace: string): Promise<WorkloadEvent[]> {
    return this.workloadGet<WorkloadEvent[]>(`/bff/admin/workloads/events/${encodeURIComponent(namespace)}`, []);
  }

  async workloadStorage(namespace: string): Promise<WorkloadVolume[]> {
    return this.workloadGet<WorkloadVolume[]>(`/bff/admin/workloads/storage/${encodeURIComponent(namespace)}`, []);
  }

  async workloadNetwork(namespace: string): Promise<WorkloadNetwork[]> {
    return this.workloadGet<WorkloadNetwork[]>(`/bff/admin/workloads/network/${encodeURIComponent(namespace)}`, []);
  }

  /** Non-stream, server-redacted log read (admin log_access-gated). */
  async workloadLogs(namespace: string, pod: string, container?: string, tail = 200): Promise<WorkloadLogResult> {
    const q = new URLSearchParams();
    if (container) q.set('container', container);
    q.set('tail', String(tail));
    const r = await fetch(
      `${CFG.bff}/bff/admin/workloads/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/logs?${q}`,
      { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  /** SUPERADMIN live log-tail (SSE, server-redacted). Mirrors {@link streamJobEvents}. */
  async streamWorkloadLogs(namespace: string, pod: string, container: string | undefined,
                           onLine: (e: WorkloadLogLine) => void, signal?: AbortSignal): Promise<void> {
    const q = container ? `?container=${encodeURIComponent(container)}` : '';
    const r = await fetch(
      `${CFG.bff}/bff/superadmin/workloads/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/logs/stream${q}`,
      { headers: { accept: 'text/event-stream' }, credentials: 'include', signal });
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data:')) {
            try { onLine(JSON.parse(line.slice(5).trim()) as WorkloadLogLine); } catch { /* keep-alive */ }
          }
        }
      }
    }
  }

  // TODO(workload-console): unlike workloadLifecycle/triggerImageBuild/desktopRemoteInstall
  // etc., this call has no stepUpToken parameter and never sends X-Workload-StepUp, even
  // though the caller (WorkloadConsoleComponent.rolloutRestart) mints one via workloadStepUp()
  // first. If the BFF's DANGEROUS-tier gate actually requires that header here (as the console's
  // own docblock claims), every rollout-restart call is either silently unauthenticated for
  // step-up or fails outright — worth confirming against WorkloadSuperadminController and wiring
  // the token through if so.
  /** SUPERADMIN rollout-restart = delete the workload's pods (selfHeal-neutral). */
  async workloadRolloutRestart(namespace: string, workload: string): Promise<unknown> {
    return this.workloadMutate('POST',
      `/bff/superadmin/workloads/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(workload)}/rollout-restart`);
  }

  // TODO(workload-console): same gap as workloadRolloutRestart above — no stepUpToken
  // parameter, so the minted X-Workload-StepUp token never rides this DELETE either.
  /** SUPERADMIN delete one pod. */
  async workloadDeletePod(namespace: string, pod: string): Promise<unknown> {
    return this.workloadMutate('DELETE',
      `/bff/superadmin/workloads/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}`);
  }

  /** SUPERADMIN mint a short-TTL step-up token (required for DANGEROUS ops). */
  async workloadStepUp(operatorId?: string): Promise<WorkloadStepUp> {
    const q = operatorId ? `?operatorId=${encodeURIComponent(operatorId)}` : '';
    return this.workloadMutate<WorkloadStepUp>('POST', `/bff/superadmin/workloads/step-up${q}`);
  }

  /** SUPERADMIN GitOps lifecycle intent (scale/deploy/remove/export-manifest). The step-up
   *  token, if present, is sent in X-Workload-StepUp (the BFF requires it for the DANGEROUS
   *  tier). Returns the pending intent the UI surfaces as "pending sync". */
  async workloadLifecycle(namespace: string, workload: string, verb: string,
                          body: WorkloadLifecycleRequest, stepUpToken?: string): Promise<WorkloadIntent> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (stepUpToken) headers['X-Workload-StepUp'] = stepUpToken;
    const r = await fetch(
      `${CFG.bff}/bff/superadmin/workloads/lifecycle/${encodeURIComponent(namespace)}/${encodeURIComponent(workload)}/${encodeURIComponent(verb)}`,
      { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
    return r.json();
  }

  /** SUPERADMIN pending GitOps intents ("pending sync"). */
  async workloadPendingIntents(): Promise<WorkloadIntent[]> {
    return this.workloadGet<WorkloadIntent[]>(`/bff/superadmin/workloads/lifecycle/pending`, []);
  }

  // ── grants/config control plane (SUPERADMIN) ──────────────────────────────
  async workloadGrants(): Promise<WorkloadGrant[]> {
    return this.workloadGet<WorkloadGrant[]>(`/bff/superadmin/workloads/grants`, []);
  }

  async workloadGrant(body: WorkloadGrantRequest): Promise<WorkloadGrant> {
    return this.workloadMutate<WorkloadGrant>('POST', `/bff/superadmin/workloads/grants`, body);
  }

  async workloadRevokeGrant(id: string): Promise<unknown> {
    return this.workloadMutate('DELETE', `/bff/superadmin/workloads/grants/${encodeURIComponent(id)}`);
  }

  async workloadConfig(): Promise<WorkloadConfigRow[]> {
    return this.workloadGet<WorkloadConfigRow[]>(`/bff/superadmin/workloads/config`, []);
  }

  async workloadPutConfig(domain: string, adminEnabled: boolean,
                          dangerousTierEnabled: boolean): Promise<WorkloadConfigRow> {
    return this.workloadMutate<WorkloadConfigRow>('PUT',
      `/bff/superadmin/workloads/config/${encodeURIComponent(domain)}`,
      { adminEnabled, dangerousTierEnabled });
  }

  // ── shared workload helpers ────────────────────────────────────────────────
  private async workloadGet<T>(path: string, empty: T): Promise<T> {
    const r = await fetch(`${CFG.bff}${path}`, { credentials: 'include' });
    if (!r.ok) {
      if (r.status === 404 || r.status === 403) return empty; // dark / denied — no existence leak
      throw new Error(`HTTP ${r.status}`);
    }
    return r.json();
  }

  private async workloadMutate<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: {}, credentials: 'include' };
    if (body !== undefined) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const r = await fetch(`${CFG.bff}${path}`, init);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
    return r.json().catch(() => ({} as T));
  }

  // ── DESKTOP APP GOVERNANCE (ADMIN/SUPERADMIN, admin-bff /bff/admin/desktop/**) ──
  // The UI front-end for the desktop-governance admin-bff foundation (admin-bff PR #70,
  // ships dark). FIVE surfaces, all under /bff/admin/desktop and coarse-gated
  // hasAnyRole('ADMIN','SUPERADMIN') with own-domain scope from the validated issuer
  // (NEVER a request field); SUPERADMIN unscoped. The console mirrors that posture for
  // presentation (disable + helptext) but the BFF is the source of truth.
  //
  //   DISCOVER CATALOG (default-NONE allowlist; add != enable):
  //     GET    /bff/admin/desktop/catalog                 → [DesktopCatalogEntry]
  //     POST   /bff/admin/desktop/catalog  {appRef,displayName,source?} → DesktopCatalogEntry (201)
  //     POST   /bff/admin/desktop/catalog/{id}/enable     → { updated, enabled:true }
  //     POST   /bff/admin/desktop/catalog/{id}/disable    → { updated, enabled:false }
  //     DELETE /bff/admin/desktop/catalog/{id}            → { removed }
  //   SUDO grant (rides device-ssh-license; own-domain wall; SA unscoped):
  //     GET    /bff/admin/desktop/sudo                    → [DesktopSudoGrant]
  //     POST   /bff/admin/desktop/sudo/grant  {subject,deviceId} → DesktopSudoGrant
  //              403 = no active ssh-license; 422 = superadmin-owned device / cross-domain
  //     DELETE /bff/admin/desktop/sudo/{grantId}          → { revoked }
  //   INSTALL-REQUEST inbox (brand-scoped; single-winner CAS decide):
  //     GET    /bff/admin/desktop/install-requests        → [DesktopInstallRequest]
  //     POST   /bff/admin/desktop/install-requests/{id}/decide?status=approved|denied|installed
  //                                                       → { decided, status }
  //   STEP-UP mint (ADMIN+SUPERADMIN; license-gated, single-use, leader-pinned):
  //     POST   /bff/admin/desktop/step-up → DesktopStepUp {stepUpToken, ttlMinutes}
  //   REMOTE-INSTALL trigger (rides ssh-license; own-domain; NOT superadmin-owned node;
  //   REQUIRES the shared X-Device-Terminal-StepUp header — missing/blank = 403):
  //     POST   /bff/admin/desktop/remote-install  {deviceId,appRef} → string (403 on deny)
  //   SSH-TERMINAL session open — the WS PRE-HANDSHAKE DESCRIPTOR (authorization is REAL,
  //   carries the real wsPath '/bff/admin/device-terminal/{deviceId}' + stepUpRequired +
  //   dark:<app.device-terminal.enabled flag>; the live xterm.js WS opens to that path with the
  //   step-up token carried via the Sec-WebSocket-Protocol subprotocol, NOT a query token):
  //     POST   /bff/admin/desktop/ssh-terminal/sessions?deviceId=... → DesktopSshSession (403 on deny)
  //   DIAL management (SUPERADMIN-only; see the dedicated block below).

  /** The acting admin's Discover catalog (own brand; SUPERADMIN all brands). A dark/denied
   *  surface yields [] (no existence leak) via the shared workloadGet helper. */
  async desktopCatalog(): Promise<DesktopCatalogEntry[]> {
    return this.workloadGet<DesktopCatalogEntry[]>('/bff/admin/desktop/catalog', []);
  }

  /** Add an app ref to the caller's brand catalog (DISABLED by default — add != enable).
   *  The domain is the caller's validated brand (never sent). Throws the BFF {error} on
   *  a validation reject (bad source / duplicate ref). */
  async desktopCatalogAdd(appRef: string, displayName: string, source?: string): Promise<DesktopCatalogEntry> {
    const body: Record<string, string> = { appRef, displayName };
    if (source) body['source'] = source;
    return this.workloadMutate<DesktopCatalogEntry>('POST', '/bff/admin/desktop/catalog', body);
  }

  /** Enable a catalog row (make it appear in the brand's Discover store). */
  async desktopCatalogEnable(id: string): Promise<{ updated: number; enabled: boolean }> {
    return this.workloadMutate('POST', `/bff/admin/desktop/catalog/${encodeURIComponent(id)}/enable`);
  }

  /** Disable a catalog row (remove from Discover; KEEPS the row). */
  async desktopCatalogDisable(id: string): Promise<{ updated: number; enabled: boolean }> {
    return this.workloadMutate('POST', `/bff/admin/desktop/catalog/${encodeURIComponent(id)}/disable`);
  }

  /** Remove a catalog row entirely. */
  async desktopCatalogRemove(id: string): Promise<{ removed: number }> {
    return this.workloadMutate('DELETE', `/bff/admin/desktop/catalog/${encodeURIComponent(id)}`);
  }

  /** The acting admin's desktop-sudo grants (own brand; SUPERADMIN all). */
  async desktopSudoGrants(): Promise<DesktopSudoGrant[]> {
    return this.workloadGet<DesktopSudoGrant[]>('/bff/admin/desktop/sudo', []);
  }

  /** Grant a desktop user SSO-enforced sudo on a device (idempotent; domain stamped from the
   *  device's residency). Throws the BFF {error}: 403 = the acting admin holds no active
   *  device-ssh-license for the target; 422 = the device is superadmin-owned OR in another
   *  brand (own-domain wall). */
  async desktopSudoGrant(subject: string, deviceId: string): Promise<DesktopSudoGrant> {
    return this.workloadMutate<DesktopSudoGrant>('POST', '/bff/admin/desktop/sudo/grant', { subject, deviceId });
  }

  /** Revoke a sudo grant by id (CAS audit; removes the SSO claim at the next token refresh). */
  async desktopSudoRevoke(grantId: string): Promise<{ revoked: number }> {
    return this.workloadMutate('DELETE', `/bff/admin/desktop/sudo/${encodeURIComponent(grantId)}`);
  }

  /** The brand's desktop install-request inbox (own brand; SUPERADMIN all). */
  async desktopInstallRequests(): Promise<DesktopInstallRequest[]> {
    return this.workloadGet<DesktopInstallRequest[]>('/bff/admin/desktop/install-requests', []);
  }

  /** Decide an install request (CAS pending -> approved|denied|installed, single-winner,
   *  brand-scoped). Returns the affected row count (decided:0 = already decided / out of scope). */
  async desktopDecideRequest(id: string, status: DesktopRequestDecision): Promise<{ decided: number; status: string }> {
    return this.workloadMutate('POST',
      `/bff/admin/desktop/install-requests/${encodeURIComponent(id)}/decide?status=${encodeURIComponent(status)}`);
  }

  /** Mint a short-TTL, single-use desktop step-up token (POST /bff/admin/desktop/step-up). Unlike
   *  the SUPERADMIN-only {@link workloadStepUp}, this mint is reachable by ADMIN+SUPERADMIN, gated
   *  at the BFF by an ACTIVE own-domain device-OR-domain SSH-license precondition. The minted token
   *  is carried in the shared X-Device-Terminal-StepUp header on BOTH the remote-install call and
   *  the live SSH-terminal WS handshake. {@code operatorId} defaults at the BFF to the JWT subject;
   *  the UI passes the lowercased session id for parity with the other step-up idioms. Throws the
   *  BFF {error} (403 = no active license / role) via errorOf. */
  async desktopStepUp(operatorId?: string): Promise<DesktopStepUp> {
    const op = (operatorId ?? this.session.session()?.id ?? '').toLowerCase();
    const q = op ? `?operatorId=${encodeURIComponent(op)}` : '';
    return this.workloadMutate<DesktopStepUp>('POST', `/bff/admin/desktop/step-up${q}`);
  }

  /** Trigger a one-click remote install of {@code appRef} onto {@code deviceId}, riding the
   *  acting admin's device-ssh-license. The operator is the caller's JWT subject (never sent).
   *  REQUIRES a fresh step-up token (mint via {@link desktopStepUp}) carried in the shared
   *  X-Device-Terminal-StepUp header — the BFF returns 403 on a missing/blank token even for an
   *  otherwise-authorized admin (fail-closed tightening). Throws the BFF {error} (403) when not
   *  permitted: missing step-up, no active own-domain ssh-license, the ref is not in the domain's
   *  ENABLED allowlist, or the device is cross-domain / superadmin-owned. While the BFF ships dark
   *  (app.desktop.remote-install.enabled=false) it returns a {"dark":true,...} result descriptor. */
  async desktopRemoteInstall(deviceId: string, appRef: string, stepUpToken?: string): Promise<string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (stepUpToken) headers['X-Device-Terminal-StepUp'] = stepUpToken;
    const r = await fetch(`${CFG.bff}/bff/admin/desktop/remote-install`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ deviceId, appRef }),
    });
    if (r.ok) return r.text();
    throw new Error(await this.errorOf(r));
  }

  /** Open (authorize) an in-UI SSH-terminal session for {@code deviceId}. SCAFFOLD — the
   *  admin-bff currently SHIPS DARK: the authorization is REAL (same own-domain device-ssh-
   *  license check as remote-install; 403 on deny) but it returns a {@code dark:true}
   *  descriptor rather than opening a live TTY. The live xterm.js WebSocket bridge (reusing
   *  the workload-console TTY/SSE infra) lands in a follow-on increment; until then the
   *  component renders the terminal greyed with helptext explaining the dark state. */
  async desktopOpenSshSession(deviceId: string): Promise<DesktopSshSession> {
    const r = await fetch(
      `${CFG.bff}/bff/admin/desktop/ssh-terminal/sessions?deviceId=${encodeURIComponent(deviceId)}`,
      { method: 'POST', credentials: 'include' });
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }

  // ── SSH DIAL management (SUPERADMIN-only, /bff/superadmin/desktop/dials) ──
  // The per-device BFF->device SSH dial trust (device_ssh_dial). The terminal/remote-install
  // cannot go live for a device until its dial is ACTIVE. Lists status (PENDING/ACTIVE/
  // REVOKED); activate is a deliberate SUPERADMIN action (PENDING->ACTIVE, refused 422 when
  // the row has no host_key_fp pin); revoke is a CAS. Activate/revoke REQUIRE the same shared
  // X-Device-Terminal-StepUp step-up token. Ships dark behind app.device-terminal.dial.enabled:
  // the leg returns 503 while the flag is off, and the capability probe reports it.
  //   GET    /bff/superadmin/desktop/dials                  → [DeviceSshDial]
  //   GET    /bff/superadmin/desktop/dials/{deviceId}        → DeviceSshDial (404 generic if absent)
  //   POST   /bff/superadmin/desktop/dials/{deviceId}/activate → DeviceSshDial (422 unpinned | 503 dark)
  //   POST   /bff/superadmin/desktop/dials/{deviceId}/revoke   → DeviceSshDial

  /** The dial-leg capability probe — true iff app.device-terminal.dial.enabled is on AND the
   *  caller may list dials (a non-empty list, or an explicit 200 on the list, signals enabled).
   *  Mirrors the HIDDEN-tier workloadCapability idiom: any non-200 / network error → false (no
   *  existence leak, surface stays hidden). A 403/404 means "not for you" → hidden. */
  async desktopDialCapability(): Promise<boolean> {
    try {
      const r = await fetch(`${CFG.bff}/bff/superadmin/desktop/dials`, {
        credentials: 'include',
      });
      return r.ok; // 200 = leg enabled + caller is SUPERADMIN; 403/404/503 → hidden
    } catch {
      return false;
    }
  }

  /** All per-device dials (SUPERADMIN). A dark/denied surface yields [] (no existence leak). */
  async desktopDials(): Promise<DeviceSshDial[]> {
    return this.workloadGet<DeviceSshDial[]>('/bff/superadmin/desktop/dials', []);
  }

  /** Activate a device's dial (PENDING->ACTIVE, generation bumped). REQUIRES a fresh step-up
   *  token (X-Device-Terminal-StepUp). Throws the BFF {error}: 422 = the row carries no
   *  host-key pin; 503 = the dial leg is dark; 404 = no such dial; 403 = missing step-up. */
  async desktopDialActivate(deviceId: string, stepUpToken: string): Promise<DeviceSshDial> {
    return this.desktopDialMutate(`/bff/superadmin/desktop/dials/${encodeURIComponent(deviceId)}/activate`, stepUpToken);
  }

  /** Revoke a device's dial (CAS -> REVOKED). REQUIRES a fresh step-up token. */
  async desktopDialRevoke(deviceId: string, stepUpToken: string): Promise<DeviceSshDial> {
    return this.desktopDialMutate(`/bff/superadmin/desktop/dials/${encodeURIComponent(deviceId)}/revoke`, stepUpToken);
  }

  /** Shared dial activate/revoke POST — carries the bearer + the step-up header; throws the BFF
   *  {error} on any non-2xx (so a 422/503/404/403 surfaces verbatim to the operator). */
  private async desktopDialMutate(path: string, stepUpToken: string): Promise<DeviceSshDial> {
    const r = await fetch(`${CFG.bff}${path}`, {
      method: 'POST',
      headers: { 'X-Device-Terminal-StepUp': stepUpToken }, credentials: 'include',
    });
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }
}

// ── Backup & Recovery DTOs (mirror the BFF backup package shapes) ─────
export interface StartBackupRequest {
  scope: string[];
  target: 'CLUSTER' | 'USB';
  usbDeviceId?: string | null;
  encrypt: boolean;
  password?: string | null;
}
export interface StartRestoreRequest {
  backupId: string;
  scope?: string[] | null;
  password?: string | null;
}
export interface StartJobResult { id: string; status: string; }
export interface BackupRecord {
  id: string;
  created_at: string;
  requested_by: string;
  scope: string;
  target: 'CLUSTER' | 'USB';
  encrypted: boolean;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  size_bytes?: number | null;
  error?: string | null;
  location_ref?: string | null;
}
export interface UsbBackup { ref: string; created_at: string; size_bytes?: number | null; encrypted: boolean; }
export interface UsbDevice {
  id: string;
  label: string;
  mount_point: string;
  size_bytes?: number | null;
  free_bytes?: number | null;
  writable: boolean;
  backups: UsbBackup[];
}
export interface BackupJobEvent {
  jobId: string;
  phase: string;
  percent: number;
  message: string;
  done: boolean;
  error?: string | null;
}

// ── ArgoCD DTOs (mirror the BFF proxy's flattened ArgoCD shapes) ──────
export interface ArgoApp {
  name: string;
  project: string;
  namespace: string;
  syncStatus: string;
  health: string;
  revision: string;
  repoUrl?: string;
  path?: string;
  targetRevision?: string;
}
export interface ArgoAppList { items: ArgoApp[]; unavailable: boolean; }
export interface ArgoResourceNode {
  group: string; kind: string; namespace: string; name: string;
  version: string; syncStatus: string; health: string; parentRefs: string[];
}
export interface ArgoAppDetail {
  app: ArgoApp;
  resourceTree: { nodes: ArgoResourceNode[] };
  message: string;
}
export interface ArgoSyncResult {
  name: string; accepted: boolean; phase: string; revision: string; message: string;
}

// ── Admin-task wizard DTOs (mirror the BFF task/step model) ───────────
export interface FieldDef {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder: string;
  /**
   * Optional persistent, visible help describing what the field is for / how to
   * fill it. Rendered as `.field-help` and wired to the input via
   * aria-describedby (so it is announced WITH the control, unlike the
   * placeholder, which AT does not reliably read and which vanishes on input).
   */
  hint?: string | null;
}
export interface StepDef { id: string; title: string; fields: FieldDef[]; }
export interface TaskDef { id: string; title: string; description: string; steps: StepDef[]; }
export interface FieldError { field: string; message: string; }
export interface ValidationResult { valid: boolean; errors: FieldError[]; warnings: string[]; }
export interface PreviewResult { summary: string; changes: string[]; validation: ValidationResult; }
export interface ApplyResult { applied: boolean; message: string; data: Record<string, unknown>; }

export interface RouteRule {
  id: string;
  gateway: string;
  url_pattern: string;
  role: string;
  casdoor_user?: string | null;
  allow: boolean;
}

export interface RouteDefinition {
  pathPrefix: string;
  downstreamUri: string;
  serviceName?: string | null;
  requiredRole?: string | null;
}

// ── Delegation DTOs (mirror the admin-bff suspension + domainlock shapes) ─────
// The CLOSED access-role vocabulary the AdminController @Pattern-validates for
// suspensions (matches the DB ck_access_suspension_role CHECK). NOT widened.
export type AccessRole = 'ROLE_MATRIX' | 'ROLE_MASTODON' | 'PROFILE';
// The SEPARATE closed vocabulary for the two ADDITIVE domain-lock MARKER roles
// (matches the DB ck_domain_lock_role CHECK). Distinct from AccessRole above.
export type DomainLockRole = 'ROLE_MATRIX_DOMAINLOCKED' | 'ROLE_MASTODON_DOMAINLOCKED';

/** Optional POST body for a suspension. null/absent ttlSeconds = PERMANENT ban. */
export interface SuspensionBody { ttlSeconds?: number | null; reason?: string | null; }

/** One access_suspension row (admin-bff AccessSuspension record). state=active
 *  while the ban/suspension is in force; expiresAt null = permanent. */
export interface AccessSuspension {
  id: string;
  casdoorUser: string;
  localpart: string;
  role: AccessRole;
  state: 'active' | 'restored';
  suspendedAt: string;
  expiresAt?: string | null;
  restoreRole: boolean;
  propagationState: 'pending' | 'applied' | 'failed';
  reason?: string | null;
  setBy?: string | null;
}
export interface AccessRolesView { suspensions: AccessSuspension[]; }
export interface AccessRolesResult { suspended?: AccessSuspension; suspensions: AccessSuspension[]; }

/** One account_appeal row (admin-bff AccountAppeal record) — a curtailed principal's
 *  OWN structured appeal against their access_suspension PROFILE ban/suspension.
 *  DISTINCT from {@link ModerationRequest} (content moderation). */
export interface AccountAppeal {
  id: string;
  userSub: string;
  handle: string;
  domain: string;
  reason?: string | null;
  contactEmail?: string | null;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  submittedAt?: string | null;
  decidedAt?: string | null;
  decidedBy?: string | null;
}

/** One domain_lock row (admin-bff DomainLock record). An active row means the
 *  user is forced local-only (KEEPS the base ROLE_MATRIX/ROLE_MASTODON). */
export interface DomainLock {
  id: string;
  casdoorUser: string;
  localpart: string;
  role: DomainLockRole;
  state: 'active' | 'removed';
  createdAt: string;
  propagationState: 'pending' | 'applied' | 'failed' | 'degraded';
  reason?: string | null;
  setBy?: string | null;
}
export interface DomainLocksView { domainLocks: DomainLock[]; }
export interface DomainLockResult { locked?: DomainLock; domainLocks: DomainLock[]; }
// ── Test-Reports DTOs (mirror the admin-bff testreports package shapes) ──────
/** One durable test-architecture run row (admin-bff TestRun record). */
export interface TestRun {
  id: string;
  created_at: string;
  triggered_by: string;
  tier: 'LEAN' | 'HEAVY';
  trigger_source: 'ADMIN' | 'ARGOCD' | 'HEAVY_ATTACH';
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ERROR';
  commit_sha?: string | null;
  job_name?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  total_tests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration_ms?: number | null;
  report_ref?: string | null;
  error?: string | null;
}
/** A per-(suite,role) pass/fail/skip roll-up row (admin-bff TestRunResult). */
export interface TestRunResult {
  id: string;
  run_id: string;
  suite: string;
  role: string;
  state: 'running' | 'passed' | 'failed' | 'skipped';
  passed: number;
  failed: number;
  skipped: number;
  duration_ms?: number | null;
  updated_at?: string | null;
}
export interface TestReportsList { runs: TestRun[]; launchReal: boolean; }
export interface TestRunDetail { run: TestRun; results: TestRunResult[]; }
export interface StartTestRunRequest { tier?: 'LEAN' | 'HEAVY' | null; commitSha?: string | null; }
export interface StartTestRunResult { id: string; status: string; tier: string; }
/** One SSE progress event for a running test (admin-bff TestRunEvent record). */
export interface TestRunEvent {
  runId: string;
  suite?: string | null;
  role?: string | null;
  state: 'running' | 'passed' | 'failed' | 'skipped';
  passed: number;
  failed: number;
  skipped: number;
  percent: number;
  message: string;
  done: boolean;
  error?: string | null;
}

// ── Forum-admin DTOs (mirror the admin-bff forum package shapes) ─────────────
/** The ForumOutcome.asResponse() envelope: the returned payload merged with a
 *  `result` marker (`ok` | `stubbed` | `degraded:<reason>`). */
export type ForumEnvelope = Record<string, unknown> & { result?: string };
export interface ForumBanRequest { reason?: string | null; }
export interface ForumCategoryRequest { name: string; description?: string | null; parentId?: number | null; }
export interface ForumGroupRequest { group: 'ADMINISTRATORS' | 'GLOBAL_MODERATORS' | 'REGISTERED'; }
export interface ForumInstallRequest { name: string; }

// ── Appeals / moderation DTOs (mirror the admin-bff ModerationDecisionDto, which is
//    field-for-field the federation-api ModerationRequest row the decide-proxy returns) ──
/** The moderation `kind`: an instance-wide block, or a single user's removal. */
export type ModerationKind = 'instance-block' | 'user-removal';
/** The moderation lifecycle status. A mod `recommended` / `referred` it; an admin's
 *  decision flips it to `approved` | `denied` (the terminal, decided states). */
export type ModerationStatus = 'recommended' | 'referred' | 'approved' | 'denied';
/** One moderation_requests row returned by the decide-proxy (admin-bff
 *  ModerationDecisionDto). `adminDecider` is stamped from the deciding admin's JWT
 *  subject; `domain` is the brand the row belongs to (per-domain scoped downstream). */
export interface ModerationRequest {
  id: number;
  requester: string;
  kind: ModerationKind;
  target: string;
  reason?: string | null;
  status: ModerationStatus;
  modReferrer?: string | null;
  adminDecider?: string | null;
  ts?: string | null;
  domain?: string | null;
}

// ── Device-license registry DTOs (mirror the admin-bff device package shapes) ──
/** One SSH operate-license row: (operator × DEVICE|DOMAIN) → may-SSH, key-pinned. */
export interface DeviceSshLicense {
  id: string;
  operator: string;
  scope_type: 'DEVICE' | 'DOMAIN';
  device_id?: string | null;
  target_domain?: string | null;
  key_fingerprints: string[];
  state: 'active' | 'revoked';
  granted_by?: string | null;
  granted_at?: string | null;
}

// ── SSH key-ISSUANCE DTOs (mirror the admin-bff sshissue package shapes; Jackson records
//    serialise camelCase field names verbatim — no snake_case here, unlike DeviceRegistration
//    above, which mirrors an older hand-mapped DTO). ──
/** One `admin_ssh_issued_key` audit row — a MINTED credential (distinct from a license grant's
 *  pinned, operator-supplied fingerprint). No private-key field ever appears on the wire. */
export interface AdminSshIssuedKey {
  id: string;
  deviceId: string;
  licenseId: string;
  operator: string;
  keyType: string;
  publicKey: string;
  fingerprint: string;
  issuedBy: string;
  issuedAt: string;
  downloadedAt?: string | null;
  state: 'issued' | 'revoked';
  domain: string;
  revokedAt?: string | null;
  revokedBy?: string | null;
}

/** GET .../issued-keys response. `enabled` is the ships-dark signal (app.ssh-issue.enabled) —
 *  false means issue/download/revoke will 503; the console gates on this rather than parsing
 *  error bodies for a dark refusal. */
export interface AdminSshIssuedKeyList {
  deviceId: string;
  enabled: boolean;
  issuedKeys: AdminSshIssuedKey[];
}

/** The `issue` response — deliberately WITHOUT the private key (it is held server-side for one
 *  download). `deviceStale` warns the credential will not be enforceable until the node next
 *  phones home (advisory only). */
export interface AdminSshIssueResult {
  issuedKeyId: string;
  fingerprint: string;
  publicKey: string;
  deviceLastSeenAt: string | null;
  deviceStale: boolean;
}

/** The `revoke` response. A ships-dark refusal is a normal 200 here (not an error) — `dark:true`
 *  with `revoked:false`, distinct from an ordinary "already revoked" `revoked:false`. */
export interface AdminSshRevokeResult {
  revoked: boolean;
  id: string;
  dark?: boolean;
}

// ── Domain-registry DTOs (mirror the admin-bff domainregistry package shapes) ──
/** Body for POST /bff/admin/domains — registers one brand/domain in domain_registry.
 *  clusterDomain is REQUIRED + the UNIQUE natural key; the rest are optional brand
 *  descriptors; enabled omitted defaults to true server-side. caRef is a CA *reference*
 *  (Vault PKI path / secret name / "generate"), NEVER cert/key bytes. */
export interface CreateDomainRequest {
  clusterDomain: string;
  brand?: string | null;
  org?: string | null;
  caRef?: string | null;
  nsPrefix?: string | null;
  casdoorOrg?: string | null;
  meshTag?: string | null;
  enabled?: boolean | null;
}
/** One domain_registry row (admin-bff DomainResponse). A straight projection — no
 *  secrets (caRef is a reference, never key material). enabled is the desired-state
 *  on/off; a soft-disabled domain has enabled=false (there is no hard delete).
 *
 *  caProvisioned / appsetRegistered / lastReconciledGeneration are the band-190
 *  provisioning-status fields (admin-bff #118). They DEFAULT false/false/0 and ship
 *  dark — only the later generator domain-reconcile effector flips them — so this
 *  console can render the "registered but not yet provisioned" chip off this read. */
export interface DomainResponse {
  id: string;
  clusterDomain: string;
  brand: string;
  org: string;
  caRef: string;
  nsPrefix: string;
  casdoorOrg: string;
  meshTag: string;
  enabled: boolean;
  createdAt: string;
  createdBySubject: string;
  updatedAt: string;
  caProvisioned: boolean;
  appsetRegistered: boolean;
  lastReconciledGeneration: number;
}

/** A registered mesh node with its physical owner, domain residency + active licenses. */
export interface DeviceRegistration {
  id: string;
  machine_key_fp: string;
  hostname: string;
  tailnet_id?: string | null;
  image_type: 'primary' | 'mesh-extension' | 'client';
  owner_type: 'SUPERADMIN' | 'ADMIN';
  physical_owner: string;
  domain: string;
  mesh_id?: string | null;
  last_seen_at?: string | null;
  licenses: DeviceSshLicense[];
}

/** One row of the device PENDING pick-list (machine_key_fp AUTO-CAPTURE) — a
 *  headscale-enrolled node LEFT-JOINed with device_registry. The superadmin picks an
 *  `!registered` row and assigns owner_type/domain/image_type. `machineKeyFp` is an
 *  OPAQUE token captured from headscale — NEVER typed, edited, or normalised. */
export interface PendingNode {
  machineKeyFp: string;
  hostname?: string | null;
  user?: string | null;
  meshId?: string | null;
  registered: boolean;
  domain?: string | null;
  ownerType?: string | null;
}

/** Body for POST /bff/admin/device-licenses/register. `machineKeyFp` is the OPAQUE token
 *  from the pending list (passed through verbatim — the BFF re-validates it against
 *  headscale). The superadmin assigns the rest. */
export interface RegisterDeviceInput {
  machineKeyFp: string;
  hostname: string;
  ownerType: 'SUPERADMIN' | 'ADMIN';
  imageType: 'primary' | 'mesh-extension' | 'client';
  physicalOwner: string;
  domain: string;
  meshId: string;
  tailnetId?: string;
}

// ── OIDC provider default-role mapping DTOs ──────────────────────────────────
/** One row from oidc_provider_default_roles: a provider name → set of role names
 *  that new users receive when they first register via that identity provider. */
export interface OidcProviderMapping { provider: string; roles: string[]; }

// ── Node-storage DTOs (mirror the admin-bff storage package shapes, camelCase records) ──
/** A registered additional-storage pool PINNED to one node. reservedBytes is the operator's
 *  capacity claim (the node-agent df is authoritative); propagationState surfaces the
 *  reconcile/patch ACK; a node-pinned PV = NO HA (data loss on disk loss → scope to
 *  replaceable data). */
export interface StoragePool {
  id: string;
  deviceId: string;
  diskSerial: string;
  poolPath: string;
  reservedBytes: number;
  isExclusive: boolean;
  filesystem?: string | null;
  state: 'active' | 'detached';
  domain: string;
  propagationState: 'pending' | 'applied' | 'failed' | 'degraded';
  generation: number;
  createdBy: string;
  createdAt?: string | null;
}
/** A (pool × service) placement row. An active row pins the service to the pool's node. */
export interface ServiceAssignment {
  id: string;
  poolId: string;
  serviceName: string;
  pvcName: string;
  requestedBytes: number;
  state: 'active' | 'revoked';
  assignedBy: string;
  assignedAt?: string | null;
  domain: string;
  propagationState: 'pending' | 'applied' | 'failed' | 'degraded';
  generation: number;
}
/** Body for POST .../{deviceId}/pools (attach). exclusive defaults true for video on the
 *  UI; reservedBytes must be > 0. */
export interface AttachPoolBody {
  diskSerial: string;
  poolPath: string;
  reservedBytes: number;
  exclusive: boolean;
  filesystem?: string | null;
}
/** Body for POST .../pools/{poolId}/assignments (assign). requestedBytes must be > 0 and
 *  not over-subscribe the pool's reservedBytes. */
export interface AssignServiceBody {
  serviceName: string;
  pvcName: string;
  requestedBytes: number;
}

// ── Node-radio DTOs (mirror the admin-bff radio package shapes, camelCase records) ──
/** A Meshtastic LoRa radio attachment PINNED to one node. transport picks the column set:
 *  serial → serialPath; tcp → host+port (Meshtastic TCP API, default 4403); mqtt →
 *  host+port+topicRoot+channelName (+ optional !hex8 gatewayNodeId — a WAN/LoRaWAN-gateway
 *  mesh via a Meshtastic MQTT broker, default 1883). propagationState surfaces the on-node
 *  meshbridge reconcile ACK. */
export interface NodeRadio {
  id: string;
  deviceId: string;
  transport: 'serial' | 'tcp' | 'mqtt';
  serialPath?: string | null;
  host?: string | null;
  port?: number | null;
  topicRoot?: string | null;
  channelName?: string | null;
  gatewayNodeId?: string | null;
  radioId: string;
  meshChannel: number;
  state: 'active' | 'detached';
  domain: string;
  propagationState: 'pending' | 'applied' | 'failed' | 'degraded';
  generation: number;
  createdBy: string;
  createdAt?: string | null;
}
/** Body for POST .../{deviceId}/radios (attach). Exactly the columns of the chosen
 *  transport must be present (a mixed shape is a BFF 422); meshChannel is 0..7. */
export interface AttachRadioBody {
  transport: 'serial' | 'tcp' | 'mqtt';
  serialPath?: string | null;
  host?: string | null;
  port?: number | null;
  topicRoot?: string | null;
  channelName?: string | null;
  gatewayNodeId?: string | null;
  radioId: string;
  meshChannel: number;
}

// ── Egress-VPN DTOs (mirror the admin-bff egressvpn package shapes) ────────────
/** One imported provider VPN config (vpn_config). Carries a secret_ref + metadata
 *  ONLY — never the .conf bytes / private key. */
export interface VpnConfigRow {
  id: string;
  domain: string;
  name: string;
  kind: 'wireguard' | 'openvpn';
  provider?: string | null;
  endpoint?: string | null;
  secretRef?: string | null;
  state: 'active' | 'revoked';
  createdBy?: string | null;
  createdAt?: string | null;
  propagationState?: string | null;
  generation?: number;
}
/** One (config × NODE|DOMAIN) assignment (vpn_node_assignment) — which public pods
 *  egress via the VPN; optional per-service serviceSlug. */
export interface VpnNodeAssignmentRow {
  id: string;
  configId: string;
  scopeType: 'DEVICE' | 'DOMAIN';
  targetNodeId?: string | null;
  targetDomain?: string | null;
  serviceSlug?: string | null;
  state: 'active' | 'revoked';
  assignedBy?: string | null;
  domain: string;
  propagationState?: string | null;
}
/** Body for POST /bff/admin/egress-vpn/configs — import a provider VPN config. The
 *  raw .conf/.ovpn text is sent for parse-validation; the BFF stores only a
 *  secret_ref + parsed metadata (never the private key). */
export interface ImportVpnConfigRequest {
  domain: string;
  name: string;
  provider?: string;
  config: string;
  secretRef?: string;
}

// ── Games app-store DTOs ──────────────────────────────────────────────────────

/** An offered + enabled catalog server for the caller's domain (admin-bff
 *  GameCatalogEntryResponse, surfaced via the offer). */
export interface GameOffer {
  slug: string;
  displayName: string;
  licenseSpdx: string;
  protocol: string;
  maxInstances: number;
  summary?: string | null;
}

/** Body for POST /bff/games-services/instances. domain + owner come from the JWT. */
export interface CreateGameInstanceRequest {
  slug: string;
  name: string;
  ttlSeconds?: number | null;
}

/** One game_instance row (admin-bff GameInstanceResponse). */
export interface GameInstance {
  id: string;
  domain: string;
  slug: string;
  name: string;
  state: 'pending' | 'active' | 'suspended' | 'terminated';
  propagationState: string;
  ownerSubject: string;
  createdAt: string;
  endingAt?: string | null;
  namespace?: string | null;
  nodePort?: number | null;
  consolePath?: string | null;
  updatedAt: string;
}

// ── Platform-capability detection DTO (GET /bff/admin/platform-capabilities) ──
/** Which FOUNDATIONAL infra is present on this deployment, so the UI can degrade its
 *  infra-dependent consoles gracefully. The four `*Present`/`imagesGenerated` fields are
 *  read-only, fail-safe RUNTIME probes (false when absent OR not detectable); the
 *  `*Enabled` fields mirror BFF config switches; `warnings` explains anything that could
 *  not be detected. The BFF is the authoritative action gate — these flags only change
 *  what the UI SHOWS. */
export interface PlatformCapabilities {
  argocdPresent: boolean;
  veleroPresent: boolean;
  buildNodePresent: boolean;
  imagesGenerated: boolean;
  anubisEnabled: boolean;
  forumEnabled: boolean;
  testLaunchEnabled: boolean;
  casdoorAdminEnabled: boolean;
  homeserverAdminEnabled: boolean;
  warnings: string[];
}
/** The fail-safe envelope used when the capability endpoint is unreachable / non-OK:
 *  every capability ABSENT with a warning, so the UI degrades rather than errors. */
export const PLATFORM_CAPABILITIES_ABSENT: PlatformCapabilities = {
  argocdPresent: false,
  veleroPresent: false,
  buildNodePresent: false,
  imagesGenerated: false,
  anubisEnabled: false,
  forumEnabled: false,
  testLaunchEnabled: false,
  casdoorAdminEnabled: false,
  homeserverAdminEnabled: false,
  warnings: ['Platform capabilities could not be read from the admin BFF; '
    + 'infra-dependent features are shown as unavailable.'],
};

// ── Image-generation console DTOs (admin-bff imagegen/ImageBuildController) ──
/** The closed image-type vocabulary (matches device_registry.image_type / the
 *  ImageBuild record + TriggerImageBuildRequest @Pattern). */
export type ImageType = 'primary' | 'mesh-extension' | 'client';
/** The 070 lifecycle status vocabulary an ImageBuild row reports. */
export type ImageBuildStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ERROR';

/** Body for POST /bff/admin/image-builds. There is intentionally NO domain field:
 *  the BFF stamps domain from the validated issuer (a client cannot pick a tenant). */
export interface TriggerImageBuildRequest {
  targetUser: string;
  imageType: ImageType;
  hardwareClass?: string | null;
  sshKeysAllowed?: boolean | null;
}

/** One image_build row (admin-bff ImageBuild record, field names verbatim). */
export interface ImageBuild {
  id: string;
  createdAt: string;
  requestedBy: string;
  targetUser: string;
  domain: string;
  imageType: ImageType;
  hardwareClass: string | null;
  deviceId: string | null;
  status: ImageBuildStatus;
  sshKeysAllowed: boolean;
  jobName: string | null;
  imageRef: string | null;
  keysRef: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

/** GET /bff/admin/image-builds → { builds:[ImageBuild], launchReal }. launchReal is
 *  false when imagegen.launch.enabled=false (ships dark — a request is recorded QUEUED
 *  but no real generator Job runs). */
export interface ImageBuildList { builds: ImageBuild[]; launchReal: boolean; }

/** The POST trigger result (the controller's projected map). */
export interface ImageBuildTriggerResult {
  id: string;
  status: ImageBuildStatus;
  imageType: ImageType;
  domain: string;
  sshKeysAllowed: boolean;
}

/** One SSE progress event for a running image build (admin-bff ImageBuildEvent record). */
export interface ImageBuildEvent {
  buildId: string;
  phase: string;
  percent: number;
  message: string | null;
  imageRef: string | null;
  keysRef: string | null;
  done: boolean;
  error: string | null;
}

// ── Worklist batch DTOs (admin-bff imagegen batch trigger, item 1) ────────────
/** The six ENUMERATED generator platforms (worklist WorklistEntry.platform), which REPLACE
 *  the old free-text hardware class. Mirrors BatchImageSpec.hardwareClass @Pattern + the
 *  worklist.v1 schema enum — a build is rejected 400 for anything off this list. */
export const IMAGE_PLATFORMS = ['x86', 'rpi5', 'frite', 'jetson', 'orangepi5', 'orangepizero2'] as const;
export type ImagePlatform = (typeof IMAGE_PLATFORMS)[number];

/** One entry of a worklist batch — a single image (one per role × platform). Mirrors the
 *  admin-bff {@code BatchImageSpec} record VERBATIM. There is intentionally NO domain field:
 *  the BFF derives every build's tenancy server-side (a caller can never pick a tenant). The
 *  optional {@code imageSpec} is the per-image CONTENT (the IMAGE_SPEC_JSON channel, item 1b);
 *  {@code null}/absent keeps the legacy 6-env path. It is deep-validated (no secrets, valid
 *  atoms/domain names) by the BFF's fail-closed worklist.v1 validator BEFORE any write. */
export interface BatchImageSpec {
  targetUser: string;
  imageType: ImageType;
  /** The ENUMERATED platform (replaces free-text hardwareClass). */
  hardwareClass: ImagePlatform;
  sshKeysAllowed?: boolean | null;
  imageSpec?: Record<string, unknown> | null;
}

/** Body for {@code POST /bff/admin/image-builds/batch} — the frozen worklist v1 ENVELOPE
 *  wrapped with a bounded-concurrency knob. Mirrors admin-bff {@code BatchTriggerImageBuildRequest}:
 *  {@code schema} is the mandatory discriminator, {@code base} is the shared ImageConfig CONTENT
 *  (domains/users; brand/org/superdomain are server-derived, never sent), {@code entries} is 1..16
 *  {@link BatchImageSpec}s (ONE step-up authorises the whole batch, so the cap is a security
 *  invariant), {@code maxConcurrent} bounds launch fan-out (default 1 = sequential). */
export interface WorklistEnvelope {
  schema: 'snapdragon-worklist/v1';
  base?: Record<string, unknown> | null;
  entries: BatchImageSpec[];
  maxConcurrent?: number | null;
}

/** One build of a batch result — identical shape to the single trigger's projection. */
export interface ImageBuildBatchBuild {
  id: string;
  status: ImageBuildStatus;
  imageType: ImageType;
  domain: string;
  sshKeysAllowed: boolean;
}

/** {@code POST /bff/admin/image-builds/batch} → {@code {batchId, builds:[…]}}. */
export interface ImageBuildBatchResult {
  batchId: string;
  builds: ImageBuildBatchBuild[];
}

// ── Image-build package/image catalog DTOs (admin-bff imagegen/ImageCatalogController) ──
// The BFF serves the generator's `packages-catalog.json` + `image-catalog.json` VERBATIM
// (redesign/docs/catalog/*.json). These interfaces pin ONLY the load-bearing shape the
// package-selection modal reads; the JSON is otherwise treated as opaque pass-through.

/** One adhoc add-on option (packages-catalog.json `adhoc_adds[key]`): a human label + the
 *  Portage atoms it pulls in (e.g. tor → net-vpn/tor). A WorklistEntry has no per-option flag
 *  channel, so an enabled option's atoms fold into the entry's `packages_add`. */
export interface PackageAdhocAdd { atoms: string[]; label: string; }

/** One titled package section within a platform group: a section title + its Portage atoms. */
export interface PackageSection { title: string; atoms: string[]; }

/** One platform package group (the base list, a desktop list, a GPU list, …): its builder
 *  GATE name + the sections it holds. `gate === 'base'` is the always-on ESSENTIAL FLOOR —
 *  the only tier the group grammar declares. Catalogs that additionally carry the top-level
 *  `roles` tier maps ({@link PackageRoleTiers}) refine the split per role; without them the
 *  rest of the tier split is resolved LIVE by the builder at image-build time, not here. */
export interface PackageGroup { gate: string; sections: PackageSection[]; }

/** One (platform, role) tier cell of packages-catalog.json `roles` — the generator's
 *  package_catalog.tiers() baseline for a DEFAULT-OPTIONS image of that role. `essential` is
 *  the locked floor (base list + role payloads, e.g. a node role's k8s atoms); `essential` ∪
 *  `removable` is the builder's default install set (un-ticking a removable atom emits a
 *  `packages_drop`); `available` is the rest of the platform catalog (ticking one emits a
 *  `packages_add`). The tiers are sorted, duplicate-free and pairwise disjoint (enforced by
 *  the generator's validate_roles_tiers()). Adhoc-option atoms are NOT in the baseline — the
 *  UI layers an enabled option's atoms client-side as additional locked floor. */
export interface PackageRoleTiers { essential: string[]; removable: string[]; available: string[]; }

/** packages-catalog.json — the flat adhoc add-on options + the per-platform package tree
 *  (platform → group-key → {@link PackageGroup}), plus (on newer catalogs) the per-platform
 *  role→tier baselines (`roles[platform][role]` → {@link PackageRoleTiers}; role ids are the
 *  Studio ROLE_CHOICES ids — the same grammar image-catalog.json serves). `roles` is OPTIONAL:
 *  a legacy catalog without it keeps the base-gate-floor modal behaviour unchanged. */
export interface PackageCatalog {
  adhoc_adds: Record<string, PackageAdhocAdd>;
  platforms: Record<string, Record<string, PackageGroup>>;
  roles?: Record<string, Record<string, PackageRoleTiers>>;
}

/** One image-catalog role: a role × its per-platform axes, plus its class + label. */
export interface ImageCatalogRole {
  role: string;
  label: string;
  image_class: 'desktop' | 'node';
  platforms: { platform: string; axes: Record<string, string[]> }[];
}

/** image-catalog.json — the platform labels, the desktop/node `role_class` split, and the
 *  per-mode (cloud | mesh | standalone) role list. Consumed by the wizard's gating; carried
 *  here so the single catalog fetch feeds both surfaces. */
export interface ImageCatalog {
  platform_labels: Record<string, string>;
  role_class: { desktop: string[]; node: string[] };
  roles: Record<string, ImageCatalogRole[]>;
}

/** GET /bff/admin/image-builds/catalog → {@code { packages, images }} (verbatim pass-through
 *  of the generator's packages-catalog.json + image-catalog.json). */
export interface ImageBuildCatalog { packages: PackageCatalog; images: ImageCatalog; }

/** A per-image package selection the {@code PackageCatalogModalComponent} emits for the wizard
 *  to fold into a worklist entry's per-image CONTENT (`packages_add` / `packages_drop`,
 *  space-joined Portage atoms; see worklist.v1 worklistEntry). `add`/`drop` are the
 *  load-bearing WIRE fields; `options` carries the enabled adhoc-add KEYS for round-trip +
 *  display. On a LEGACY catalog (no `roles` tier maps) an enabled option's atoms are folded
 *  into `add` (a WorklistEntry has no per-option flag); on a role-tiered catalog they are
 *  part of the LOCKED floor and — like the essential floor — NEVER emitted (the generator's
 *  tiers() installs them for the enabled option). */
export interface PackageSelection { add: string[]; drop: string[]; options: string[]; }

// ── Anubis bot-challenge sidecar DTOs ────────────────────────────────────────
/** Status + configured settings from GET /bff/admin/anubis/status. Settings come from
 *  the BFF's own config (env vars), not from the Anubis runtime — mutation requires an
 *  ArgoCD deployment update. {@code enabled=false} means the sidecar is not configured. */
export interface AnubisStatus {
  enabled: boolean;
  managementUrl: string;
  difficulty: number;
  health: string;
  reachable: boolean;
}
/** One parsed Prometheus metric line from GET /bff/admin/anubis/metrics. */
export interface AnubisMetric { name: string; labels?: string; value: number; }
/** Full response from GET /bff/admin/anubis/metrics. */
export interface AnubisMetricsResponse { enabled: boolean; raw: string; metrics: AnubisMetric[]; }

// ── Workload Console DTOs (mirror the admin-bff workload package projections) ─────
/** The capability probe response — present iff the caller has a live grant/role. */
export interface WorkloadCapability { enabled: boolean; readOnly: boolean; domain: string; }
export interface WorkloadContainer {
  name: string; image: string; ready: boolean; restarts: number; state: string;
}
/** A projected pod summary (NO env / annotations / managedFields / secrets). */
export interface WorkloadPod {
  namespace: string; name: string; workload: string; phase: string; ready: boolean;
  restarts: number; node: string; startedAt?: string | null; containers: WorkloadContainer[];
}
export interface WorkloadPodInspect {
  namespace: string; name: string; workload: string; phase: string; node: string;
  serviceAccount: string; startedAt?: string | null; containers: WorkloadContainer[];
  labels: Record<string, string>; ownerKind?: string | null; ownerName?: string | null;
}
export interface WorkloadMetric { namespace: string; name: string; cpuMillicores: string; memoryBytes: string; }
export interface WorkloadEvent {
  namespace: string; type: string; reason: string; object: string; message: string;
  lastSeen?: string | null; count: number;
}
export interface WorkloadVolume {
  namespace: string; name: string; phase: string; capacity: string; storageClass: string; accessModes: string[];
}
export interface WorkloadNetwork { namespace: string; kind: string; name: string; summary: string; }
/** A non-stream redacted log read. */
export interface WorkloadLogResult { pod: string; container?: string | null; redacted: boolean; log: string; }
/** One redacted live log line (SSE). */
export interface WorkloadLogLine { container: string; line: string; ts?: string | null; }
/** A short-TTL DANGEROUS-tier step-up token. */
export interface WorkloadStepUp { stepUpToken: string; ttlMinutes: number; }
/** A GitOps-PR lifecycle intent ("pending sync"). */
export interface WorkloadIntent {
  id: string; kind: string; namespace: string; workload: string; imageRef?: string | null;
  replicas?: number | null; requestedBy: string; requestedAt?: string | null; domain: string;
  propagationState: string; generation: number;
}
/** Body for a GitOps lifecycle verb (scale/deploy/remove/export-manifest). */
export interface WorkloadLifecycleRequest { replicas?: number | null; imageRef?: string | null; confirm?: string | null; }
/** A READ_ONLY grant lease row. */
export interface WorkloadGrant {
  id: string; grantee: string; targetDomain: string; accessLevel: string; logAccess: boolean;
  state: string; grantedBy: string; grantedAt?: string | null; expiresAt?: string | null;
  revokedAt?: string | null; revokedBy?: string | null; domain: string; propagationState: string; generation: number;
}
/** Body for POST /bff/superadmin/workloads/grants — issue a READ_ONLY grant lease. */
export interface WorkloadGrantRequest { grantee: string; targetDomain: string; logAccess: boolean; ttlHours?: number | null; }
/** A master kill-switch config row. */
export interface WorkloadConfigRow {
  id: string; domain: string; adminEnabled: boolean; dangerousTierEnabled: boolean;
  updatedBy?: string | null; updatedAt?: string | null; generation: number;
}

// ── DESKTOP APP GOVERNANCE DTOs (mirror the admin-bff desktop package records) ──
/** The catalog entry source — Flatpak (default) over the OCI registry, or raw OCI. */
export type DesktopSource = 'FLATPAK' | 'OCI';
/** The terminal statuses an admin may decide an install request into. */
export type DesktopRequestDecision = 'approved' | 'denied' | 'installed';

/** One {@code desktop_app_catalog} row — an app ref in a brand's Plasma Discover
 *  allowlist. The store is DEFAULT-NONE: {@code enabled} is false on add, so a row only
 *  appears in Discover after a separate enable. {@code domain} is the brand (validated
 *  issuer; the read scope). */
export interface DesktopCatalogEntry {
  id: string;
  appRef: string;
  displayName: string;
  source: string;
  enabled: boolean;
  addedBy: string;
  domain: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** One {@code desktop_sudo_grant} row — the per-(domain, subject, device) SSO-enforced sudo
 *  grant. DEFAULT-NONE: an ACTIVE grant is the only thing that confers sudo (emitted as a
 *  revocable SSO claim); revoke is a CAS active->revoked (never deleted = audit). */
export interface DesktopSudoGrant {
  id: string;
  subject: string;
  deviceId: string;
  state: string;
  grantedBy?: string | null;
  grantedAt?: string | null;
  revokedAt?: string | null;
  revokedBy?: string | null;
  domain: string;
  propagationState: string;
  generation: number;
}

/** One {@code desktop_install_request} row — a non-sudo user's request that an admin
 *  allow/install an app on their device. {@code requester} == JWT subject; {@code domain}
 *  stamped from the issuer; an admin decision stamps {@code decidedBy}/{@code decidedAt}. */
export interface DesktopInstallRequest {
  id: string;
  requester: string;
  appRef: string;
  deviceId: string;
  status: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
  domain: string;
  createdAt?: string | null;
}

/** The descriptor returned by POST /bff/admin/desktop/ssh-terminal/sessions. The admin-bff
 *  SCAFFOLD ships dark: the authorization is REAL (403 on deny) but the response carries
 *  {@code dark:true} + a note instead of opening a live TTY. When the live WS bridge lands,
 *  the descriptor will carry the WebSocket handshake params instead and {@code dark} flips
 *  false. */
export interface DesktopSshSession {
  deviceId: string;
  dark: boolean;
  /** The live WS handshake path the component opens once {@code dark} is false:
   *  {@code /bff/admin/device-terminal/{deviceId}} (deviceId in the PATH — no query token). */
  wsPath?: string | null;
  /** Always true for this surface — the live WS REQUIRES a step-up token (carried via the
   *  Sec-WebSocket-Protocol subprotocol, never a query param). */
  stepUpRequired?: boolean;
  note?: string | null;
}

/** A short-TTL, single-use desktop step-up token minted by POST /bff/admin/desktop/step-up.
 *  Shape mirrors {@link WorkloadStepUp}; carried in the shared X-Device-Terminal-StepUp header
 *  (remote-install) or the WS subprotocol (live terminal). */
export interface DesktopStepUp { stepUpToken: string; ttlMinutes: number; }

/** One {@code device_ssh_dial} row — the per-device BFF->device SSH trust. Only NON-SECRET
 *  fields are projected: fingerprints + refs, never the dial private key. {@code status} is
 *  PENDING (created, awaiting a deliberate SUPERADMIN activate), ACTIVE, or REVOKED. A row with
 *  no {@code hostKeyFp} pin cannot be activated (the BFF returns 422). */
export interface DeviceSshDial {
  deviceId: string;
  dialUser: string;
  hostKeyFp?: string | null;
  dialPubFp?: string | null;
  vaultRef?: string | null;
  k8sSecretName?: string | null;
  status: string;
  generation: number;
}
