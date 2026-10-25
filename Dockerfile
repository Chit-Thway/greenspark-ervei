# Single-container image for Coolify, Fly or any Docker host: the API and the built web app.
# Layers go from least to most often changed, so a code-only change reuses the installed packages and the data.
FROM node:22-slim
WORKDIR /app

# 1. Dependencies: only reinstalled when a package.json or the lock file changes. The e2e workspace (Playwright)
#    isn't needed in the image.
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY shared/package.json shared/
COPY web/package.json web/
COPY e2e/package.json e2e/
RUN npm ci -w api -w shared -w web --include-workspace-root --no-audit --no-fund

# 2. Data: only re-copied when it changes. The full import arrives compressed, as committed (see .dockerignore).
COPY data ./data
RUN for f in data/synthetic/accounts.all.jsonl.gz data/synthetic/case-queue.all.json.gz; do if [ -f "$f" ]; then gunzip -f "$f"; fi; done

# 3. Code: changes most often, so it comes last.
COPY . .
RUN npm run build

ENV NODE_ENV=production PORT=3001 \
    GREENSPARK_DB=/data/greenspark.sqlite \
    GREENSPARK_FLOW_FILE=/data/utility_hardship_mapping.json
EXPOSE 3001
# Node starts directly (not via npm or the tsx CLI) to save ~100 MB of memory.
# /data is the persistent volume. The hardship JSON is copied there on first start only, so Admin edits survive redeploys.
CMD ["sh", "-c", "mkdir -p /data && [ -f \"$GREENSPARK_FLOW_FILE\" ] || cp data/admin/utility_hardship_mapping.json \"$GREENSPARK_FLOW_FILE\"; cd api && exec node --import tsx src/server.ts"]
