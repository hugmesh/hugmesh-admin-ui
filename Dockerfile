# snapdragon-admin-ui — builds the Admin native-federation REMOTE
# (src → dist/admin) and serves it via nginx with CORS so the
# snapdragon.systems host can fetch its remoteEntry.json cross-origin.
# Deployed to the snapdragon-frontend namespace, fronted by the fe-gateway at
# /admin. Casdoor-admin-role guarded by the host.
# Angular CLI 22 requires Node >= 24.15.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:admin

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/admin/browser /usr/share/nginx/html
EXPOSE 80
