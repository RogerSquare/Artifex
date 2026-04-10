/**
 * Lightweight SQLite-backed job queue for background ML tasks.
 * No external dependencies (no Redis/BullMQ).
 *
 * Job types: 'nsfw', 'vision', 'caption'
 * Statuses: 'pending', 'processing', 'done', 'failed'
 */

const { getDb } = require('../db');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const POLL_INTERVAL = 3000; // Check for new jobs every 3s
const CONCURRENCY = 1;      // Process one job at a time (ML models are heavy)

let running = false;
let processing = 0;
let pollTimer = null;

/**
 * Enqueue ML jobs for an image (nsfw, vision, caption)
 */
function enqueueImageJobs(imageId) {
  const db = getDb();
  const insert = db.prepare('INSERT INTO jobs (image_id, type) VALUES (?, ?)');
  const enqueue = db.transaction(() => {
    insert.run(imageId, 'nsfw');
    insert.run(imageId, 'vision');
    insert.run(imageId, 'caption');
  });
  enqueue();
}

/**
 * Get the next pending job (oldest first, respecting retry delay)
 */
function claimNextJob() {
  const db = getDb();
  const job = db.prepare(`
    SELECT * FROM jobs
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
    ORDER BY created_at ASC
    LIMIT 1
  `).get();

  if (!job) return null;

  // Claim it
  db.prepare("UPDATE jobs SET status = 'processing', started_at = datetime('now') WHERE id = ?").run(job.id);
  return job;
}

/**
 * Mark job as done
 */
function completeJob(jobId) {
  const db = getDb();
  db.prepare("UPDATE jobs SET status = 'done', completed_at = datetime('now'), error = NULL WHERE id = ?").run(jobId);
}

/**
 * Mark job as failed with retry
 */
function failJob(jobId, errorMsg) {
  const db = getDb();
  const job = db.prepare('SELECT attempts, max_attempts FROM jobs WHERE id = ?').get(jobId);
  const attempts = (job?.attempts || 0) + 1;

  if (attempts >= (job?.max_attempts || 3)) {
    // Max retries — mark as permanently failed
    db.prepare("UPDATE jobs SET status = 'failed', attempts = ?, error = ?, completed_at = datetime('now') WHERE id = ?")
      .run(attempts, errorMsg, jobId);
  } else {
    // Retry with exponential backoff (5s, 25s, 125s)
    const delaySec = Math.pow(5, attempts);
    db.prepare("UPDATE jobs SET status = 'pending', attempts = ?, error = ?, next_retry_at = datetime('now', '+' || ? || ' seconds') WHERE id = ?")
      .run(attempts, errorMsg, delaySec, jobId);
  }
}

/**
 * Process a single job
 */
async function processJob(job) {
  const db = getDb();
  const image = db.prepare('SELECT id, filepath, thumbnail_path, analysis_path, media_type FROM images WHERE id = ?').get(job.image_id);

  if (!image) {
    completeJob(job.id); // Image was deleted
    return;
  }

  const originalFile = path.join(UPLOADS_DIR, image.filepath);
  const analysisFile = image.analysis_path ? path.join(UPLOADS_DIR, image.analysis_path) : null;
  const thumbFile = image.thumbnail_path ? path.join(UPLOADS_DIR, image.thumbnail_path) : null;
  const mlTarget = analysisFile || originalFile;
  const fs = require('fs');

  switch (job.type) {
    case 'nsfw': {
      const nsfwDetector = require('./nsfw-detector');
      if (image.media_type === 'video') {
        const nsfwTarget = analysisFile || thumbFile;
        if (nsfwTarget && fs.existsSync(nsfwTarget)) {
          await nsfwDetector.detectAndTag(image.id, nsfwTarget);
        } else {
          const { extractKeyframes, cleanupFrames } = require('./video-frames');
          const frames = await extractKeyframes(originalFile, null, 1);
          if (frames.length > 0) {
            await nsfwDetector.detectAndTag(image.id, frames[0]);
            cleanupFrames(frames);
          }
        }
      } else {
        await nsfwDetector.detectAndTag(image.id, mlTarget);
      }
      break;
    }
    case 'vision': {
      const { applyVisionTags } = require('./tagger');
      if (image.media_type === 'video') {
        await applyVisionTags(image.id, analysisFile || thumbFile, true, originalFile);
      } else {
        await applyVisionTags(image.id, mlTarget);
      }
      break;
    }
    case 'caption': {
      const captioner = require('./captioner');
      if (captioner.isAvailable()) {
        await captioner.captionAndStore(image.id, analysisFile || thumbFile || originalFile);
      }
      break;
    }
  }
}

/**
 * Poll for and process jobs
 */
async function tick() {
  if (processing >= CONCURRENCY) return;

  const job = claimNextJob();
  if (!job) return;

  processing++;
  try {
    await processJob(job);
    completeJob(job.id);
  } catch (err) {
    console.error(`[JobQueue] Job ${job.id} (${job.type} for image ${job.image_id}) failed:`, err.message);
    failJob(job.id, err.message);
  } finally {
    processing--;
  }

  // Immediately check for more jobs
  setImmediate(tick);
}

/**
 * Start the job queue processor
 */
function start() {
  if (running) return;
  running = true;
  console.log('[JobQueue] Started (polling every ' + POLL_INTERVAL + 'ms)');

  // Reset any stale 'processing' jobs from a previous crash
  const db = getDb();
  const stale = db.prepare("UPDATE jobs SET status = 'pending', next_retry_at = NULL WHERE status = 'processing'").run();
  if (stale.changes > 0) console.log(`[JobQueue] Reset ${stale.changes} stale processing jobs`);

  pollTimer = setInterval(tick, POLL_INTERVAL);
  // Also run immediately
  tick();
}

/**
 * Stop the job queue
 */
function stop() {
  running = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Get queue statistics
 */
function getStats() {
  const db = getDb();
  const stats = db.prepare(`
    SELECT status, COUNT(*) as count FROM jobs GROUP BY status
  `).all();
  const byStatus = {};
  stats.forEach(s => byStatus[s.status] = s.count);
  return {
    pending: byStatus.pending || 0,
    processing: byStatus.processing || 0,
    done: byStatus.done || 0,
    failed: byStatus.failed || 0,
    total: stats.reduce((a, s) => a + s.count, 0),
  };
}

/**
 * Get job status for a specific image
 */
function getImageJobStatus(imageId) {
  const db = getDb();
  return db.prepare('SELECT id, type, status, attempts, error, created_at, completed_at FROM jobs WHERE image_id = ? ORDER BY type').all(imageId);
}

/**
 * Retry all failed jobs
 */
function retryFailed() {
  const db = getDb();
  const result = db.prepare("UPDATE jobs SET status = 'pending', attempts = 0, error = NULL, next_retry_at = NULL WHERE status = 'failed'").run();
  return result.changes;
}

/**
 * Clean up completed jobs older than N days
 */
function cleanup(daysOld = 7) {
  const db = getDb();
  const result = db.prepare("DELETE FROM jobs WHERE status = 'done' AND completed_at < datetime('now', '-' || ? || ' days')").run(daysOld);
  return result.changes;
}

module.exports = { enqueueImageJobs, start, stop, getStats, getImageJobStatus, retryFailed, cleanup };
