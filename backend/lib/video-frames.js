/**
 * Extract keyframes from videos for vision tagging.
 * Uses ffmpeg to extract evenly-spaced frames as temporary PNG files.
 */

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const os = require('os');

const FRAME_COUNT = 3; // Number of frames to extract

/**
 * Get video duration via ffprobe
 */
function getVideoDuration(videoPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return resolve(null);
      resolve(metadata.format?.duration || null);
    });
  });
}

/**
 * Extract a single frame at a given timestamp
 */
function extractFrame(videoPath, timestamp, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timestamp)
      .frames(1)
      .outputOptions(['-vf', 'scale=640:-2'])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Extract keyframes from a video at even intervals.
 * Returns array of temporary file paths (caller must clean up).
 * Falls back to thumbnail if extraction fails.
 *
 * @param {string} videoPath - Path to the video file
 * @param {string} [thumbnailPath] - Fallback thumbnail path
 * @param {number} [frameCount] - Number of frames to extract (default 3)
 * @returns {Promise<string[]>} Array of temp frame file paths
 */
async function extractKeyframes(videoPath, thumbnailPath = null, frameCount = FRAME_COUNT) {
  let duration = await getVideoDuration(videoPath);

  if (!duration || duration <= 0) {
    // Can't determine duration — try a single frame at 0s, then fallback to thumbnail
    const tmpDir = path.join(os.tmpdir(), 'artifex-frames');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const baseName = path.basename(videoPath, path.extname(videoPath));
    const fallbackFrame = path.join(tmpDir, `${baseName}_frame0.png`);
    try {
      await extractFrame(videoPath, 0, fallbackFrame);
      if (fs.existsSync(fallbackFrame) && fs.statSync(fallbackFrame).size > 0) return [fallbackFrame];
    } catch (e) { /* ignore */ }
    if (thumbnailPath && fs.existsSync(thumbnailPath)) return [thumbnailPath];
    return [];
  }

  const tmpDir = path.join(os.tmpdir(), 'artifex-frames');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const frames = [];
  const baseName = path.basename(videoPath, path.extname(videoPath));

  // Calculate evenly-spaced timestamps (avoid very start and very end)
  const timestamps = [];
  if (frameCount === 1) {
    // Single frame — grab the middle
    timestamps.push(duration / 2);
  } else if (duration <= 2) {
    // Very short video — just grab the middle frame
    timestamps.push(duration / 2);
  } else {
    const padding = Math.min(0.5, duration * 0.1);
    const usable = duration - (padding * 2);
    for (let i = 0; i < frameCount; i++) {
      timestamps.push(padding + (usable * i / (frameCount - 1)));
    }
  }

  for (let i = 0; i < timestamps.length; i++) {
    const outputPath = path.join(tmpDir, `${baseName}_frame${i}.png`);
    try {
      await extractFrame(videoPath, timestamps[i], outputPath);
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        frames.push(outputPath);
      }
    } catch (err) {
      console.error(`[Video Frames] Failed to extract frame ${i} at ${timestamps[i]}s:`, err.message);
    }
  }

  // Fallback to thumbnail if no frames extracted
  if (frames.length === 0 && thumbnailPath && fs.existsSync(thumbnailPath)) {
    return [thumbnailPath];
  }

  return frames;
}

/**
 * Clean up temporary frame files
 */
function cleanupFrames(framePaths) {
  for (const fp of framePaths) {
    // Only delete files in the temp directory (don't delete thumbnails)
    if (fp.includes('artifex-frames') && fs.existsSync(fp)) {
      try { fs.unlinkSync(fp); } catch (e) { /* ignore */ }
    }
  }
}

module.exports = { extractKeyframes, cleanupFrames, getVideoDuration };
