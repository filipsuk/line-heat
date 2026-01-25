FROM node:24-bookworm-slim

WORKDIR /app

# better-sqlite3 builds native bindings on install.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    sqlite3 \
  && rm -rf /var/lib/apt/lists/*

# Install deps (workspace-aware). Copy package manifests first for layer caching.
COPY package.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/server/package.json packages/server/package.json
RUN npm install --no-package-lock --no-audit --no-fund

# Copy sources and build.
COPY packages/protocol packages/protocol
COPY packages/server packages/server
RUN npm run build -w @line-heat/protocol \
  && npm run build -w @line-heat/server

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

CMD ["node", "packages/server/dist/index.js"]
