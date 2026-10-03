# Linux amd64 is required by the pinned Fairy-Stockfish executable.
FROM node:24-bookworm-slim AS engine
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY deployment/engine.sha256 /tmp/engine.sha256
RUN mkdir -p /app/engine && curl --fail --location --retry 3 \
    --connect-timeout 20 --max-time 180 \
    https://github.com/fairy-stockfish/Fairy-Stockfish/releases/download/fairy_sf_14/fairy-stockfish-largeboard_x86-64 \
    --output /app/engine/fairy-stockfish-largeboard_x86-64 \
    && cd /app/engine && sha256sum --check /tmp/engine.sha256 \
    && chmod 755 fairy-stockfish-largeboard_x86-64

FROM engine AS verify
WORKDIR /app
COPY package.json ./
COPY backend/package.json backend/package-lock.json ./backend/
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --include=dev --prefix backend && npm ci --include=dev --prefix frontend
COPY shared/ ./shared/
COPY backend/src/ ./backend/src/
COPY backend/tsconfig.json ./backend/
COPY frontend/ ./frontend/
COPY variants.ini ./
COPY scripts/ ./scripts/
COPY cloudbuild.yaml Dockerfile .dockerignore ./
ENV ENGINE_PATH=/app/engine/fairy-stockfish-largeboard_x86-64 \
    VARIANT_PATH=/app/variants.ini
# The default runtime target depends on all Linux tests and the 12-level proof.
RUN npm run typecheck:backend && npm run build:frontend \
    && npm test && npm run test:deployment && npm run verify:challenges

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=verify /app/package.json ./
COPY --from=verify /app/backend/ ./backend/
COPY --from=verify /app/shared/ ./shared/
COPY --from=verify /app/variants.ini ./
COPY --from=verify /app/engine/ ./engine/
COPY --from=verify /app/frontend/dist/ ./frontend/dist/
ARG BUILD_COMMIT=development
ENV PORT=8080 HOST=0.0.0.0 NODE_ENV=production \
    ENGINE_PATH=/app/engine/fairy-stockfish-largeboard_x86-64 \
    VARIANT_PATH=/app/variants.ini APP_VERSION=${BUILD_COMMIT} \
    MAX_ENGINES=4 MAX_SESSIONS=32 ENGINE_THREADS=1 ENGINE_HASH_MB=16
# Validate the final image, including HTTP assets, WebSockets, AI and reconnect.
USER node
RUN npm run smoke:deployment --prefix backend -- --self-host --expect-version "$APP_VERSION"
EXPOSE 8080
CMD ["npm", "run", "start"]
