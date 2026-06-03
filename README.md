# snapdragon-admin-ui

Admin Angular micro-frontend (federated remote), split out of snapdragon-social-ui.
Casdoor-admin-role only (route-guarded). Backed by snapdragon-admin-bff behind
the gateway. Views (each a standalone component the host federates in):

- `admin.component` — Gmail/Discord registration allowlist.
- `namespace-access.component` — per-user cluster-namespace access grants.
- `usage.component` — ClickHouse-backed usage dashboard; links to Uptrace.
- `route-access.component` — per-gateway role→URL external-access rules
  (`/bff/admin/route-access` CRUD; persisted in Postgres, Cassandra-cached by
  each gateway). No random app URLs — just role-based locking of known services.
- `iso-downloads.component` — links to the latest ISO artifacts delivered by the
  GitLab/ArgoCD CI pipeline (`/bff/admin/isos`). KEYS material is never in these
  images, so nothing secret is exposed here.
