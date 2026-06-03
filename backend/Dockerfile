# Backend-image — geschikt voor Coolify (Dockerfile-build) of docker compose.
# Multi-stage: native build van better-sqlite3 in de builder, slanke runtime.

# ---- builder ----
FROM node:22-slim AS builder
WORKDIR /app
# Build-tools voor de native compile van better-sqlite3 (fallback als er geen prebuilt is).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# ---- runtime ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app ./
# Map voor een eventueel SQLite-bestand: zet DB_FILE=/data/budget.db en mount een volume op /data.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 4000
# Coolify/compose health: /health geeft { ok: true }.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
