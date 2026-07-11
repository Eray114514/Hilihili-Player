# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/backend-runtime/package.json ./apps/backend-runtime/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/db/package.json ./packages/db/
COPY packages/media/package.json ./packages/media/
COPY packages/recommendation/package.json ./packages/recommendation/
COPY packages/shared/package.json ./packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM build AS backend-deploy
RUN pnpm --filter @hilihili/backend-runtime deploy --prod /prod/backend

FROM node:24-bookworm-slim AS backend
ENV NODE_ENV=production
ENV HILI_FFMPEG_PATH=/usr/bin/ffmpeg
ENV HILI_FFPROBE_PATH=/usr/bin/ffprobe
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=backend-deploy /prod/backend ./
# 以 root 运行：named volume 挂载的 /data 可能含旧镜像以 root 创建的
# db/wal/shm 文件，USER node 会导致 SQLITE_READONLY 崩溃循环。
# LAN-only 自托管场景，root 运行可接受且彻底避免权限问题。
RUN mkdir -p /data
EXPOSE 4141
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://localhost:4141/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "node_modules/@hilihili/api/src/index.ts"]

FROM node:24-bookworm-slim AS web
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
RUN chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://localhost:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
