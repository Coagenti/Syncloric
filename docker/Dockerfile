# syntax=docker/dockerfile:1
# Syncloric — immagine multi-stage (docs/ARCHITECTURE.md § 2, § 3 docker/)
# deps → build → runner (node:22.20.0-bookworm-slim, output standalone Next)
FROM node:22.20.0-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22.20.0-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Le migrazioni sono versionate: generate in CI e committate (drizzle/).
RUN pnpm build
# La repo non ha ancora public/ (UI nei task feature): la creo perché la COPY
# statica nello stage runner non fallisca. Da rimuovere quando public/ esiste.
RUN mkdir -p /app/public

FROM node:22.20.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
USER nextjs
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]