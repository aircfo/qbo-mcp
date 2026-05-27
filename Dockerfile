FROM node:22-bookworm-slim

# Toolchain for better-sqlite3's native build (used if no prebuilt binary matches).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable

# Install dependencies first for layer caching. The pnpm.onlyBuiltDependencies
# allowlist in package.json lets better-sqlite3 run its build script.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Build TypeScript -> dist, then drop devDependencies for a leaner runtime.
COPY . .
RUN pnpm build && pnpm prune --prod

ENV NODE_ENV=production
# Railway injects PORT at runtime; the app reads it. EXPOSE is informational.
EXPOSE 8080
CMD ["node", "dist/index.js"]
