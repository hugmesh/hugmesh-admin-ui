# hugmesh-admin-ui — builds the Admin native-federation REMOTE
# (src → dist/admin) and serves it via nginx with CORS so the
# hugmesh.net host can fetch its remoteEntry.json cross-origin.
# Deployed to the hugmesh-frontend namespace, fronted by the fe-gateway at
# /admin. Casdoor-admin-role guarded by the host.
# Angular CLI 22 requires Node >= 24.15.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:admin -- --base-href=/admin/

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/admin/browser /usr/share/nginx/html
# Runtime THEME injection: the nginx entrypoint auto-runs every executable
# /docker-entrypoint.d/*.sh at container start (before nginx forks). This hook
# (byte-identical to login-ui's) writes hug-theme.css from SNAP_THEME_CSS —
# already-derived --sd-* token text (studio core/theme.py css_root()); zero
# colour maths here. Unset/empty env => an EMPTY file => shipped default brand.
#
# HUG_THEME_OUT=/tmp, NOT the docroot, and COPY --chmod, NOT RUN chmod — the
# two deltas that make this stanza correct on BOTH fleet bases. Under
# nginxinc/nginx-unprivileged the hooks run as uid 101 while the docroot stays
# root-owned (a docroot write dies "Permission denied" and the entrypoint's
# set -e aborts before nginx ever starts), and RUN also executes as uid 101 so
# a root-owned copied file cannot be chmod'ed after the fact. /tmp is that
# image's designated writable dir (its stock nginx.conf already keeps the pid
# file and every *_temp_path there); nginx.conf's exact-match
# `location = /hug-theme.css { alias /tmp/hug-theme.css; }` puts the file
# back on the URL that the index.html stylesheet link resolves to.
COPY --chmod=755 docker-entrypoint.d/50-hug-theme.sh /docker-entrypoint.d/50-hug-theme.sh
ENV HUG_THEME_OUT=/tmp/hug-theme.css
EXPOSE 80
