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
COPY --from=build /app/backend/drizzle ./backend/drizzle
COPY --from=build /app/backend/api/dist ./backend/api/dist
WORKDIR /app/backend
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
