# Artifex Project Instructions

## Project Architecture
- **Backend**: Express 5 + SQLite (better-sqlite3) on port 3002
- **Frontend**: React 19 + Vite + Tailwind CSS 4 on port 5175
- **ML Vision**: Python subprocess servers — WD Tagger (port 7865), BLIP Captioner (port 7866)
- **ML NSFW**: AdamCodd/vit-base-nsfw-detector via @huggingface/transformers in Node
- **Icons**: Phosphor Icons (@phosphor-icons/react) — NOT Lucide
- **Job Queue**: SQLite-backed, polls every 3s, concurrency 1

## Key File Locations

### Backend (`backend/`)
- `server.js` — Express app, middleware, health/metrics, graceful shutdown
- `db.js` — SQLite schema, migrations (`addColumnIfMissing`), FTS5 index
- `routes/images.js` — Upload, CRUD, search, favorites, visibility, batch ops
- `routes/auth.js` — Register, login, password, profiles
- `routes/admin.js` — Users, purge, orphans, stats, audit, quotas
- `routes/tags.js` — Tags CRUD, vision/nsfw/caption batch, job queue
- `routes/collections.js` — Collection CRUD, reorder
- `routes/federation.js` — Federation API, peer management, proxy endpoints
- `routes/hub.js` — Hub/directory service, push/pull relay
- `lib/tagger.js` — Orchestrates WD Tagger + CLIP, contradiction filtering
- `lib/wd-tagger.js` — Python subprocess client for WD Tagger
- `lib/vision-tagger.js` — CLIP zero-shot classification
- `lib/nsfw-detector.js` — AdamCodd NSFW binary classifier
- `lib/captioner.js` — Python subprocess client for BLIP captioner
- `lib/job-queue.js` — SQLite-backed background job processor
- `lib/federation-sync.js` — Peer sync engine (incremental, thumbnail caching)
- `lib/hub-push.js` — Push client for no-domain instances
- `lib/audit.js` — Audit logging utility
- `lib/logger.js` — Structured JSON logger
- `lib/authMiddleware.js` — JWT auth (requireAuth, optionalAuth)
- `lib/video-frames.js` — ffmpeg keyframe extraction
- `lib/thumbnail.js` — Thumbnail, preview, analysis image generation
- `scripts/wd-tagger.py` — WD Tagger Python server
- `scripts/captioner.py` — BLIP captioner Python server
- `api-spec.json` — OpenAPI 3.0 spec (Swagger UI at /api/docs)

### Frontend (`frontend/src/`)
- `App.jsx` — Main app, routing, state management
- `config.js` — API_URL='/api', UPLOADS_URL='/uploads' (relative paths)
- `components/Header.jsx` — Navigation tabs, search, user menu
- `components/GalleryGrid.jsx` — Masonry image grid with reorder support
- `components/ImageCard.jsx` — Individual card with peer badge support
- `components/PhotoViewer.jsx` — Full-screen viewer with metadata panel
- `components/MetadataPanel.jsx` — Tags, prompts, workflow, parameters
- `components/CollectionDetail.jsx` — Collection view with select/reorder
- `components/FederatedGrid.jsx` — Network tab for federated images
- `components/AdminSettings.jsx` — 8-tab admin dashboard
- `components/StatsDashboard.jsx` — Generation stats with charts
- `components/ShortcutsOverlay.jsx` — Keyboard shortcuts help
- `components/ErrorBoundary.jsx` — React error boundary
- `components/LoginPage.jsx` — Auth with password strength indicator
- `components/UploadZone.jsx` — Upload modal with paste/drag support
- `components/SearchFilterBar.jsx` — Filter dropdowns and tag pills

## Service Management
Use the opus-board API to start/stop services — **never raw shell commands**.
- Backend service ID: `artifex-backend`
- Frontend service ID: `artifex-frontend`
- Start: `POST http://localhost:3001/api/services/artifex-backend/start`
- Stop: `POST http://localhost:3001/api/services/artifex-backend/stop`
- Restart: `POST http://localhost:3001/api/services/artifex-backend/restart`

## How to Test
```bash
cd backend
npm test          # 65 integration tests (auth, images, security)
npm run lint      # ESLint security scan
```
- Tests use isolated temp DB via `ARTIFEX_DB_PATH` env var
- Tests skip rate limiting via `NODE_ENV=test`
- Security test suite covers: password policy, JWT, access control, error sanitization, data integrity, search privacy

## Database Patterns
- **Migrations**: Use `addColumnIfMissing(table, column, definition)` in `db.js` — never ALTER TABLE directly
- **FTS5**: `images_fts` virtual table indexes title, original_name, prompt, negative_prompt, model, caption. Rebuilds on startup.
- **Transactions**: All multi-step deletes wrapped in `db.transaction()` — files deleted AFTER transaction commits
- **Delete completeness**: When adding a new file field (e.g., `analysis_path`), update ALL delete paths:
  - `routes/images.js` — single image delete
  - `routes/admin.js` — user data purge, account delete, orphan purge

## Background ML Pipeline
On image upload:
1. Metadata tags extracted synchronously (fast)
2. Jobs enqueued: `nsfw`, `vision`, `caption`
3. Job queue processes sequentially (concurrency 1):
   - NSFW detection (AdamCodd model via Transformers.js)
   - Vision tagging (WD Tagger via Python + CLIP via Transformers.js)
   - Caption generation (BLIP large via Python)
4. Tags stored in `image_tags` table, caption in `images.caption`

## Federation
- Instance identity in `instance_settings` table (UUID, name, URL)
- Federation disabled by default — admin enables via settings
- Peers in `peers` table, synced content in `remote_images`
- Hub mode: any instance can be a hub (toggle `hub_mode` setting)
- Push relay: no-domain instances push to hub via `POST /api/hub/push`
- Remote images flagged with `is_remote: true` in API responses

## Docker
- Multi-stage Dockerfile: frontend build → production image (Node + Python + ffmpeg)
- DB path: `ARTIFEX_DB_PATH=/app/data/gallery.db` (volume mount)
- Express 5: use `app.use((req, res, next) => ...)` for catch-all, NOT `app.get('*', ...)`
- ffmpeg path: auto-detected from env → Windows → Linux candidates
- JWT_SECRET required in production (`NODE_ENV=production`)

## Known Gotchas
1. **JWT secret**: Auto-generated in `.jwt-secret` file. Required via `JWT_SECRET` env in production. Never hardcode.
2. **Python workers**: Start lazily on first ML request. Auto-shutdown on process exit. If they crash, `serverReady` resets but no auto-restart (yet).
3. **WD Tagger**: Runs via Python subprocess because onnxruntime-node segfaults on opset 24 models on Windows.
4. **Drag events**: `<main>` has drag-upload handlers. They check `e.dataTransfer.types.includes('Files')` to not interfere with internal reorder drags.
5. **CSS overflow vs sticky**: `position: sticky` doesn't work inside `overflow: hidden`. Use flex layout with scrollable middle section instead.
6. **Express 5 path-to-regexp**: `app.get('*')` throws. Use `app.use()` middleware for catch-all routes.
7. **Inline styles vs Tailwind**: `style={{ padding: '16px' }}` overrides Tailwind utilities. Use CSS classes with `!important` for responsive overrides.
8. **readFileSync**: Never use for large files (blocks event loop). Use `createReadStream` for hashing.
9. **Fixed mobile bars**: Bottom tab bar is `fixed`. App shell height must be `calc(100dvh - 56px)` on mobile so scroll area doesn't extend behind it.
10. **useEffect dependencies**: Always verify the dependency array matches the state being saved. `[theme]` instead of `[gridSize]` causes silent bugs.

## Pre-Change Checklist
Before submitting any change:
- [ ] `npm test` passes (65 tests)
- [ ] `npm run lint` — 0 errors
- [ ] New endpoints have proper auth + validation + error sanitization
- [ ] New file fields added to ALL delete/cleanup paths
- [ ] UI changes tested at 375px mobile width
- [ ] Docker build still works (if applicable)
