# syntax=docker/dockerfile:1

FROM node:22-bookworm AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/ens/package.json packages/ens/
COPY packages/roster/package.json packages/roster/
COPY packages/contracts/package.json packages/contracts/
COPY packages/world-id/package.json packages/world-id/
RUN pnpm install --frozen-lockfile
COPY . .
# Vite bakes these into the client at build time (apps/web/vite.config.ts envPrefix).
# CI passes --build-arg; App Platform injects BUILD_TIME env as build-args.
ARG ENS_LABEL
ARG VITE_SEPOLIA_RPC_URL
ENV ENS_LABEL=$ENS_LABEL
ENV VITE_SEPOLIA_RPC_URL=$VITE_SEPOLIA_RPC_URL
RUN if [ -z "${ENS_LABEL}" ] || [ -z "${VITE_SEPOLIA_RPC_URL}" ]; then \
      echo "ENS_LABEL and VITE_SEPOLIA_RPC_URL are required at image build time. See .env.example." >&2; \
      exit 1; \
    fi
RUN pnpm --filter @horror-tube/world-id build
RUN pnpm --filter @horror-tube/web build
RUN pnpm --filter @horror-tube/server build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV STATIC_DIR=/app/apps/web/dist
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/world-id/package.json ./packages/world-id/
COPY --from=build /app/packages/world-id/dist ./packages/world-id/dist
COPY --from=build /app/packages/world-id/node_modules ./packages/world-id/node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/web/dist ./apps/web/dist
WORKDIR /app/apps/server
CMD ["node", "dist/index.js"]
