const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { getDb } = require('./db');

// Ensure ffmpeg is accessible — set path explicitly for service manager environments
// Set ffmpeg path — env var, common locations, or PATH
const ffmpeg = require('fluent-ffmpeg');
const ffmpegCandidates = [
  [process.env.FFMPEG_PATH, process.env.FFPROBE_PATH],
  ['/usr/bin/ffmpeg', '/usr/bin/ffprobe'],
];
for (const [fp, probe] of ffmpegCandidates) {
  if (fp && fs.existsSync(fp)) {
    ffmpeg.setFfmpegPath(fp);
    if (probe) ffmpeg.setFfprobePath(probe);
    console.log('ffmpeg path:', fp);
    break;
  }
}

const PORT = process.env.PORT || 3002;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const THUMBNAILS_DIR = path.join(UPLOADS_DIR, 'thumbnails');

// Ensure directories exist
[UPLOADS_DIR, THUMBNAILS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const app = express();

// Security headers
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// CORS — restrict to allowed origins in production
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : null; // null = allow all in development

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, mobile apps, same-origin)
    if (!origin) return callback(null, true);
    // In development (no ALLOWED_ORIGINS set), allow everything
    if (!ALLOWED_ORIGINS) return callback(null, true);
    // In production, check against whitelist
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(express.json());

// ─── Rate Limiting ───
const rateLimit = require('express-rate-limit');

// Auth routes: strict — 10 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// Upload routes: 20 uploads per minute per IP
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Upload rate limit exceeded. Please wait a moment.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// General API: 200 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Please slow down.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// Federation: 30 requests per minute per IP
const federationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Federation rate limit exceeded.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// Apply rate limits
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/images/upload', uploadLimiter);
app.use('/api/federation', federationLimiter);
app.use('/api/', apiLimiter);

// API Documentation (Swagger UI)
const swaggerUi = require('swagger-ui-express');
const apiSpec = require('./api-spec.json');
app.get('/api/docs/spec.json', (req, res) => res.json(apiSpec));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(apiSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Artifex API Docs',
}));

// Static file serving for uploaded images
app.use('/uploads', express.static(UPLOADS_DIR));

// Serve frontend build in production (Docker)
const PUBLIC_DIR = path.join(__dirname, 'public');
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// Initialize database on startup
const db = getDb();
console.log(`Database initialized. Images table ready.`);

// Health & Monitoring
app.get('/api/health', (req, res) => {
  try {
    const os = require('os');
    const mem = process.memoryUsage();
    const images = db.prepare('SELECT COUNT(*) as c FROM images').get();
    const users = db.prepare('SELECT COUNT(*) as c FROM users').get();

    // DB file size
    let dbSize = 0;
    try { dbSize = fs.statSync(path.join(__dirname, 'gallery.db')).size; } catch (e) {}

    // Uploads disk usage
    let uploadsSize = 0;
    try {
      const walk = (dir) => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          const fp = path.join(dir, f.name);
          if (f.isDirectory()) walk(fp);
          else try { uploadsSize += fs.statSync(fp).size; } catch (e) {}
        }
      };
      walk(UPLOADS_DIR);
    } catch (e) {}

    // Disk free space
    let diskFree = null;
    try {
      const { execSync } = require('child_process');
      const drive = __dirname.charAt(0);
      const out = execSync(`wmic logicaldisk where "DeviceID='${drive}:'" get FreeSpace /value`, { encoding: 'utf8' });
      const match = out.match(/FreeSpace=(\d+)/);
      if (match) diskFree = parseInt(match[1]);
    } catch (e) {}

    // Job queue
    let jobs = { pending: 0, processing: 0, done: 0, failed: 0 };
    try {
      const stats = db.prepare('SELECT status, COUNT(*) as c FROM jobs GROUP BY status').all();
      stats.forEach(s => jobs[s.status] = s.c);
    } catch (e) {}

    // Python workers
    const wdTagger = require('./lib/wd-tagger');
    const captioner = require('./lib/captioner');

    res.json({
      status: 'ok',
      uptime: process.uptime(),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
      },
      system: {
        platform: os.platform(),
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        diskFree,
      },
      database: {
        images: images.c,
        users: users.c,
        sizeBytes: dbSize,
      },
      storage: {
        uploadsSizeBytes: uploadsSize,
      },
      jobs,
      workers: {
        wdTagger: wdTagger.isReady() ? 'running' : wdTagger.isAvailable() ? 'available' : 'unavailable',
        captioner: captioner.isReady() ? 'running' : captioner.isAvailable() ? 'available' : 'unavailable',
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// Prometheus-compatible metrics endpoint
app.get('/api/metrics', (req, res) => {
  try {
    const mem = process.memoryUsage();
    const os = require('os');
    const images = db.prepare('SELECT COUNT(*) as c FROM images').get();
    const users = db.prepare('SELECT COUNT(*) as c FROM users').get();

    let jobs = {};
    try {
      db.prepare('SELECT status, COUNT(*) as c FROM jobs GROUP BY status').all().forEach(s => jobs[s.status] = s.c);
    } catch (e) {}

    const lines = [
      '# HELP artifex_uptime_seconds Server uptime in seconds',
      '# TYPE artifex_uptime_seconds gauge',
      `artifex_uptime_seconds ${process.uptime().toFixed(0)}`,
      '',
      '# HELP artifex_memory_bytes Process memory usage',
      '# TYPE artifex_memory_bytes gauge',
      `artifex_memory_bytes{type="rss"} ${mem.rss}`,
      `artifex_memory_bytes{type="heap_used"} ${mem.heapUsed}`,
      `artifex_memory_bytes{type="heap_total"} ${mem.heapTotal}`,
      '',
      '# HELP artifex_images_total Total number of images',
      '# TYPE artifex_images_total gauge',
      `artifex_images_total ${images.c}`,
      '',
      '# HELP artifex_users_total Total number of users',
      '# TYPE artifex_users_total gauge',
      `artifex_users_total ${users.c}`,
      '',
      '# HELP artifex_system_memory_bytes System memory',
      '# TYPE artifex_system_memory_bytes gauge',
      `artifex_system_memory_bytes{type="total"} ${os.totalmem()}`,
      `artifex_system_memory_bytes{type="free"} ${os.freemem()}`,
      '',
      '# HELP artifex_jobs_total Job queue counts by status',
      '# TYPE artifex_jobs_total gauge',
      `artifex_jobs_total{status="pending"} ${jobs.pending || 0}`,
      `artifex_jobs_total{status="processing"} ${jobs.processing || 0}`,
      `artifex_jobs_total{status="done"} ${jobs.done || 0}`,
      `artifex_jobs_total{status="failed"} ${jobs.failed || 0}`,
      '',
    ];

    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(lines.join('\n'));
  } catch (error) {
    res.status(500).send('# error\n');
  }
});

// Mount routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/images', require('./routes/images'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/collections', require('./routes/collections'));
app.use('/api/tags', require('./routes/tags'));
app.use('/api/federation', require('./routes/federation'));
app.use('/api/hub', require('./routes/hub'));

// Well-known federation manifest
app.get('/.well-known/artifex.json', (req, res) => {
  try {
    const db = getDb();
    const enabled = db.prepare("SELECT value FROM instance_settings WHERE key = 'federation_enabled'").get();
    if (enabled?.value !== 'true') return res.status(404).json({ error: 'Federation not enabled' });

    const federation = require('./routes/federation');
    // Redirect to the manifest endpoint
    res.redirect('/api/federation/manifest');
  } catch (e) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// ─── API 404 Handler ───
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// SPA catch-all — serve index.html for non-API routes (production/Docker)
if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
}

// ─── Global Error Handler ───
// Catches errors thrown/next(err) in routes — sanitizes before sending to client
const logger = require('./lib/logger');

app.use((err, req, res, next) => {
  // Log full error server-side
  logger.error('Unhandled route error', {
    method: req.method,
    path: req.path,
    status: err.status || 500,
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    userId: req.user?.id,
    ip: req.ip,
  });

  // Send sanitized response to client
  const status = err.status || 500;
  if (status >= 500) {
    res.status(status).json({ error: 'An internal error occurred. Please try again.' });
  } else {
    res.status(status).json({ error: err.message });
  }
});

// ─── Error Handling ───
// Catch async errors from background ML tasks (don't crash the server)
process.on('unhandledRejection', (reason) => {
  console.error('[ERROR] Unhandled rejection:', reason?.message || reason);
});

// Let truly fatal sync errors crash — process manager should restart
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.message);
  console.error(err.stack);
  // Give time for logs to flush, then exit
  setTimeout(() => process.exit(1), 1000);
});

// ─── Start Server ───
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Artifex backend running on http://0.0.0.0:${PORT}`);
  console.log(`Uploads served from ${UPLOADS_DIR}`);

  // Start background job queue for ML tagging
  const jobQueue = require('./lib/job-queue');
  jobQueue.start();

  // Start federation sync engine (if enabled)
  const fedEnabled = db.prepare("SELECT value FROM instance_settings WHERE key = 'federation_enabled'").get();
  if (fedEnabled?.value === 'true') {
    const federationSync = require('./lib/federation-sync');
    federationSync.start();
  }

  // Start hub push (if hub_url is configured)
  const hubUrl = db.prepare("SELECT value FROM instance_settings WHERE key = 'hub_url'").get();
  if (hubUrl?.value) {
    const hubPush = require('./lib/hub-push');
    hubPush.start();
  }
});

// ─── Graceful Shutdown ───
const SHUTDOWN_TIMEOUT = 30000; // 30 seconds max
let shuttingDown = false;

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[Shutdown] ${signal} received. Shutting down gracefully...`);

  // Force exit after timeout
  const forceTimer = setTimeout(() => {
    console.error('[Shutdown] Timeout — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);
  forceTimer.unref();

  // 1. Stop accepting new connections
  server.close(() => {
    console.log('[Shutdown] HTTP server closed');
  });

  // 2. Stop job queue
  try {
    const jobQueue = require('./lib/job-queue');
    jobQueue.stop();
    console.log('[Shutdown] Job queue stopped');
  } catch (e) {}

  // 3. Shut down Python workers
  try {
    const wdTagger = require('./lib/wd-tagger');
    wdTagger.shutdown();
    console.log('[Shutdown] WD Tagger worker stopped');
  } catch (e) {}

  try {
    const captioner = require('./lib/captioner');
    captioner.shutdown();
    console.log('[Shutdown] Captioner worker stopped');
  } catch (e) {}

  // 4. Close database
  try {
    const { getDb } = require('./db');
    getDb().close();
    console.log('[Shutdown] Database closed');
  } catch (e) {}

  console.log('[Shutdown] Complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { app, server, UPLOADS_DIR, THUMBNAILS_DIR };
