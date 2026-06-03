# snapdragon-admin-ui

Admin console as an **Angular 18 native-federation REMOTE**, split out of
snapdragon-social-ui. The snapdragon.systems host federates this remote's
exposed `ADMIN_ROUTES` at runtime and mounts them at **/admin**, so they
resolve to:

| Host path          | View                        | Component                  |
| ------------------ | --------------------------- | -------------------------- |
| `/admin`           | Registration allowlist      | `AdminComponent`           |
| `/admin/usage`     | ClickHouse usage dashboard  | `UsageComponent`           |
| `/admin/namespaces`| Namespace access grants     | `NamespaceAccessComponent` |

Casdoor-**admin-role** only — the host route-guards `/admin` (this repo also
ships `adminGuard` for standalone use). Manages the Gmail/Discord registration
allowlist, per-user namespace access grants, and the ClickHouse-backed usage
dashboard (links to Uptrace). Backed by snapdragon-admin-bff behind the gateway;
reads the shared `snap.session` (roles + bffToken) written by the login remote.

## Federation

`federation.config.js` exposes `./routes` → `src/app/admin.routes.ts`
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
