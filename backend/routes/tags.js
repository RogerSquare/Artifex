const express = require('express');
const path = require('path');
const { getDb } = require('../db');
const { requireAuth, optionalAuth } = require('../lib/authMiddleware');
const { applyMetadataTags, applyVisionTags, getImageTags } = require('../lib/tagger');
const nsfwDetector = require('../lib/nsfw-detector');
const jobQueue = require('../lib/job-queue');

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// GET /api/tags/jobs/stats — job queue statistics
router.get('/jobs/stats', requireAuth, (req, res) => {
  res.json(jobQueue.getStats());
});

// GET /api/tags/jobs/image/:imageId — job status for a specific image
router.get('/jobs/image/:imageId', (req, res) => {
  const jobs = jobQueue.getImageJobStatus(parseInt(req.params.imageId));
  res.json({ jobs });
});

// POST /api/tags/jobs/retry — retry all failed jobs
router.post('/jobs/retry', requireAuth, (req, res) => {
  const retried = jobQueue.retryFailed();
  res.json({ success: true, retried });
});

// DELETE /api/tags/jobs/cleanup — clean up completed jobs older than 7 days
router.delete('/jobs/cleanup', requireAuth, (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const cleaned = jobQueue.cleanup(days);
  res.json({ success: true, cleaned });
});

// GET /api/tags — list all tags with image counts, optionally filtered by category
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const category = req.query.category;

    let query = `
      SELECT t.id, t.name, t.category, COUNT(it.image_id) as image_count
      FROM tags t LEFT JOIN image_tags it ON t.id = it.tag_id
    `;
    const params = {};
    if (category) {
      query += ' WHERE t.category = @category';
      params.category = category;
    }
    query += ' GROUP BY t.id HAVING image_count > 0 ORDER BY image_count DESC';

    const tags = db.prepare(query).all(params);
    res.json({ tags });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/tags/categories — list tag categories with counts
router.get('/categories', (req, res) => {
  try {
    const db = getDb();
    const categories = db.prepare(`
      SELECT t.category, COUNT(DISTINCT t.id) as tag_count, COUNT(it.image_id) as usage_count
      FROM tags t LEFT JOIN image_tags it ON t.id = it.tag_id
      GROUP BY t.category ORDER BY usage_count DESC
    `).all();
    res.json({ categories });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/tags/image/:imageId — get tags for a specific image
router.get('/image/:imageId', (req, res) => {
  try {
    const tags = getImageTags(parseInt(req.params.imageId));
    res.json({ tags });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/tags/image/:imageId — manually add a tag to an image
router.post('/image/:imageId', requireAuth, (req, res) => {
  try {
    const { name, category = 'manual' } = req.body;
    if (!name) return res.status(400).json({ error: 'Tag name required' });

    const db = getDb();
    const normalized = name.toLowerCase().trim();

    let tag = db.prepare('SELECT id FROM tags WHERE name = ? AND category = ?').get(normalized, category);
    if (!tag) {
      const info = db.prepare('INSERT INTO tags (name, category) VALUES (?, ?)').run(normalized, category);
      tag = { id: info.lastInsertRowid };
    }

    db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id, source) VALUES (?, ?, ?)').run(
      parseInt(req.params.imageId), tag.id, 'manual'
    );

    const tags = getImageTags(parseInt(req.params.imageId));
    res.json({ success: true, tags });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// DELETE /api/tags/image/:imageId/:tagId — remove a tag from an image
router.delete('/image/:imageId/:tagId', requireAuth, (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM image_tags WHERE image_id = ? AND tag_id = ?').run(
      parseInt(req.params.imageId), parseInt(req.params.tagId)
    );
    const tags = getImageTags(parseInt(req.params.imageId));
    res.json({ success: true, tags });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/tags/vision/batch — trigger vision tagging for untagged images and videos
// Must be before /vision/:imageId to avoid "batch" matching as an imageId
router.post('/vision/batch', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    // Find all media without vision tags (images AND videos)
    const items = db.prepare(`
      SELECT i.id, i.filepath, i.thumbnail_path, i.analysis_path, i.media_type FROM images i
      WHERE i.id NOT IN (SELECT DISTINCT image_id FROM image_tags WHERE source = 'vision')
      ORDER BY i.created_at DESC LIMIT ?
    `).all(limit);

    if (items.length === 0) return res.json({ success: true, processed: 0, message: 'All media already tagged' });

    let processed = 0;
    for (const item of items) {
      try {
        const originalFile = path.join(UPLOADS_DIR, item.filepath);
        const analysisFile = item.analysis_path ? path.join(UPLOADS_DIR, item.analysis_path) : null;
        const thumbFile = item.thumbnail_path ? path.join(UPLOADS_DIR, item.thumbnail_path) : null;
        const mlTarget = analysisFile || originalFile;
        if (item.media_type === 'video') {
          await applyVisionTags(item.id, analysisFile || thumbFile, true, originalFile);
        } else {
          await applyVisionTags(item.id, mlTarget);
        }
        processed++;
      } catch (err) {
        console.error(`Vision tagging failed for ${item.media_type} ${item.id}:`, err.message);
      }
    }

    res.json({ success: true, processed, total_queued: items.length });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/tags/vision/:imageId — trigger vision tagging for a single image or video
router.post('/vision/:imageId', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const image = db.prepare('SELECT id, filepath, thumbnail_path, analysis_path, media_type FROM images WHERE id = ?').get(parseInt(req.params.imageId));
    if (!image) return res.status(404).json({ error: 'Image not found' });

    const originalFile = path.join(UPLOADS_DIR, image.filepath);
    const analysisFile = image.analysis_path ? path.join(UPLOADS_DIR, image.analysis_path) : null;
    const thumbFile = image.thumbnail_path ? path.join(UPLOADS_DIR, image.thumbnail_path) : null;
    const mlTarget = analysisFile || originalFile;
    if (image.media_type === 'video') {
      await applyVisionTags(image.id, analysisFile || thumbFile, true, originalFile);
    } else {
      await applyVisionTags(image.id, mlTarget);
    }
    const tags = getImageTags(image.id);

    res.json({ success: true, tags });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/tags/nsfw/batch — run NSFW detection on unscanned images
// Must be before /nsfw/:imageId
router.post('/nsfw/batch', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const images = db.prepare(`
      SELECT i.id, i.filepath, i.thumbnail_path FROM images i
      WHERE i.id NOT IN (SELECT DISTINCT image_id FROM image_tags WHERE source = 'nsfw-detector')
      ORDER BY i.created_at DESC LIMIT ?
    `).all(limit);

    if (images.length === 0) return res.json({ success: true, processed: 0, message: 'All images already scanned' });

    const { extractKeyframes, cleanupFrames } = require('../lib/video-frames');
    let processed = 0;
    const results = [];
    for (const image of images) {
      try {
        let targetPath;
        if (image.thumbnail_path) {
          targetPath = path.join(UPLOADS_DIR, image.thumbnail_path);
        } else {
          // No thumbnail (video with failed thumb gen) — extract a frame
          const videoPath = path.join(UPLOADS_DIR, image.filepath);
          const frames = await extractKeyframes(videoPath, null, 1);
          if (frames.length > 0) {
            const result = await nsfwDetector.detectAndTag(image.id, frames[0]);
            cleanupFrames(frames);
            results.push({ id: image.id, ...result });
            processed++;
            continue;
          }
          console.error(`NSFW: No thumbnail or frames for image ${image.id}, skipping`);
          continue;
        }
        const result = await nsfwDetector.detectAndTag(image.id, targetPath);
        results.push({ id: image.id, ...result });
        processed++;
      } catch (err) {
        console.error(`NSFW detection failed for image ${image.id}:`, err.message);
      }
    }

    res.json({ success: true, processed, total_queued: images.length, results });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/tags/nsfw/:imageId — run NSFW detection on a single image or video
router.post('/nsfw/:imageId', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const { extractKeyframes, cleanupFrames } = require('../lib/video-frames');
    const image = db.prepare('SELECT id, filepath, thumbnail_path, media_type FROM images WHERE id = ?').get(parseInt(req.params.imageId));
    if (!image) return res.status(404).json({ error: 'Image not found' });

    let targetPath;
    if (image.thumbnail_path) {
      targetPath = path.join(UPLOADS_DIR, image.thumbnail_path);
    } else if (image.media_type === 'video') {
      // Extract a single frame via ffmpeg for NSFW analysis
      const videoPath = path.join(UPLOADS_DIR, image.filepath);
      const os = require('os');
      const fs = require('fs');
      const ffmpeg = require('fluent-ffmpeg');
      const tmpFrame = path.join(os.tmpdir(), `nsfw_frame_${image.id}.png`);

      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .seekInput(1)
          .frames(1)
          .outputOptions(['-vf', 'scale=640:-2'])
          .output(tmpFrame)
          .on('end', resolve)
          .on('error', (err) => {
            // Retry at 0s if seek fails
            ffmpeg(videoPath).frames(1).outputOptions(['-vf', 'scale=640:-2']).output(tmpFrame)
              .on('end', resolve).on('error', reject).run();
          })
          .run();
      });

      if (fs.existsSync(tmpFrame) && fs.statSync(tmpFrame).size > 0) {
        const result = await nsfwDetector.detectAndTag(image.id, tmpFrame);
        try { fs.unlinkSync(tmpFrame); } catch(e) {}
        const tags = getImageTags(image.id);
        return res.json({ success: true, ...result, tags });
      }
      return res.status(500).json({ error: 'Could not extract frame from video' });
    } else {
      targetPath = path.join(UPLOADS_DIR, image.filepath);
    }

    const result = await nsfwDetector.detectAndTag(image.id, targetPath);
    const tags = getImageTags(image.id);

    res.json({ success: true, ...result, tags });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/tags/caption/batch — generate captions for uncaptioned images
router.post('/caption/batch', requireAuth, async (req, res) => {
  try {
    const captioner = require('../lib/captioner');
    if (!captioner.isAvailable()) return res.status(400).json({ error: 'Captioner not available' });

    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const items = db.prepare(`
      SELECT i.id, i.filepath, i.thumbnail_path, i.analysis_path, i.media_type FROM images i
      WHERE i.caption IS NULL
      ORDER BY i.created_at DESC LIMIT ?
    `).all(limit);

    if (items.length === 0) return res.json({ success: true, processed: 0, message: 'All images already captioned' });

    let processed = 0;
    const results = [];
    for (const item of items) {
      try {
        const target = item.analysis_path ? path.join(UPLOADS_DIR, item.analysis_path)
          : item.media_type === 'video' && item.thumbnail_path ? path.join(UPLOADS_DIR, item.thumbnail_path)
          : path.join(UPLOADS_DIR, item.filepath);
        const caption = await captioner.captionAndStore(item.id, target);
        results.push({ id: item.id, caption });
        processed++;
      } catch (err) {
        console.error(`Captioning failed for ${item.id}:`, err.message);
      }
    }

    res.json({ success: true, processed, total_queued: items.length, results });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/tags/backfill — tag all existing images with metadata tags
// ?reset=true to clear all existing tags first and re-tag everything
router.post('/backfill', requireAuth, (req, res) => {
  try {
    const db = getDb();

    if (req.query.reset === 'true') {
      db.prepare('DELETE FROM image_tags WHERE source = ?').run('metadata');
      // Clean up orphaned tags
      db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM image_tags)').run();
    }

    const images = db.prepare(`
      SELECT id, prompt, model, sampler, width, height, media_type
      FROM images WHERE id NOT IN (SELECT DISTINCT image_id FROM image_tags WHERE source = 'metadata')
    `).all();

    let tagged = 0;
    for (const img of images) {
      const applied = applyMetadataTags(img.id, img);
      if (applied.length > 0) tagged++;
    }

    res.json({ success: true, images_tagged: tagged, total_scanned: images.length, reset: req.query.reset === 'true' });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/tags/search — autocomplete tag search
router.get('/search', (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ tags: [] });

    const db = getDb();
    const tags = db.prepare(`
      SELECT t.id, t.name, t.category, COUNT(it.image_id) as image_count
      FROM tags t LEFT JOIN image_tags it ON t.id = it.tag_id
      WHERE t.name LIKE @query
      GROUP BY t.id HAVING image_count > 0
      ORDER BY image_count DESC LIMIT 20
    `).all({ query: `%${q.toLowerCase()}%` });

    res.json({ tags });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

module.exports = router;
