# syntax=docker/dockerfile:1
#
# Polaris in one container: `docker compose up -d` (see docker-compose.yml and the README,
# "Deploying"). The SQLite database lives on a volume at /data; migrations run on every start.

FROM node:22-slim AS base
# Prisma's query engine links against OpenSSL, which the slim image leaves out.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- Build: every dependency, then `next build`.
FROM base AS build
# No git in the image, so there are no hooks for Husky to install.
ENV HUSKY=0
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
# Next.js writes next.config.ts's headers into the build, so HSTS is chosen here (README,
# "Security headers"). docker-compose.yml passes POLARIS_HSTS from .env as a build argument.
ARG POLARIS_HSTS=0
ENV POLARIS_HSTS=${POLARIS_HSTS}
RUN npm run build

# ---- Runtime dependencies only (the Prisma CLI is one: it runs the migrations).
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Husky (a dev dependency) is not installed, so drop the script that would call it.
RUN npm pkg delete scripts.prepare \
  && npm ci --omit=dev \
  && npx prisma generate \
  && npm cache clean --force

# ---- What runs.
FROM base AS runtime
ENV NODE_ENV=production \
  DATABASE_URL=file:/data/polaris.db \
  HOSTNAME=0.0.0.0 \
  PORT=3000
COPY --from=deps /app/node_modules ./node_modules
# `next start` reads next.config.ts with TypeScript's config reader (and would try to install
# TypeScript at startup without it). It has no dependencies of its own.
COPY --from=build /app/node_modules/typescript ./node_modules/typescript
COPY --from=build /app/.next ./.next
COPY package.json next.config.ts tsconfig.json ./
COPY src/lib/security ./src/lib/security
COPY prisma ./prisma
# The database volume belongs to the unprivileged `node` user the image provides (uid 1000).
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Migrations first (a no-op when there are none to apply), then the server, as PID 1's child
# replaced by exec so it receives the container's stop signal.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node_modules/.bin/next start"]
