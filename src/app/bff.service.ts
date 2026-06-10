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
