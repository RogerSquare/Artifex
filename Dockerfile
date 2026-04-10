# ─── Stage 1: Build Frontend ───
FROM node:22-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ─── Stage 2: Production Image ───
FROM node:22-slim

# Install system dependencies: ffmpeg + Python
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Create Python venv and install ML dependencies
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir onnxruntime Pillow numpy && \
    pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu || \
    pip install --no-cache-dir torch && \
    pip install --no-cache-dir transformers

WORKDIR /app

# Install backend dependencies
COPY backend/package*.json ./
RUN npm ci --production

# Copy backend source
COPY backend/ ./

# Copy built frontend into backend/public for static serving
COPY --from=frontend-build /app/frontend/dist ./public

# Create directories
RUN mkdir -p uploads/thumbnails models/wd-swinv2-tagger-v3 data

# Environment variables with defaults
ENV NODE_ENV=production
ENV PORT=3002
ENV JWT_SECRET=""
ENV INSTANCE_NAME="Artifex Gallery"
ENV FEDERATION_ENABLED=true
ENV PUBLIC_URL=""
ENV DEFAULT_STORAGE_QUOTA=5368709120
ENV PYTHON_CMD=python3
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

# Expose port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http=require('http'); http.get('http://localhost:3002/api/health', r => { process.exit(r.statusCode===200?0:1) }).on('error', () => process.exit(1))"

# Volumes for persistence
VOLUME ["/app/uploads", "/app/data", "/app/models"]

# Start
CMD ["node", "server.js"]
