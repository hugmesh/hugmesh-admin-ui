# snapdragon-admin-ui

Admin console for the Snapdragon platform, built as an **Angular 22
native-federation REMOTE** (federation remote name `admin`), split out of
snapdragon-social-ui. The **snapdragon.systems host** federates this remote's
single exposed `./routes` module at runtime and mounts the exposed
`ADMIN_ROUTES` at **/admin**.

## Where it sits in the architecture

| Concern        | This repo                                                              |
| -------------- | --------------------------------------------------------------------- |
| Tier           | Frontend / micro-frontend (a federated **remote**, not a host)        |
| Namespace      | `snapdragon-frontend` — runs as its own nginx pod                     |
| Fronted by     | the **fe-gateway** at `/admin`                                         |
| Backed by      | **snapdragon-admin-bff-api** (Spring), in the backend namespace, behind the gateway |
| Auth model     | Casdoor **admin role** only; the host route-guards `/admin`           |
| Federation host| **snapdragon.systems** (loads `remoteName: 'admin', exposedModule: './routes'`) |

This is the admin surface of the multi-brand / multi-tenant platform. It is a
*consumer-facing UI only*: every privileged action is brokered by the admin BFF,
which is the single contract to the cluster. The BFF in turn reaches **Casdoor
through the snapdragon-pki gateway** for identity/role operations and proxies
in-cluster systems (ArgoCD, ClickHouse, the gateway route registries) so their
URLs/tokens never leave the cluster. Roles are **owned by Casdoor**; this UI
never mints or evaluates authority on its own — it only reflects the
`snap.session` roles and lets the BFF/gateway enforce.

> Multi-tenancy note: in the platform direction (per-domain CA + per-brand
> gateway/BFF/UI instances + issuer-keyed domain scoping + the least-privilege
> cascade SUPERADMIN→ADMIN→MOD→USER), this console is the **per-brand ADMIN
> surface**. As shipped today the gate is a flat Casdoor `admin` role
> (`roles.includes('admin')`); domain scoping and the superadmin/app-store tier
> are enforced upstream at the gateway/BFF, not in this UI.

## Routes (mounted by the host at `/admin`)

The remote exposes `ADMIN_ROUTES` (`src/app/admin.routes.ts`). The host mounts
them at `/admin`, so they resolve to:

| Host path              | View                                  | Component                   |
| ---------------------- | ------------------------------------- | --------------------------- |
| `/admin`               | Registration allowlist + admin menu   | `AdminComponent`            |
| `/admin/usage`         | ClickHouse usage dashboard            | `UsageComponent`            |
| `/admin/namespaces`    | Namespace access grants               | `NamespaceAccessComponent`  |
| `/admin/route-access`  | Per-gateway role→URL access rules     | `RouteAccessComponent`      |
| `/admin/routes`        | Gateway route definitions             | `RouteDefinitionsComponent` |
| `/admin/isos`          | CI ISO download links                 | `IsoDownloadsComponent`     |
| `/admin/argocd`        | ArgoCD applications dashboard         | `ArgocdDashboardComponent`  |
| `/admin/tasks`         | Guided admin-task wizard              | `AdminTaskWizardComponent`  |
| `/admin/backup`        | Start a cloud/USB backup              | `BackupComponent`           |
| `/admin/recovery`      | Restore a backup                      | `RecoveryComponent`         |
| `/admin/backups`       | Backup + restore history              | `BackupHistoryComponent`    |
| `/admin/announcements` | Announcements (create + schedule)     | `AnnouncementListComponent` |

`AdminComponent` is both the landing view (registration allowlist) and the admin
**menu** that surfaces every module above as `routerLink`s relative to `/admin`.

## Role gate & session

Casdoor **admin role only**. The host route-guards `/admin`; this repo also ships
`adminGuard` (`src/app/admin.guard.ts`) — a `CanActivateFn` that allows when
`SessionService.isAdmin()` (i.e. `snap.session.roles` includes `admin`) and
otherwise redirects to `/login` — for standalone use.

`SessionService` (`src/app/session.service.ts`) reads the shared **`snap.session`**
localStorage key written by the **login remote** (identity, `roles`, `bffToken`,
`registrationComplete`, optional Matrix/Mastodon tokens). The host shell and each
remote hold their own `SessionService` instance over the same key and re-read on a
same-document broadcast (`snap-session-change`) and cross-tab `storage` events, so
a session change (e.g. registration completing in the login remote) propagates
without a reload.

## BFF contract

`BffService` (`src/app/bff.service.ts`) is the hand-written typed client against
**snapdragon-admin-bff-api**. Every call attaches the Casdoor bearer
(`authorization: Bearer ${snap.session.bffToken}`) and targets only the
admin-scoped endpoints — the registration/login/Matrix-Mastodon service-token
broker flow lives in the login remote. The BFF URL + Uptrace URL are read from
runtime globals (`__SNAP_BFF_URL__`, `__SNAP_UPTRACE_URL__`).

| Module                  | Endpoint(s)                                                | Notes |
| ----------------------- | ---------------------------------------------------------- | ----- |
| Registration allowlist  | `GET/POST /bff/admin/allowlist`                            | Invite by Gmail address or Discord username; the BFF invites the identity in Casdoor via the pki gateway. |
| Usage analytics         | `GET /bff/admin/usage` (+ Uptrace link)                    | Aggregated by the BFF from ClickHouse (events arrive via Kafka in prod). |
| Namespace access        | `GET/POST/DELETE /bff/admin/namespace-access`, `GET /bff/me/namespaces` | Grant users access to cluster namespaces (maps to Casdoor groups + k8s RBAC server-side); scopes what each user sees in observability. |
| Route **access**        | `GET/POST/DELETE /bff/admin/route-access`                 | Per-gateway role→URL allow/deny rules. Persisted in Postgres (`gateway_route_access`); each gateway Cassandra-caches them and denies external access unless the caller's Casdoor roles match. Role-based locking of known services only — no arbitrary URLs. |
| Route **definitions**   | `GET/POST /bff/admin/routes`, `DELETE /bff/admin/routes/{pathPrefix}` | Admin-editable `url_registry` rows the gateway turns into live Spring Cloud Gateway routes (`path_prefix` → `downstream_uri`). Distinct from route-access. |
| ISO downloads           | `GET /bff/admin/isos`                                      | Latest ISO artifacts from the GitLab/ArgoCD CI pipeline. Signed gateway-internal URLs; **KEYS material is never in these images**, so nothing secret is exposed. |
| ArgoCD dashboard        | `GET /bff/admin/argocd/applications[/{name}]`, `POST .../sync` | Role-secured proxy in the BFF (ArgoCD's own URL/token never leave the cluster). Live state; the sync mutation requires a typed `{confirm: name}` token. When ArgoCD is not wired the BFF returns `503` → an honest "ArgoCD not connected" notice. |
| Guided tasks            | `GET /bff/admin/tasks`, `POST .../steps/{stepId}/{validate\|preview\|apply}` | Data-driven step/task wizard over cluster-admin ops (gateway-route, RBAC/route-access, Casdoor user); a new server-side task appears with no UI change. Reuses the BFF's ReservedNames validation. |
| Backup & Recovery       | `POST /bff/admin/backups`, `POST /bff/admin/restores`, `GET /bff/admin/backups`, `GET /bff/admin/usb-devices`, SSE `GET /bff/admin/backups/{id}/events` | Cloud/USB targets with optional AES-256 encryption. The BFF orchestrates a k8s backup/restore worker Job and streams progress over SSE (read via `fetch`, not `EventSource`, so the bearer token can be sent). The plaintext password is sent ONCE and never stored client-side; only the BFF stores a PBKDF2 verifier and the worker derives the key. |
| Announcements           | `GET/POST/PUT/DELETE /bff/admin/announcements`             | See below. |

## Announcements

`/admin/announcements` creates, schedules and targets announcements via the admin
BFF (`/bff/admin/announcements`, ROLE_ADMIN). An announcement carries a
`body_html` (HTML / WYSIWYG), a `state` (draft / published / archived), a schedule
(`starts_at` / `ends_at` / `timezone`), a `priority`, a `dismissible` flag and
**four per-surface target flags** so one announcement can show on any combination
of the logged-in **Home** top banner, the public **Login** page (everyone, incl.
anonymous), **Mastodon/akkoma** (as a local-only admin announcement, propagated by
the BFF on publish) and the **Forum** main page. The per-surface read endpoints
(`/bff/announcements/home`, `/bff/public/announcements/login`,
`/bff/announcements/forum`) live in the BFF and apply the authoritative ACTIVE
rule; this UI computes an "active now" badge client-side for display only.

`body_html` is admin HTML shown to end users (including anonymous login visitors),
so it is **sanitised server-side by the BFF** (the authority) and the editor
**never uses raw `innerHTML`**: the live preview renders the sanitised body inside
a **sandboxed null-origin `srcdoc` iframe** (`sandbox=""` — no `allow-scripts`, no
`allow-same-origin`), mirroring the snapdragon-user-ui card-builder two-wall model.
`AnnouncementsStore` is the signal-backed hand-written typed client — this remote
has no `ng-openapi-gen` wired, so per the offline fallback the client is written
directly against the API shape.

## Accessibility

Every module follows the platform a11y baseline: inline validation surfaced in
`role=alert` live regions, async progress announced via `role=status` /
`aria-live`, status conveyed with text (not colour alone), `<label for>` on every
field, confirm-before-destructive guards, and keyboard-operable controls
(the ArgoCD sync confirm is a focus-managed `role=dialog aria-modal`). The
standalone dev shell supplies a skip link + a `<main id="main">` landmark.

## Federation

`federation.config.js` (built via `federation-base.js`, the shared Snapdragon
federation surface) exposes `./routes` → `src/app/admin.routes.ts`
(`ADMIN_ROUTES`). The remote name `admin` and the exposed module key `./routes`
**must stay unchanged** or the host's admin console breaks. The build emits
`dist/admin/browser/remoteEntry.json`, whose `exposes` entry the host consumes to
lazy-load the routes.

## Develop

```bash
npm install
npm start            # ng serve admin → http://localhost:4204 (standalone dev shell)
```

The standalone dev shell (`AppComponent`, selector `snap-admin-root`) mounts
`ADMIN_ROUTES` at `/` so the remote is browsable on its own. In production the
host loads `./routes` directly and this shell is not used.

## Build

```bash
npm run build        # ng build admin
```

The Angular application builder nests output under **`dist/admin/browser/`**
(incl. `remoteEntry.json`).

## Test

```bash
npm test             # ng test admin --watch=false --browsers=ChromeHeadlessCI
```

## Deploy

`Dockerfile` builds the remote and serves `dist/admin/browser` via nginx with
`Access-Control-Allow-Origin "*"` (so the host can fetch `remoteEntry.json` and
chunks cross-origin) and an SPA fallback to `/index.html`; `GET /healthz` returns
`200`. Runs as its own pod in the **snapdragon-frontend** namespace, fronted by
the **fe-gateway** at `/admin`. CI (`.gitlab-ci.yml`) builds + pushes the image to
the in-cluster GitLab registry on push/mirror-sync; **images carry no KEYS
material** — it is supplied from the USB at first boot.
