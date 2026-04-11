![CI](https://github.com/RogerSquare/Artifex/actions/workflows/ci.yml/badge.svg)

# Artifex

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
- **Federation**: Peer-to-peer sync between Artifex instances
- **Video support**: Upload videos with automatic frame extraction and thumbnail generation
- **Rate limiting**: Built-in rate limiting on public-facing endpoints
- **API documentation**: Swagger UI available at `/api-docs`

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
    collections.js    # Collection CRUD
    federation.js     # Peer sync endpoints
    hub.js            # Discovery hub
  lib/
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
