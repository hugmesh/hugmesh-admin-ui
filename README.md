# snapdragon-admin-ui

Admin console as an **Angular 22 native-federation REMOTE**, split out of
snapdragon-social-ui. The snapdragon.systems host federates this remote's
exposed `ADMIN_ROUTES` at runtime and mounts them at **/admin**, so they
resolve to:

| Host path             | View                              | Component                  |
| --------------------- | --------------------------------- | -------------------------- |
| `/admin`              | Registration allowlist            | `AdminComponent`           |
| `/admin/usage`        | ClickHouse usage dashboard        | `UsageComponent`           |
| `/admin/namespaces`   | Namespace access grants           | `NamespaceAccessComponent` |
| `/admin/route-access` | Per-gateway role→URL access rules | `RouteAccessComponent`     |
| `/admin/routes`       | Gateway route definitions         | `RouteDefinitionsComponent`|
| `/admin/isos`         | CI ISO download links             | `IsoDownloadsComponent`    |
| `/admin/announcements`| Announcements (create + schedule) | `AnnouncementListComponent`|

Casdoor-**admin-role** only — the host route-guards `/admin` (this repo also
ships `adminGuard` for standalone use). Manages the Gmail/Discord registration
allowlist, per-user namespace access grants, the ClickHouse-backed usage
dashboard (links to Uptrace), per-gateway role→URL external-access rules
(`/bff/admin/route-access` — persisted in Postgres, Cassandra-cached by each
gateway; just role-based locking of known services, no random app URLs), and
links to the latest CI-delivered ISO artifacts (`/bff/admin/isos`; KEYS
material is never in these images, so nothing secret is exposed). Backed by
snapdragon-admin-bff-api behind the gateway; reads the shared `snap.session`
(roles + bffToken) written by the login remote.

### Announcements

`/admin/announcements` creates, schedules and targets announcements via the
admin BFF (`/bff/admin/announcements`, ROLE_ADMIN — POST / GET list / GET / PUT /
DELETE by id). An announcement carries a `body_html` (HTML or WYSIWYG), a
`state` (draft / published / archived), a schedule (`starts_at` / `ends_at` /
`timezone`), a `priority`, a `dismissible` flag and **four per-surface target
flags** so one announcement can show on any combination of the logged-in **Home**
top banner, the public **Login** page (everyone, incl. anonymous), **Mastodon/
akkoma** (as a local-only admin announcement, propagated by the BFF on publish)
and the **Forum** main page. The forum banner is served to the (not-yet-built)
snapdragon-forum-ui from `/bff/announcements/forum`; the per-surface read
endpoints (`/bff/announcements/home`, `/bff/public/announcements/login`,
`/bff/announcements/forum`) live in the BFF.

`body_html` is admin HTML shown to end users including anonymous login visitors,
so it is **sanitised server-side by the BFF** (the authority) and the editor
**never uses raw `innerHTML`**: the live preview renders the sanitised body inside
a **sandboxed null-origin `srcdoc` iframe** (`sandbox=""` — no `allow-scripts`,
no `allow-same-origin`), mirroring the snapdragon-user-ui card-builder two-wall
model. Datastore: `AnnouncementsStore` (signal-backed) is the hand-written typed
client against the contract — this remote has no `ng-openapi-gen` wired, so per
the offline fallback the client is written directly against the API shape.

## Federation

`federation.config.mjs` exposes `./routes` → `src/app/admin.routes.ts`
(`ADMIN_ROUTES`). The build emits `dist/admin/browser/remoteEntry.json`, whose
`exposes` entry the host consumes to lazy-load the routes.

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

## Deploy

`Dockerfile` builds the remote and serves `dist/admin/browser` via nginx with
`Access-Control-Allow-Origin "*"` (so the host can fetch `remoteEntry.json` and
chunks cross-origin) and an SPA fallback to `/index.html`; `GET /healthz`
returns `200`. Runs as its own pod in the snapdragon-frontend namespace,
fronted by the fe-gateway at `/admin`.
