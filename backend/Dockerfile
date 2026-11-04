FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY backend/api/package.json ./backend/api/
RUN npm ci
COPY backend ./backend
RUN npm run build --workspace @studious/backend

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY backend/api/package.json ./backend/api/
RUN npm ci --omit=dev --workspace @studious/backend --include-workspace-root
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/api/dist ./backend/api/dist
WORKDIR /app/backend
RUN mkdir -p data && chown node:node data
USER node
VOLUME /app/backend/data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
