# ─── Stage 1: Builder ────────────────────────────────────────
FROM node:20-alpine AS builder

LABEL maintainer="TinkClaw <forge@tinkclaw.com>"
LABEL version="0.1.0"
LABEL description="MeshCue Forge — the hardware compiler MCP server"

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# ─── Stage 2: Runner ────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Install Python 3 + pip for CadQuery/SKiDL sidecar
RUN apk add --no-cache \
    python3 \
    py3-pip \
    py3-numpy \
    openscad \
    && python3 -m pip install --break-system-packages cadquery skidl 2>/dev/null || true

# Create non-root user
RUN addgroup -S forge && adduser -S forge -G forge

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R forge:forge /app/data

# Switch to non-root user
USER forge

# Expose MCP stdio port and health check port
EXPOSE 3000 8080

# Health check — hit the health endpoint every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8080/health || exit 1

ENV NODE_ENV=production
ENV FORGE_DATA_DIR=/app/data

CMD ["node", "dist/index.js"]
