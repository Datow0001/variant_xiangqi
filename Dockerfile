# ==============================================================================
# Stage 1: Build Frontend (Vite + Vue 3)
# ==============================================================================
FROM node:20-slim AS frontend-builder
WORKDIR /app

# 複製 package 設定
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/

# 安裝依賴
RUN npm run install:all

# 複製原始碼並建置前端
COPY shared/ ./shared/
COPY frontend/ ./frontend/
RUN npm run build:frontend

# ==============================================================================
# Stage 2: Production Runner (Google Cloud Run / Linux Container)
# ==============================================================================
FROM node:20-slim AS runner
WORKDIR /app

# 安裝必要系統套件 (curl 下載與 C++ 運行庫)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# 下載官方 Linux x86-64 版 Fairy-Stockfish Largeboard 象棋引擎
RUN mkdir -p /app/engine && \
    curl -L -o /app/engine/fairy-stockfish-largeboard_x86-64 \
    https://github.com/fairy-stockfish/Fairy-Stockfish/releases/download/fairy_sf_14/fairy-stockfish-largeboard_x86-64 && \
    chmod +x /app/engine/fairy-stockfish-largeboard_x86-64

# 複製依賴與安裝後端
COPY package*.json ./
COPY backend/package*.json ./backend/
RUN npm install --prefix backend

# 複製設定檔與後端原始碼
COPY variants.ini ./variants.ini
COPY shared/ ./shared/
COPY backend/ ./backend/

# 從第一階段複製建置完成的前端靜態資源
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# 環境變數 (GCP Cloud Run 會自動帶入 PORT，預設為 8080)
ENV PORT=8080
ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV ENGINE_PATH=/app/engine/fairy-stockfish-largeboard_x86-64
ENV VARIANT_PATH=/app/variants.ini

EXPOSE 8080

CMD ["npm", "run", "start"]
