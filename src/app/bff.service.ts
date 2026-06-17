import { Injectable, inject } from '@angular/core';
import { SessionService } from './session.service';

const CFG = {
  bff: (globalThis as any).__SNAP_BFF_URL__ ?? '',
  uptrace: (globalThis as any).__SNAP_UPTRACE_URL__ ?? 'https://uptrace.snapdragon.systems',
};

/**
 * Talks to the Spring admin BFF (backend namespace, behind the gateway), which
 * brokers to Casdoor through the snapdragon-pki gateway. As a federated remote
 * the Admin console only needs the admin-scoped endpoints (allowlist, usage,
 * namespace access); the registration / login / Matrix-Mastodon service-token
 * broker flow lives in the login remote, which writes the shared `snap.session`
 * (incl. roles + bffToken) that this remote reads via SessionService.
 */
@Injectable({ providedIn: 'root' })
export class BffService {
  private readonly session = inject(SessionService);

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
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/access-roles`, { headers: { authorization: `Bearer ${t}` } });
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
    const t = this.session.session()?.bffToken;
    const init: RequestInit = { method, headers: { authorization: `Bearer ${t}` } };
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
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/domain-lock`, { headers: { authorization: `Bearer ${t}` } });
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
    const t = this.session.session()?.bffToken;
    const init: RequestInit = { method, headers: { authorization: `Bearer ${t}` } };
    if (method === 'POST' && reason) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
      init.body = JSON.stringify({ reason });
    }
    const r = await fetch(
      `${CFG.bff}/bff/admin/domain-lock/${encodeURIComponent(role)}/${encodeURIComponent(user)}`, init);
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }

  /** Extract the BFF's {error} message (string or object) for a thrown rejection. */
  private async errorOf(r: Response): Promise<string> {
    const err = (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`;
    return typeof err === 'string' ? err : JSON.stringify(err);
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
    const t = this.session.session()?.bffToken;
    const r = await fetch(
      `${CFG.bff}/bff/admin/moderation/${encodeURIComponent(String(id))}/decide?approve=${approve}`,
      { method: 'POST', headers: { authorization: `Bearer ${t}` } });
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
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

  // Gateway route DEFINITIONS — admin-editable url_registry rows the gateway turns
  // into live Spring Cloud Gateway routes (path_prefix -> downstream_uri). Distinct
  // from route-access above (which is role→URL allow/deny). The BFF wraps the list
  // as { routes: [...] }, same convention as route-access's { rules: [...] }.
  async routeDefinitions(): Promise<RouteDefinition[]> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/routes`, { headers: { authorization: `Bearer ${t}` } });
    return r.ok ? (await r.json()).routes : [];
  }
  async upsertRouteDefinition(def: RouteDefinition): Promise<RouteDefinition[]> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/routes`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify(def),
    });
    return r.ok ? (await r.json()).routes : [];
  }
  async removeRouteDefinition(pathPrefix: string): Promise<RouteDefinition[]> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/routes/${encodeURIComponent(pathPrefix)}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${t}` },
    });
    return r.ok ? (await r.json()).routes : [];
  }

  /** Latest delivered ISO download links (from the CI pipeline). */
  async isos(): Promise<{ name: string; url: string }[]> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/isos`, { headers: { authorization: `Bearer ${t}` } });
    return r.ok ? (await r.json()).isos : [];
  }

  // ── ArgoCD dashboard (role-secured proxy in the admin BFF) ───────────
  // The BFF is the single contract; ArgoCD's own URL/token never leave the
  // cluster. Reads reflect LIVE ArgoCD state. The one mutating call (sync) needs
  // a typed confirmation token equal to the app name. When ArgoCD is not wired
  // the BFF returns 503 — surfaced here as the {argocdEnabled:false} state so the
  // dashboard can show an honest "ArgoCD not connected" message.
  async argoApplications(): Promise<ArgoAppList> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/argocd/applications`, { headers: { authorization: `Bearer ${t}` } });
    if (r.status === 503) return { items: [], unavailable: true };
    return r.ok ? { items: (await r.json()).items ?? [], unavailable: false } : { items: [], unavailable: false };
  }
  async argoApplication(name: string): Promise<ArgoAppDetail | null> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/argocd/applications/${encodeURIComponent(name)}`, {
      headers: { authorization: `Bearer ${t}` },
    });
    return r.ok ? r.json() : null;
  }
  /** Trigger a sync — the BFF requires {confirm: name} (typed confirmation). */
  async argoSync(name: string): Promise<ArgoSyncResult | null> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/argocd/applications/${encodeURIComponent(name)}/sync`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify({ confirm: name }),
    });
    return r.ok ? r.json() : null;
  }

  // ── Unified admin-task wizard (validate → preview → apply per step) ──
  async adminTasks(): Promise<TaskDef[]> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/tasks`, { headers: { authorization: `Bearer ${t}` } });
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
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/tasks/${taskId}/steps/${stepId}/${phase}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
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
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/backups`, { headers: { authorization: `Bearer ${t}` } });
    return r.ok ? (await r.json()).backups : [];
  }

  /** Connected/mountable USB devices offered as targets/sources (+ backups on them). */
  async usbDevices(): Promise<UsbDevice[]> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/usb-devices`, { headers: { authorization: `Bearer ${t}` } });
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
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/test-reports`, { headers: { authorization: `Bearer ${t}` } });
    return r.ok ? r.json() : { runs: [], launchReal: false };
  }

  /** One run's summary + per-(suite,role) matrix (the detail view). */
  async testReportDetail(id: string): Promise<TestRunDetail | null> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/test-reports/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${t}` },
    });
    return r.ok ? r.json() : null;
  }

  /** Trigger a run on-demand. Returns the new run id (or throws the BFF {error}). */
  async runTestReport(req: StartTestRunRequest): Promise<StartTestRunResult> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/test-reports/run`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify(req),
    });
    if (r.ok) return r.json();
    const err = (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`;
    throw new Error(err);
  }

  /**
   * Download a run's stored report bundle (re-scrubbed tar.gz). Uses a bearer
   * fetch (NOT a plain <a href>) so the Casdoor token is sent, then hands the
   * Blob to a synthetic, object-URL-backed anchor so the browser saves the file.
   * Returns false (no throw) when the run has no bundle / the request is denied,
   * so the caller can surface an honest "no report available" message.
   */
  async downloadTestReport(id: string): Promise<boolean> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/test-reports/${encodeURIComponent(id)}/download`, {
      headers: { authorization: `Bearer ${t}`, accept: 'application/gzip' },
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
   * {@link streamJobEvents} this uses a bearer fetch + ReadableStream reader (NOT
   * raw EventSource, which cannot send the Casdoor Bearer). Parses each SSE
   * `data:` line as a TestRunEvent and invokes `onEvent`; resolves when the stream
   * completes. `signal` lets the caller abort on component teardown.
   */
  async streamTestRunEvents(runId: string, onEvent: (e: TestRunEvent) => void,
                            signal?: AbortSignal): Promise<void> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/test-reports/${encodeURIComponent(runId)}/events`, {
      headers: { authorization: `Bearer ${t}`, accept: 'text/event-stream' }, signal,
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
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/forum${path}`, { headers: { authorization: `Bearer ${t}` } });
    return r.ok ? r.json() : { result: `degraded:HTTP ${r.status}` };
  }
  private async forumSend(method: string, path: string, body?: unknown): Promise<ForumEnvelope> {
    const t = this.session.session()?.bffToken;
    const init: RequestInit = { method, headers: { authorization: `Bearer ${t}` } };
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
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/device-licenses`, { headers: { authorization: `Bearer ${t}` } });
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
    const t = this.session.session()?.bffToken;
    const init: RequestInit = { method, headers: { authorization: `Bearer ${t}` } };
    if (body !== undefined) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const r = await fetch(`${CFG.bff}${path}`, init);
    if (r.ok) return (await r.json()).devices ?? [];
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
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/egress-vpn`, { headers: { authorization: `Bearer ${t}` } });
    if (!r.ok) return { configs: [], assignments: [] };
    const body = await r.json();
    return { configs: body.configs ?? [], assignments: body.assignments ?? [] };
  }

  /** Import a provider VPN config. The .conf/.ovpn text is parse-validated by the BFF
   *  (a malformed config → 422 {error}); only a secret_ref + metadata are persisted. */
  async importVpnConfig(req: ImportVpnConfigRequest): Promise<VpnConfigRow> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/egress-vpn/configs`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
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
    const t = this.session.session()?.bffToken;
    const body = serviceSlug && serviceSlug.trim() ? { serviceSlug: serviceSlug.trim() } : {};
    const r = await fetch(`${CFG.bff}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify(body),
    });
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }

  private async vpnRevoke(path: string): Promise<number> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}${path}`, { method: 'DELETE', headers: { authorization: `Bearer ${t}` } });
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
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/domains`, { headers: { authorization: `Bearer ${t}` } });
    return r.ok ? r.json() : [];
  }

  /** Register a new domain. Returns the persisted row, or throws the BFF {error}
   *  (a duplicate cluster_domain → 409; a malformed body → 400). */
  async createDomain(req: CreateDomainRequest): Promise<DomainResponse> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/domains`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify(req),
    });
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }

  private async postJob(path: string, body: unknown): Promise<StartJobResult> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify(body),
    });
    if (r.ok) return r.json();
    const err = (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`;
    throw new Error(err);
  }

  /**
   * Subscribe to the SSE progress stream for a backup OR restore job id. Uses
   * fetch (not EventSource) so the Casdoor bearer token can be sent. Parses the
   * SSE `data:` JobEvent lines and invokes `onEvent` for each; resolves when the
   * stream completes. `signal` lets the caller abort (component teardown).
   */
  async streamJobEvents(jobId: string, onEvent: (e: BackupJobEvent) => void,
                        signal?: AbortSignal): Promise<void> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/backups/${encodeURIComponent(jobId)}/events`, {
      headers: { authorization: `Bearer ${t}`, accept: 'text/event-stream' }, signal,
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
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/oidc-providers/roles`, { headers: { authorization: `Bearer ${t}` } });
    if (!r.ok) return [];
    const body: { providers: OidcProviderMapping[] } = await r.json();
    return body.providers ?? [];
  }

  async setOidcProviderRoles(provider: string, roles: string[]): Promise<void> {
    const t = this.session.session()?.bffToken;
    await fetch(`${CFG.bff}/bff/admin/oidc-providers/${encodeURIComponent(provider)}/roles`, {
      method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify({ roles }),
    });
  }

  async clearOidcProviderRoles(provider: string): Promise<void> {
    const t = this.session.session()?.bffToken;
    await fetch(`${CFG.bff}/bff/admin/oidc-providers/${encodeURIComponent(provider)}/roles`, {
      method: 'DELETE', headers: { authorization: `Bearer ${t}` },
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
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/admin/device-storage-pools`, {
      headers: { authorization: `Bearer ${t}` },
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
    const t = this.session.session()?.bffToken;
    const init: RequestInit = { method, headers: { authorization: `Bearer ${t}` } };
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
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/games-services/catalog`, { headers: { authorization: `Bearer ${t}` } });
    return r.ok ? r.json() : [];
  }

  /** The caller's own-brand instances. */
  async gamesInstances(): Promise<GameInstance[]> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/games-services/instances`, { headers: { authorization: `Bearer ${t}` } });
    return r.ok ? r.json() : [];
  }

  /** Request a new instance. Returns the persisted row, or throws the BFF {error}
   *  (the creation gate → 403; a duplicate name → 409). */
  async createGameInstance(req: CreateGameInstanceRequest): Promise<GameInstance> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(`${CFG.bff}/bff/games-services/instances`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify(req),
    });
    if (r.ok) return r.json();
    throw new Error(await this.errorOf(r));
  }

  /** Run/stop transition (suspend | resume | terminate). Returns the updated row. */
  async gameInstanceAction(id: string, action: 'suspend' | 'resume' | 'terminate'): Promise<GameInstance> {
    const t = this.session.session()?.bffToken;
    const r = await fetch(
      `${CFG.bff}/bff/games-services/instances/${encodeURIComponent(id)}/${action}`,
      { method: 'POST', headers: { authorization: `Bearer ${t}` } });
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
 *  on/off; a soft-disabled domain has enabled=false (there is no hard delete). */
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
