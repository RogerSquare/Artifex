const { getDb } = require('../db');
const path = require('path');

/**
 * Get orientation tag from dimensions
 */
function getOrientationTag(width, height) {
  if (!width || !height) return null;
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.1) return 'square';
  if (ratio > 1.2) return 'landscape';
  if (ratio < 0.8) return 'portrait';
  return 'square';
}

function getResolutionSize(width, height) {
  if (!width || !height) return null;
  const mp = (width * height) / 1000000;
  if (mp >= 4) return '4k+';
  if (mp >= 2) return '2k';
  if (mp >= 1) return '1080p';
  if (mp >= 0.5) return '720p';
  return 'sd';
}

/**
 * Extract only structural tags — model, sampler, orientation, resolution, media type.
 * No prompt keyword extraction — that's left to the vision model.
 */
function extractMetadataTags(imageRecord) {
  const tags = [];

  if (imageRecord.model) {
    const modelName = imageRecord.model.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    if (modelName) tags.push({ name: modelName, category: 'model' });
  }

  if (imageRecord.sampler) {
    tags.push({ name: imageRecord.sampler, category: 'sampler' });
  }

  const orientation = getOrientationTag(imageRecord.width, imageRecord.height);
  if (orientation) tags.push({ name: orientation, category: 'orientation' });

  const size = getResolutionSize(imageRecord.width, imageRecord.height);
  if (size) tags.push({ name: size, category: 'resolution' });

  if (imageRecord.media_type === 'video') {
    tags.push({ name: 'video', category: 'media' });
  }

  return tags;
}

/**
 * Ensure a tag exists in the database and return its ID
 */
function getOrCreateTagId(db, name, category) {
  const normalized = name.toLowerCase().trim();
  if (!normalized) return null;

  let tag = db.prepare('SELECT id FROM tags WHERE name = ? AND category = ?').get(normalized, category);
  if (!tag) {
    const info = db.prepare('INSERT INTO tags (name, category) VALUES (?, ?)').run(normalized, category);
    return info.lastInsertRowid;
  }
  return tag.id;
}

/**
 * Apply structural metadata tags to an image. Returns the tags applied.
 */
function applyMetadataTags(imageId, imageRecord) {
  const db = getDb();
  const tags = extractMetadataTags(imageRecord);
  const insertStmt = db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id, source) VALUES (?, ?, ?)');

  const applied = [];
  for (const tag of tags) {
    const tagId = getOrCreateTagId(db, tag.name, tag.category);
    if (tagId) {
      insertStmt.run(imageId, tagId, 'metadata');
      applied.push({ id: tagId, name: tag.name, category: tag.category });
    }
  }
  return applied;
}

/**
 * Classify a single image file using both taggers and merge results.
 * WD Tagger excels at anime/illustration, CLIP covers photorealistic content.
 * Running both ensures coverage across content types.
 */
async function classifySingleImage(imagePath, imageId = null) {
  const allTags = [];

  // Check if image is NSFW-rated — if so, allow NSFW tags through
  let isExplicit = false;
  if (imageId) {
    const nsfwTag = getDb().prepare(`
      SELECT t.name FROM image_tags it JOIN tags t ON it.tag_id = t.id
      WHERE it.image_id = ? AND it.source = 'nsfw-detector' AND t.category = 'rating'
    `).get(imageId);
    isExplicit = nsfwTag && ['explicit', 'nsfw', 'suggestive'].includes(nsfwTag.name);
  }

  // Run WD Tagger first (anime/illustration specialist, 10k+ tags)
  // Then CLIP (general-purpose, covers photorealistic content)
  // Sequential to avoid memory pressure from loading both simultaneously
  try {
    const wdTagger = require('./wd-tagger');
    if (wdTagger.isAvailable()) {
      const wdTags = await wdTagger.classify(imagePath, { allowNsfw: isExplicit });
      allTags.push(...wdTags);
    }
  } catch (e) {
    console.error('[Vision] WD Tagger failed:', e.message);
  }

  try {
    const visionTagger = require('./vision-tagger');
    // Pass caption to CLIP for guided classification (if available)
    const caption = imageId ? getDb().prepare('SELECT caption FROM images WHERE id = ?').get(imageId)?.caption : null;
    const clipTags = await visionTagger.classifyImage(imagePath, caption);
    allTags.push(...clipTags);
  } catch (e) {
    console.error('[Vision] CLIP failed:', e.message);
  }

  // If both models failed, return whatever we got (may be empty)
  if (allTags.length === 0) return allTags;

  // Deduplicate — if both models produce the same tag name, keep the higher score
  const best = new Map();
  for (const tag of allTags) {
    const key = `${tag.category}:${tag.name}`;
    const existing = best.get(key);
    if (!existing || tag.score > existing.score) {
      best.set(key, tag);
    }
  }

  // Cross-model contradiction filtering
  const tagNames = new Set(best.keys());

  // If CLIP detects people/photorealistic → suppress WD's anime-biased false tags
  const hasPersonTags = ['character:1girl', 'character:1boy', 'subject:portrait', 'subject:full body', 'subject:group shot'].some(k => tagNames.has(k));
  const hasRealisticTags = ['style:photorealistic', 'style:realistic'].some(k => tagNames.has(k));

  if (hasPersonTags || hasRealisticTags) {
    const suppress = ['general:no humans', 'general:comic', 'general:text focus', 'general:monochrome', 'general:greyscale'];
    for (const key of suppress) {
      best.delete(key);
    }
  }

  // If "no humans" is present → suppress all person-related tags from any model
  if (tagNames.has('general:no humans')) {
    const personCategories = ['character', 'hair', 'clothing', 'pose'];
    for (const key of best.keys()) {
      const cat = key.split(':')[0];
      if (personCategories.includes(cat)) {
        best.delete(key);
      }
    }
  }

  return Array.from(best.values());
}

/**
 * Merge tags from multiple frames — keep highest confidence per tag name
 */
function mergeFrameTags(frameResults) {
  const best = new Map();
  for (const tags of frameResults) {
    for (const tag of tags) {
      const key = `${tag.category}:${tag.name}`;
      const existing = best.get(key);
      if (!existing || tag.score > existing.score) {
        best.set(key, tag);
      }
    }
  }
  return Array.from(best.values());
}

/**
 * Apply vision-based tags to an image or video (called separately, async)
 * For videos: extracts keyframes, classifies each, merges results
 * For images: classifies directly
 */
async function applyVisionTags(imageId, imagePath, isVideo = false, videoSourcePath = null) {
  try {
    let tags;

    if (isVideo && videoSourcePath) {
      const { extractKeyframes, cleanupFrames } = require('./video-frames');
      const frames = await extractKeyframes(videoSourcePath, imagePath);

      if (frames.length === 0) {
        console.error(`[Vision] No frames extracted for video ${imageId}, skipping`);
        return [];
      }

      // Classify each frame
      const frameResults = [];
      for (const frame of frames) {
        try {
          const frameTags = await classifySingleImage(frame, imageId);
          frameResults.push(frameTags);
        } catch (err) {
          console.error(`[Vision] Frame classification failed:`, err.message);
        }
      }

      // Clean up temp frames
      cleanupFrames(frames);

      // Merge tags across frames
      tags = mergeFrameTags(frameResults);
    } else {
      tags = await classifySingleImage(imagePath, imageId);
    }

    if (!tags || tags.length === 0) return [];

    const db = getDb();
    const insertStmt = db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id, source) VALUES (?, ?, ?)');

    const applied = [];
    for (const tag of tags) {
      const tagId = getOrCreateTagId(db, tag.name, tag.category);
      if (tagId) {
        insertStmt.run(imageId, tagId, 'vision');
        applied.push({ id: tagId, name: tag.name, category: tag.category });
      }
    }
    return applied;
  } catch (err) {
    console.error(`Vision tagging failed for image ${imageId}:`, err.message);
    return [];
  }
}

/**
 * Get all tags for an image
 */
function getImageTags(imageId) {
  const db = getDb();
  return db.prepare(`
    SELECT t.id, t.name, t.category, it.source
    FROM image_tags it JOIN tags t ON it.tag_id = t.id
    WHERE it.image_id = ?
    ORDER BY t.category, t.name
  `).all(imageId);
}

module.exports = { applyMetadataTags, applyVisionTags, getImageTags, extractMetadataTags, getOrCreateTagId };
