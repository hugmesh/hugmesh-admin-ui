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
export interface FieldDef { key: string; label: string; type: string; required: boolean; placeholder: string; }
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
