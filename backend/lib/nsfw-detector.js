/**
 * NSFW content detection using AdamCodd/vit-base-nsfw-detector
 * Binary classifier (sfw/nsfw) with confidence scores.
 * Runs locally via @huggingface/transformers — no API keys needed.
 */

const { getDb } = require('../db');

let classifier = null;
let classifierLoading = false;
let classifierQueue = [];

const MODEL_ID = 'AdamCodd/vit-base-nsfw-detector';

async function getClassifier() {
  if (classifier) return classifier;
  if (classifierLoading) {
    return new Promise((resolve) => classifierQueue.push(resolve));
  }
  classifierLoading = true;
  console.log('[NSFW Detector] Loading model...');
  try {
    const { pipeline } = await import('@huggingface/transformers');
    classifier = await pipeline('image-classification', MODEL_ID);
    console.log('[NSFW Detector] Model loaded successfully.');
    classifierQueue.forEach(resolve => resolve(classifier));
    classifierQueue = [];
    return classifier;
  } catch (err) {
    classifierLoading = false;
    classifierQueue.forEach(resolve => resolve(null));
    classifierQueue = [];
    throw err;
  }
}

/**
 * Classify an image for NSFW content
 */
async function classify(imagePath) {
  const model = await getClassifier();
  if (!model) throw new Error('NSFW classifier not available');

  const results = await model(imagePath);

  const sfwResult = results.find(r => r.label === 'sfw') || { score: 0 };
  const nsfwResult = results.find(r => r.label === 'nsfw') || { score: 0 };

  let rating;
  if (nsfwResult.score >= 0.85) rating = 'explicit';
  else if (nsfwResult.score >= 0.60) rating = 'nsfw';
  else if (nsfwResult.score >= 0.30) rating = 'suggestive';
  else rating = 'sfw';

  return {
    rating,
    sfw_score: sfwResult.score,
    nsfw_score: nsfwResult.score,
  };
}

/**
 * Run NSFW detection on an image and store result as a tag
 */
async function detectAndTag(imageId, imagePath) {
  const result = await classify(imagePath);
  const db = getDb();

  // Remove any existing rating tags from nsfw-detector for this image
  db.prepare(`
    DELETE FROM image_tags WHERE image_id = ? AND source = 'nsfw-detector'
  `).run(imageId);

  let tag = db.prepare('SELECT id FROM tags WHERE name = ? AND category = ?').get(result.rating, 'rating');
  if (!tag) {
    const info = db.prepare('INSERT INTO tags (name, category) VALUES (?, ?)').run(result.rating, 'rating');
    tag = { id: info.lastInsertRowid };
  }

  db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id, source) VALUES (?, ?, ?)').run(
    imageId, tag.id, 'nsfw-detector'
  );

  return { rating: result.rating, nsfw_score: result.nsfw_score };
}

function isReady() {
  return classifier !== null;
}

module.exports = { classify, detectAndTag, getClassifier, isReady };
