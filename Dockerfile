# Single-container image for Coolify (or any Docker host): API + built web app.
FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm ci && npm run build
# The full import's accounts arrive compressed (see .dockerignore); unpack them when present.
RUN if [ -f data/synthetic/accounts.all.jsonl.gz ]; then gunzip -f data/synthetic/accounts.all.jsonl.gz; fi
ENV NODE_ENV=production PORT=3001 \
    GREENSPARK_DB=/data/greenspark.sqlite \
    GREENSPARK_FLOW_FILE=/data/utility_hardship_mapping.json
EXPOSE 3001
# Node starts directly (not via npm or the tsx CLI) to save ~100 MB of memory.
# /data is the persistent volume. The hardship JSON is copied there on first start only, so Admin edits survive redeploys.
CMD ["sh", "-c", "mkdir -p /data && [ -f \"$GREENSPARK_FLOW_FILE\" ] || cp data/admin/utility_hardship_mapping.json \"$GREENSPARK_FLOW_FILE\"; cd api && exec node --import tsx src/server.ts"]
