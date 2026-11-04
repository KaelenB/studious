FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY backend/api/package.json ./backend/api/
RUN npm ci
COPY frontend ./frontend
COPY backend/api ./backend/api
RUN npm run build --workspace frontend

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
