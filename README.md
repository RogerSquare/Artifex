![CI](https://github.com/RogerSquare/Artifex/actions/workflows/ci.yml/badge.svg)


<img width="1870" height="1382" alt="Screenshot 2026-04-16 at 02-29-52 Artifex" src="https://github.com/user-attachments/assets/90974f60-7541-4dd5-84b4-ebcc913c7462" />
<img width="1870" height="1382" alt="Screenshot 2026-04-16 at 02-30-39 Artifex" src="https://github.com/user-attachments/assets/1a65c6af-d9cc-400d-b046-a3e7c6190fba" />


# Artifex

> Self-hosted AI image gallery with Python-subprocess ML pipelines, SQLite FTS5 search, and federation across instances.

**Live demo:** Screenshots in `/docs/screenshots/`; local run via `docker compose up`
**Stack:** Node.js / Express 5 · React · SQLite (better-sqlite3) · Python subprocess ML (WD Tagger, BLIP, NSFW detector) · JWT auth · Socket.io
**Status:** Active

## What's interesting technically

ML inference doesn't run in Node (onnxruntime-node has opset compatibility issues on Windows). Instead, each ML task runs as a **persistent Python HTTP server** that the Node backend calls over localhost. The server loads the model once on first request (~3s) and serves subsequent classifications in ~200ms — auto-starts on first use, auto-shuts down with the Node process. This keeps the ML pipeline decoupled from the Node runtime: upgrade path is swap the Python server for a different model runtime without touching the queueing or API layer. Federation uses a manifest + metadata-sync pattern: admins keep a simple list of peer URLs, full image metadata (prompts, workflow JSON, video details) syncs into a local cache for browsing, and media loads full-quality directly from the source peer in the browser via CORS-enabled federation endpoints — no central registry, no proxy bandwidth.

A self-hosted AI image gallery with ML-powered auto-tagging, content analysis, and federation support. Artifex lets you upload, organize, search, and share AI-generated images with intelligent metadata extraction handled automatically in the background.

## Overview

Artifex is a full-stack application split into a Node.js backend and a React frontend. When images are uploaded, a background job queue processes them through multiple ML pipelines: WD Tagger classifies content tags, BLIP generates natural language captions, and a NSFW detector flags sensitive content. All metadata is indexed in SQLite for fast full-text search.

The application supports multi-user authentication with role-based access, image collections, and a federation system that allows multiple Artifex instances to sync and share galleries with each other.

## Architecture

- **Backend**: Express 5, SQLite (better-sqlite3), JWT authentication
- **Frontend**: React 19, Vite, Tailwind CSS 4
- **ML Vision**: Python subprocess servers for WD Tagger (port 7865) and BLIP Captioner (port 7866)
- **ML NSFW**: AdamCodd/vit-base-nsfw-detector via @huggingface/transformers in Node
- **Job Queue**: SQLite-backed, polls every 3 seconds, single concurrency
- **Media Processing**: Sharp for image manipulation, FFmpeg for video frame extraction

## Features

- **Auto-tagging**: Images are automatically classified with content tags via WD Tagger (SwinV2)
- **Caption generation**: BLIP generates natural language descriptions for each image
- **NSFW detection**: Content is automatically flagged using a ViT-based classifier
- **Full-text search**: Search across tags, captions, filenames, and metadata
- **Collections**: Organize images into named collections
- **Multi-user auth**: JWT-based authentication with admin and standard roles
- **Federation**: Peer-to-peer galleries — add peer URLs, browse their public images and videos at full quality with complete metadata
- **Video support**: Upload videos with automatic frame extraction and thumbnail generation
- **Rate limiting**: Built-in rate limiting on public-facing endpoints
- **API documentation**: Swagger UI available at `/api-docs`

## Federation

Artifex instances federate directly with each other — no central registry, no relay, no account on the other side.

### How it works

- **Simple peer list** — an admin adds another instance by URL in *Admin → Federation*. The peer is verified through its `/api/federation/manifest` before it's saved (bare `ip:port` works as long as the instance answers).
- **Full-metadata sync** — a background engine (30-minute interval, plus manual sync) pulls each peer's public catalog into a local cache: prompts, negative prompts, workflow JSON, sampler/steps/CFG/seed, video metadata, and file hashes. Browsing and search keep working while a peer is offline. Thumbnails are cached to disk, and failed thumbnail downloads self-heal on later sync cycles.
- **Direct media loading** — full-resolution images and videos are never mirrored or proxied. The viewer's browser streams them straight from the source peer's CORS-enabled endpoints (`/api/federation/media/:id/full`, `/media/:id/preview`, `/image/:id/thumbnail`). Only `visibility: public` items are ever served to peers.
- **Cached vs Live, per peer** — each peer runs in *Cached* mode (default: metadata + thumbnails stored locally) or *Live* mode (nothing stored: feeds query the peer at browse time with a short cache, and its items simply drop out of feeds while it's offline). Switching to Live purges everything cached from that peer; switching back triggers a fresh full sync.
- **Live status** — peer online/offline dots update within ~10 seconds via a lightweight health poll, independent of sync state.
- **One merged library** — peer content shows in the Network tab and interleaves into the Public and All tabs, deduplicated against local copies by file hash (a local copy always wins). Remote images support compare, selection, and saving to collections (by reference — Cached peers only), and uploader names link to the profile on the source instance.

### Requirements and limits

- Peers must be reachable from the **viewer's browser** (LAN or public URL) since media loads directly; use matching http/https schemes to avoid mixed-content blocking. Set `PUBLIC_URL` so peers and their browsers know how to reach you.
- Federation endpoints are public-read by design: only public images are exposed, no peer-to-peer credentials are exchanged, and a dedicated rate limit (300 req/min/IP) covers the media-heavy direct-load traffic.
- Toggling federation on/off in the admin panel applies at runtime — no restart needed.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Backend Framework | Express 5 |
| Database | SQLite (better-sqlite3) |
| Frontend Framework | React 19 |
| Bundler | Vite 8 |
| CSS | Tailwind CSS 4 |
| Auth | JSON Web Tokens (bcryptjs) |
| Image Processing | Sharp |
| Video Processing | FFmpeg (fluent-ffmpeg) |
| ML Inference | ONNX Runtime, @huggingface/transformers |
| ML Vision Servers | Python (WD Tagger, BLIP) |
| Icons | Phosphor Icons |
| Testing | Jest, Supertest |
| Linting | ESLint with security plugin |

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.10+ (for ML vision servers)
- FFmpeg (for video processing)

### Installation

```bash
# Clone the repository
git clone https://github.com/RogerSquare/Artifex.git
cd Artifex

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### Configuration

Copy the environment example file and configure it:

```bash
cp .env.example .env
```

Key environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | Secret for signing auth tokens | Auto-generated on first run |
| `PORT` | Backend server port | 3002 |
| `FFMPEG_PATH` | Path to FFmpeg binary | System PATH |
| `FFPROBE_PATH` | Path to FFprobe binary | System PATH |
| `PUBLIC_URL` | This instance's URL as peers and their browsers reach it (seeds instance settings on first boot; admin UI owns it after) | — |
| `INSTANCE_NAME` | Display name shown to federation peers (first boot only) | Artifex Gallery |
| `FEDERATION_ENABLED` | Enable federation on first boot (toggleable later in the admin UI) | false (`true` in docker-compose) |

### Running

```bash
# Start the backend
cd backend
node server.js

# Start the frontend (separate terminal)
cd frontend
npm run dev
```

The backend runs on port 3002 and the frontend on port 5175 by default.

### Docker

A `docker-compose.yml` is provided for containerized deployment:

```bash
docker compose up -d
```

### Testing

```bash
cd backend
npm test        # Run 65 integration tests
npm run lint    # Run ESLint with security rules
```

## Project Structure

```
backend/
  server.js           # Express app entry point
  db.js               # SQLite schema and migrations
  routes/
    images.js         # Image upload, search, CRUD
    auth.js           # Login, registration, token refresh
    admin.js          # User management, system settings
    tags.js           # Tag management and search
    collections.js    # Collection CRUD (local + remote references)
    federation.js     # Peer management, public federation API, feeds
  lib/
    federation-sync.js # Pull-sync engine (metadata + thumbnail cache)
    federation-feed.js # Live-mode peer feed assembly
    federation-urls.js # Direct browser-to-peer media URLs
    jobQueue.js       # Background ML processing queue
    authMiddleware.js # JWT verification middleware
    visionClient.js   # Python ML server communication
    nsfwClassifier.js # Node-based NSFW detection

frontend/
  src/
    App.jsx           # Root component and routing
    components/       # React components
    config.js         # API endpoint configuration
```

## License

MIT
