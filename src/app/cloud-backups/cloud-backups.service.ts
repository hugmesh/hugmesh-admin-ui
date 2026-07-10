import { Injectable, InjectionToken, inject } from '@angular/core';

/** Base URL of the admin BFF. The fe-gateway proxies same-origin /bff/** to
 *  snapdragon-admin-bff-api, so the default is the empty string = same origin.
 *  `globalThis.__SNAP_BFF_URL__` lets the host override the target at runtime
 *  (mirrors the other remotes' __SNAP_*_URL__ globals + bff.service.ts CFG). */
export const CLOUD_BACKUPS_BASE_URL = new InjectionToken<string>('CLOUD_BACKUPS_BASE_URL', {
  // The bare identifier (no globalThis guard) throws ReferenceError — nothing
  // actually declares __SNAP_BFF_URL__ as a real global; the comment above
  // already documented the intended globalThis form, the code just diverged.
  factory: () => (globalThis as any).__SNAP_BFF_URL__ ?? '',
});

// ---------------------------------------------------------------------------
// Contract — HAND-WRITTEN to mirror the snapdragon-admin-bff-api `cloudbackup`
// package (PR #74 "backups foundation"). The bff's /v3/api-docs was unreachable
// for the superadmin-service-catalog-ui too, so this follows that precedent: a typed
// hand-written client over the EXACT bff paths/DTOs. The Jackson records serialise
// camelCase (no @JsonProperty / no global SNAKE_CASE config in the bff), so these
// interfaces use the record field names verbatim. ng-openapi-gen stays wired
// (npm run gen) for when /v3/api-docs is captured — these signatures are the
// stable contract a generated client would back.
//
// Bound bff surfaces (see each method):
//   GET    /bff/admin/cloud-backups                 → BackupSet[]   (list; SUPERADMIN ?domain=)
//   POST   /bff/admin/cloud-backups                 → BackupSet     (create DOMAIN scope)
//   GET    /bff/admin/cloud-backups/{id}/versions   → BackupSet[]   (version chain)
//   GET    /bff/admin/cloud-backups/{id}/artifacts  → BackupArtifact[]
//   POST   /bff/admin/cloud-backups/{id}/restore    → {id,version,status}  (X-Backup-StepUp)
//   GET    /bff/admin/cloud-backups/services        → RunningService[]  (per-service menu)
//   GET    /bff/admin/cloud-backups/destinations    → BackupDestination | 204
//   PUT    /bff/admin/cloud-backups/destinations    → BackupDestination
//   POST   /bff/superadmin/cloud-backups/total      → BackupSet     (SUPERADMIN TOTAL)
// ---------------------------------------------------------------------------

/** The SCOPE of a cloud backup (BackupCloudScope) — DOMAIN (per-brand) or TOTAL
 *  (superadmin-only, the whole cloud). Serialised UPPERCASE. */
export type BackupCloudScope = 'DOMAIN' | 'TOTAL';

/** Destination kind (BackupDestinationKind) — the wire (lowercase) names. */
export type BackupDestinationKind = 'object_store' | 'node_storage';

/** A backup_set row — one backup REQUEST/job. VERSIONED: rows sharing a setKey
 *  form the chain; each run gets version+1. domain + createdBy are STAMPED by the
 *  bff (never sent by the UI). */
export interface BackupSet {
  id: string;
  setKey: string;
  version: number;
  scope: BackupCloudScope;
  domain: string;
  createdBy: string;
  services: string[];
  destinationKind: BackupDestinationKind;
  destinationRef: string;
  sizeBytes: number | null;
  encryptionMeta: string | null;
  status: string; // pending | running | complete | failed
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

/** A backup_artifact row — the per-SERVICE record under a BackupSet. */
export interface BackupArtifact {
  id: string;
  setId: string;
  service: string;
  kind: string; // db_dump | pv_snapshot | config
  sizeBytes: number | null;
  status: string; // pending | running | complete | failed
  createdAt: string;
  completedAt: string | null;
}

/** A backup_destination row — the per-domain destination CONFIG (at most one per
 *  brand). secretRef/destinationRef are REFERENCES only, never credential bytes. */
export interface BackupDestination {
  id: string;
  kind: BackupDestinationKind;
  destinationRef: string;
  secretRef: string | null;
  domain: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** One entry in the per-service backup MENU — a running service an admin may
 *  select to back up. `optional` services are greyed-out when not installed. */
export interface RunningService {
  key: string;
  displayName: string;
  defaultKind: string; // db_dump | pv_snapshot | config
  optional: boolean;
}

/** Body for create (CreateBackupRequest). The UI NEVER sends a domain / createdBy /
 *  scope — domain + createdBy are stamped server-side, and scope is DOMAIN on the
 *  per-domain endpoint (TOTAL is reached ONLY via the superadmin endpoint). */
export interface CreateBackupRequest {
  setKey?: string | null;
  services: string[];
  destinationKind: BackupDestinationKind;
  destinationRef: string;
  encryptionMeta?: string | null;
}

/** Body for the destination upsert (BackupDestinationRequest). domain is stamped
 *  server-side from the validated issuer; targetDomain is SUPERADMIN-ONLY (ignored
 *  for a scoped admin). */
export interface BackupDestinationRequest {
  kind: BackupDestinationKind;
  destinationRef: string;
  secretRef?: string | null;
  targetDomain?: string | null;
}

/** The {id,version,status} a restore returns (RESTORE_QUEUED). */
export interface RestoreResult {
  id: string;
  version: number;
  status: string;
}

/** A typed error the service raises so components surface the EXACT failure the
 *  bff returned. The bff is the AUTHORITATIVE gate (UI gating is convenience), so
 *  components key off `isForbidden` to degrade gracefully on a 403, and off
 *  `isStepUpRequired` for the restore step-up 403. */
export class CloudBackupApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CloudBackupApiError';
  }
  /** A 401 — unauthenticated (no/expired bff token). */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  /** A 403 — the ADMIN/SUPERADMIN @PreAuthorize / coarse path gate denying, OR the
   *  restore step-up gate denying. The server-authoritative default-deny. */
  get isForbidden(): boolean {
    return this.status === 403;
  }
  /** A 403 whose server message names the step-up requirement (the restore path's
   *  BackupStepUpGate). Distinct from a plain role 403 so the restore UI can prompt
   *  for a step-up token rather than say "you lack the role". */
  get isStepUpRequired(): boolean {
    return this.status === 403 && /step-up/i.test(this.message);
  }
  /** A 404 — a set/version that is gone or is out-of-scope (a cross-domain id is a
   *  404, never visible to a scoped admin). */
  get isNotFound(): boolean {
    return this.status === 404;
  }
  /** A 400 — a bad request (unknown destinationKind, empty services, …). The
   *  server `message` carries the reason, surfaced verbatim. */
  get isBadRequest(): boolean {
    return this.status === 400;
  }
}

/**
 * Hand-written reactive client over the snapdragon-admin-bff-api `cloudbackup`
 * surfaces. Auth rides the HttpOnly `bff_` cookie sent via `credentials:'include'`
 * (the same cookie every other admin-ui BFF call uses — see bff.service.ts; the
 * gateway turns it into the bearer server-side) — the host injects nothing and the
 * module renders no login form.
 *
 * Every method maps 1:1 to a bff endpoint. The bff is the AUTHORITATIVE gate
 * (ADMIN/SUPERADMIN domain-scoped on /bff/admin/cloud-backups, SUPERADMIN-only on
 * /bff/superadmin/cloud-backups/total), so each method surfaces a 401/403/404 as a
 * CloudBackupApiError the caller renders gracefully — the UI guards are
 * defence-in-depth only.
 */
@Injectable({ providedIn: 'root' })
export class CloudBackupsService {
  private readonly base = inject(CLOUD_BACKUPS_BASE_URL);

  // ----- headers ----------------------------------------------------------

  private headers(json = false, extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (json) h['Content-Type'] = 'application/json';
    if (extra) Object.assign(h, extra);
    return h;
  }

  /** Issue a request to an ABSOLUTE bff path (the caller passes the full /bff/...
   *  path so the EXACT contract URL is visible at the call site and asserted in
   *  the spec). `extraHeaders` carries the X-Backup-StepUp header on restore. */
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
      // Read a server message (the bff returns a JSON {error|message}) but never
      // let a parse failure mask the status the UI keys off.
      let detail = '';
      try {
        const txt = await r.text();
        if (txt) {
          try {
            const j = JSON.parse(txt);
            detail = j.message ?? j.error ?? txt;
          } catch {
            detail = txt;
          }
        }
      } catch {
        /* ignore */
      }
      throw new CloudBackupApiError(r.status, detail || `${method} ${path} failed: ${r.status}`);
    }
    // 204 No Content (destination unset) → undefined.
    if (r.status === 204) return undefined as T;
    const text = await r.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // ----- per-domain backup sets (ADMIN|SUPERADMIN): /bff/admin/cloud-backups

  /** GET /bff/admin/cloud-backups → BackupSet[] — the caller's OWN-domain sets
   *  (issuer-derived; never a request field). A SUPERADMIN may pass a `domain`
   *  filter to read cross-domain. */
  listSets(domain?: string): Promise<BackupSet[]> {
    const q = domain && domain.trim() ? `?domain=${encodeURIComponent(domain.trim())}` : '';
    return this.req<BackupSet[]>('GET', `/bff/admin/cloud-backups${q}`);
  }

  /** POST /bff/admin/cloud-backups → BackupSet — create a DOMAIN-scope backup. The
   *  body carries ONLY the request intent; domain + createdBy + scope=DOMAIN are
   *  stamped by the bff. */
  createSet(body: CreateBackupRequest): Promise<BackupSet> {
    return this.req<BackupSet>('POST', '/bff/admin/cloud-backups', this.cleanCreate(body));
  }

  /** GET /bff/admin/cloud-backups/{id}/versions → BackupSet[] — the version chain
   *  (the rows sharing this set's setKey). Scoped: a cross-domain id is a 404. */
  versions(id: string): Promise<BackupSet[]> {
    return this.req<BackupSet[]>('GET', `/bff/admin/cloud-backups/${encodeURIComponent(id)}/versions`);
  }

  /** GET /bff/admin/cloud-backups/{id}/artifacts → BackupArtifact[] — the per-service
   *  artifact rows under a set. Scoped. */
  artifacts(id: string): Promise<BackupArtifact[]> {
    return this.req<BackupArtifact[]>('GET', `/bff/admin/cloud-backups/${encodeURIComponent(id)}/artifacts`);
  }

  /** POST /bff/admin/cloud-backups/{id}/restore → {id,version,status} — the
   *  PRIVILEGED, destructive path. The step-up token rides the X-Backup-StepUp
   *  header (BackupStepUpGate.STEP_UP_HEADER); a missing/invalid token is a 403
   *  whose message names the step-up requirement. Scoped: own-domain only. */
  restore(id: string, stepUpToken: string): Promise<RestoreResult> {
    return this.req<RestoreResult>(
      'POST',
      `/bff/admin/cloud-backups/${encodeURIComponent(id)}/restore`,
      undefined,
      { 'X-Backup-StepUp': stepUpToken },
    );
  }

  /** GET /bff/admin/cloud-backups/services → RunningService[] — the per-service
   *  backup menu (the running services an admin may pick). */
  services(): Promise<RunningService[]> {
    return this.req<RunningService[]>('GET', '/bff/admin/cloud-backups/services');
  }

  /** GET /bff/admin/cloud-backups/destinations → BackupDestination | undefined — the
   *  per-domain destination config (204 No Content → undefined when unset). A
   *  SUPERADMIN may pass a `domain` filter. */
  getDestination(domain?: string): Promise<BackupDestination | undefined> {
    const q = domain && domain.trim() ? `?domain=${encodeURIComponent(domain.trim())}` : '';
    return this.req<BackupDestination | undefined>('GET', `/bff/admin/cloud-backups/destinations${q}`);
  }

  /** PUT /bff/admin/cloud-backups/destinations → BackupDestination — upsert the
   *  per-domain destination. domain is stamped server-side; targetDomain is
   *  SUPERADMIN-only (ignored for a scoped admin). */
  putDestination(body: BackupDestinationRequest): Promise<BackupDestination> {
    return this.req<BackupDestination>('PUT', '/bff/admin/cloud-backups/destinations', this.cleanDestination(body));
  }

  // ----- TOTAL-CLOUD (SUPERADMIN-only): /bff/superadmin/cloud-backups/total

  /** POST /bff/superadmin/cloud-backups/total → BackupSet — create a TOTAL-CLOUD
   *  (scope=TOTAL) backup. SUPERADMIN-only (triple-gated at the bff); an
   *  ADMIN here is a clean 403. */
  createTotal(body: CreateBackupRequest): Promise<BackupSet> {
    return this.req<BackupSet>('POST', '/bff/superadmin/cloud-backups/total', this.cleanCreate(body));
  }

  // ----- helpers: never send forbidden / empty optional fields -------------

  /** Build the create body carrying ONLY the request intent — NEVER a domain /
   *  createdBy / scope field (the bff stamps those; sending them is a contract
   *  violation). Optional fields are omitted (not sent as empty strings) so the
   *  bff's null branches apply. */
  private cleanCreate(b: CreateBackupRequest): CreateBackupRequest {
    const out: CreateBackupRequest = {
      services: b.services,
      destinationKind: b.destinationKind,
      destinationRef: b.destinationRef,
    };
    if (b.setKey && b.setKey.trim()) out.setKey = b.setKey.trim();
    if (b.encryptionMeta && b.encryptionMeta.trim()) out.encryptionMeta = b.encryptionMeta.trim();
    return out;
  }

  private cleanDestination(b: BackupDestinationRequest): BackupDestinationRequest {
    const out: BackupDestinationRequest = { kind: b.kind, destinationRef: b.destinationRef };
    if (b.secretRef && b.secretRef.trim()) out.secretRef = b.secretRef.trim();
    if (b.targetDomain && b.targetDomain.trim()) out.targetDomain = b.targetDomain.trim();
    return out;
  }
}
