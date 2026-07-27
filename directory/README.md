# Artifex Directory

A standalone, community-hostable registry where Artifex instances that opted into discovery appear on a public list. **Registry only** — no images or thumbnails pass through it; peering stays direct between instances.

## Run

```bash
cd directory
docker compose up -d          # serves on port 3090
```

Point instances at it: set `DIRECTORY_URL=https://your-directory.example.com` (or configure it in Admin → Federation) and flip **List in public directory** on.

## Behavior

- **Register/heartbeat**: an instance self-registers; the directory verifies it by fetching the instance's own manifest (must be a reachable Artifex with federation *and* discovery enabled). Instances re-register every 6 hours.
- **Freshness**: entries unseen for 24 hours are hidden from the list; entries unseen for 7 days are deleted.
- **Unregister**: proven by re-probing — a listing is removed only when its instance is unreachable or has discovery turned off, so nobody can delist an instance they don't control.
- Register/unregister are rate-limited (10/min per IP); the list is public and CORS-open.

## API

| Route | Purpose |
|---|---|
| `POST /api/directory/register` `{url}` | Register or heartbeat |
| `POST /api/directory/unregister` `{url}` | Remove (verified by re-probe) |
| `GET /api/directory/instances` | Public list of fresh instances |
| `GET /api/health` | Health + listing count |
