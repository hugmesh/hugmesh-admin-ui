import { Injectable, InjectionToken, inject } from '@angular/core';

/** Base URL of the admin BFF. The fe-gateway proxies same-origin /bff/** to
 *  snapdragon-admin-bff-api, so the default is the empty string = same origin.
 *  `globalThis.__SNAP_BFF_URL__` lets the host override the target at runtime
 *  (mirrors cloud-backups.service.ts + the other remotes' __SNAP_*_URL__ globals). */
export const BACKING_SERVICES_BASE_URL = new InjectionToken<string>('BACKING_SERVICES_BASE_URL', {
  factory: () => (globalThis as any).__SNAP_BFF_URL__ ?? '',
});

// ---------------------------------------------------------------------------
// Contract — HAND-WRITTEN to mirror the snapdragon-admin-bff-api `backingservices`
// package (cloud-deploy DESIGN I8-DESIGN, Lane M3). Follows the cloud-backups
// precedent: a typed hand-written client over the EXACT bff paths/DTOs (the Jackson
// maps serialise camelCase — no @JsonProperty / global SNAKE_CASE in the bff — so
// these interfaces use the map field names verbatim).
//
// Bound bff surfaces (SUPERADMIN-only, /bff/superadmin/**):
//   GET  /bff/superadmin/backing-services              → { enabled, services[], note }
//   PUT  /bff/superadmin/backing-services/{id}/mode    → recorded mode  (X-BackingServices-StepUp)
// ---------------------------------------------------------------------------

/** The MODE of a backing service — self-hosted (in-mesh default) or managed (hosted cloud). */
export type BackingServiceMode = 'self-hosted' | 'managed';

/** One catalog row JOINED with its current recorded mode — the console's table row.
 *  tier 3 (docsOnly) rows are managed-swap DOCS ONLY in v1 and are rendered read-only. */
export interface BackingServiceRow {
  id: string;
  kind: string; // object-storage | smtp | kafka | analytics | postgres | cassandra | registry | secrets | pki
  tier: number; // 1 trivial | 2 easy | 3 docs-only
  docsOnly: boolean;
  displayName: string;
  awsTarget: string;
  azureTarget: string;
  notes: string;
  currentMode: BackingServiceMode;
  endpoint: string | null;
  credsRef: string | null;
  generation: number;
}

/** GET /bff/superadmin/backing-services response — the closed catalog + current state. */
export interface BackingServicesCatalog {
  enabled: boolean;
  services: BackingServiceRow[];
  note: string;
}

/** Body for the mode change (SetBackingServiceModeRequest). endpoint is REQUIRED for
 *  managed; credsRef is a REFERENCE only (an ESO/Vault path name), never credential bytes. */
export interface SetModeRequest {
  mode: BackingServiceMode;
  endpoint?: string | null;
  credsRef?: string | null;
}

/** The recorded mode intent a successful PUT returns (BackingServiceMode.toMap + note). */
export interface RecordedMode {
  id: string;
  serviceId: string;
  mode: BackingServiceMode;
  endpoint: string | null;
  credsRef: string | null;
  requestedBySubject: string;
  createdAt: string;
  generation: number;
  note?: string;
}

/** A typed error so components surface the EXACT failure the bff returned. The bff is the
 *  AUTHORITATIVE gate (UI gating is convenience), so components key off `isStepUpRequired`
 *  (prompt for step-up), `isDocsOnly` (tier-3 refusal), and `isDark` (feature ships dark). */
export class BackingServiceApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'BackingServiceApiError';
  }
  /** A 401 — unauthenticated (no/expired bff token). */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  /** A 403 — the SUPERADMIN coarse path gate / @PreAuthorize denying, OR the step-up gate. */
  get isForbidden(): boolean {
    return this.status === 403;
  }
  /** A 403 whose server message names the step-up requirement (BackingServiceStepUpGate).
   *  Distinct from a plain role 403 so the UI can prompt for a step-up token rather than say
   *  "you lack the role". */
  get isStepUpRequired(): boolean {
    return this.status === 403 && /step-up/i.test(this.message);
  }
  /** A 409 — a tier-3 DOCS-ONLY service refusing a mode change (the managed swap is
   *  architecturally blocked and ships as docs, not code). */
  get isDocsOnly(): boolean {
    return this.status === 409;
  }
  /** A 400 — a bad request (unknown mode, managed without an endpoint, …). The server
   *  `error` carries the reason, surfaced verbatim. */
  get isBadRequest(): boolean {
    return this.status === 400;
  }
  /** A 503 — the feature SHIPS DARK (app.backing-services.enabled=false): reads are live but
   *  a mode change writes nothing. */
  get isDark(): boolean {
    return this.status === 503;
  }
}

/**
 * Hand-written reactive client over the snapdragon-admin-bff-api `backingservices` surfaces.
 * Auth rides the HttpOnly `bff_` cookie sent via `credentials:'include'` (the same cookie every
 * other admin-ui BFF call uses — the gateway turns it into the bearer server-side). The mutating
 * PUT carries the step-up token via the `X-BackingServices-StepUp` header (extraHeaders).
 *
 * The bff is the AUTHORITATIVE gate (SUPERADMIN-only on /bff/superadmin/**), so each method
 * surfaces a 401/403/409/503 as a {@link BackingServiceApiError} the caller renders gracefully —
 * the UI guards are defence-in-depth only.
 */
@Injectable({ providedIn: 'root' })
export class BackingServicesService {
  private readonly base = inject(BACKING_SERVICES_BASE_URL);

  private headers(json = false, extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (json) h['Content-Type'] = 'application/json';
    if (extra) Object.assign(h, extra);
    return h;
  }

  /** Issue a request to an ABSOLUTE bff path (the caller passes the full /bff/... path so the
   *  EXACT contract URL is visible at the call site and asserted in the spec). `extraHeaders`
   *  carries the X-BackingServices-StepUp header on the mode change. */
  private async req<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const r = await fetch(`${this.base}${path}`, {
      method,
      headers: this.headers(body !== undefined, extraHeaders),
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) {
      // Read a server message (the bff returns {error|message|note}) but never let a parse
      // failure mask the status the UI keys off.
      let detail = '';
      try {
        const txt = await r.text();
        if (txt) {
          try {
            const j = JSON.parse(txt);
            detail = j.error ?? j.message ?? j.note ?? txt;
          } catch {
            detail = txt;
          }
        }
      } catch {
        /* ignore */
      }
      throw new BackingServiceApiError(r.status, detail || `${method} ${path} failed: ${r.status}`);
    }
    if (r.status === 204) return undefined as T;
    const text = await r.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** GET /bff/superadmin/backing-services → the closed catalog JOINED with the current recorded
   *  mode per service (+ the enabled flag + the intent-only note). Live even while the feature
   *  ships dark, so the console renders honestly. */
  getCatalog(): Promise<BackingServicesCatalog> {
    return this.req<BackingServicesCatalog>('GET', '/bff/superadmin/backing-services');
  }

  /** PUT /bff/superadmin/backing-services/{id}/mode → the recorded mode intent. The step-up
   *  token (when supplied) rides the X-BackingServices-StepUp header; a gate-unsatisfied call is
   *  a 403 naming step-up, a tier-3 service is a 409, and while dark it is a 503. Optional
   *  endpoint/credsRef are omitted (not sent as empty strings) so the bff's null branches apply. */
  setMode(id: string, body: SetModeRequest, stepUpToken?: string): Promise<RecordedMode> {
    const token = stepUpToken?.trim();
    return this.req<RecordedMode>(
      'PUT',
      `/bff/superadmin/backing-services/${encodeURIComponent(id)}/mode`,
      this.cleanBody(body),
      token ? { 'X-BackingServices-StepUp': token } : undefined,
    );
  }

  /** Build the mode body carrying ONLY the intent; empty optionals are omitted so the bff's
   *  null branches apply (self-hosted sends no endpoint/credsRef). */
  private cleanBody(b: SetModeRequest): SetModeRequest {
    const out: SetModeRequest = { mode: b.mode };
    if (b.endpoint && b.endpoint.trim()) out.endpoint = b.endpoint.trim();
    if (b.credsRef && b.credsRef.trim()) out.credsRef = b.credsRef.trim();
    return out;
  }
}
