# snapdragon-admin-ui — builds the Admin native-federation REMOTE
# (src → dist/admin) and serves it via nginx with CORS so the
# snapdragon.systems host can fetch its remoteEntry.json cross-origin.
# Deployed to the snapdragon-frontend namespace, fronted by the fe-gateway at
# /admin. Casdoor-admin-role guarded by the host.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build:admin

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/admin/browser /usr/share/nginx/html
EXPOSE 80
