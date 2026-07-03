# --- Budget tracker backend (Express + better-sqlite3) ---
# better-sqlite3 is a native addon; it ships prebuilt binaries for common
# platforms but falls back to compiling from source via node-gyp if no
# prebuild matches the target (Linux/musl vs glibc, Node ABI, arch). We build
# on Debian-based node:22-bookworm-slim (glibc) with python3/make/g++ present
# so that fallback always succeeds, then run on the same base image (no
# multi-stage split) since better-sqlite3 doesn't need the build toolchain to
# be excluded for the image to stay reasonably lean, and this keeps the
# Dockerfile simple/reproducible.
FROM node:22-bookworm-slim

WORKDIR /app

# Build tools for better-sqlite3's node-gyp fallback (only needed if no
# prebuilt binary matches; harmless/no-op otherwise, and keeps the image
# working across architectures without guessing which prebuild variant ships).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first (better layer caching on source-only changes).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application source. Migrations live under src/migrations and are read from
# disk at runtime (server/src/db.js), so they must be copied along with src/.
COPY src ./src

ENV NODE_ENV=production

# Fly.io convention: the app listens on the port given via the PORT env var
# (set in fly.toml's [env] block, not baked in here) and fly.toml's
# internal_port must match. 8080 is just the documented default/expected
# value — the server itself reads process.env.PORT at runtime either way.
EXPOSE 8080

CMD ["npm", "start"]
