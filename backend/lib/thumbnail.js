const sharp = require('sharp');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const THUMB_WIDTH = 300;
const ANALYSIS_WIDTH = 512; // Mid-res image for ML tagging (better detail than 300px thumbnail)

const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];

function isVideo(filename) {
  return VIDEO_EXTS.includes(path.extname(filename).toLowerCase());
}

/**
 * Generate a thumbnail for an image file.
 */
async function generateImageThumbnail(inputPath, outputDir, filename) {
  const thumbFilename = `thumb_${filename.replace(/\.[^.]+$/, '.webp')}`;
  const thumbPath = path.join(outputDir, thumbFilename);

  const image = sharp(inputPath);
  const metadata = await image.metadata();

  await image
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(thumbPath);

  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
    thumbPath: thumbFilename,
    duration: null,
  };
}

/**
 * Generate a thumbnail from a video file (extract frame at 1s or first frame).
 */
function generateVideoThumbnail(inputPath, outputDir, filename) {
  return new Promise((resolve, reject) => {
    const thumbFilename = `thumb_${filename.replace(/\.[^.]+$/, '.webp')}`;
    const tempPng = path.join(outputDir, `temp_${filename}.png`);

    // First get video metadata
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        // Fallback: no thumbnail, just return dimensions if available
        resolve({ width: 0, height: 0, thumbPath: null, duration: null });
        return;
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const width = videoStream?.width || 0;
      const height = videoStream?.height || 0;
      const duration = metadata.format?.duration || null;

      // Extract frame
      ffmpeg(inputPath)
        .screenshots({
          count: 1,
          timemarks: [duration && duration > 1 ? '1' : '0'],
          filename: path.basename(tempPng),
          folder: outputDir,
          size: `${THUMB_WIDTH}x?`,
        })
        .on('end', async () => {
          try {
            // Convert PNG to WebP
            const thumbPath = path.join(outputDir, thumbFilename);
            await sharp(tempPng)
              .webp({ quality: 80 })
              .toFile(thumbPath);

            // Clean up temp PNG
            const fs = require('fs');
            if (fs.existsSync(tempPng)) fs.unlinkSync(tempPng);

            resolve({ width, height, thumbPath: thumbFilename, duration });
          } catch (e) {
            resolve({ width, height, thumbPath: null, duration });
          }
        })
        .on('error', () => {
          resolve({ width, height, thumbPath: null, duration });
        });
    });
  });
}

const PREVIEW_WIDTH = 960;
const PREVIEW_BITRATE = '2500k';

/**
 * Generate a compressed low-res preview video for grid display.
 * Small file, low resolution, low bitrate — plays smoothly even with 20+ in grid.
 */
function generateVideoPreview(inputPath, outputDir, filename) {
  return new Promise((resolve) => {
    const previewFilename = `preview_${filename.replace(/\.[^.]+$/, '.mp4')}`;
    const previewPath = path.join(outputDir, previewFilename);

    ffmpeg(inputPath)
      .outputOptions([
        `-vf scale=${PREVIEW_WIDTH}:-2`,
        `-b:v ${PREVIEW_BITRATE}`,
        '-an',             // strip audio — grid videos are muted anyway
        '-movflags +faststart',
        '-preset fast',
        '-pix_fmt yuv420p',
      ])
      .output(previewPath)
      .on('end', () => resolve(previewFilename))
      .on('error', (err) => {
        console.error('Preview generation failed:', err.message);
        resolve(null);
      })
      .run();
  });
}

/**
 * Generate an analysis image for ML tagging (512px, higher quality than thumbnail).
 */
async function generateAnalysisImage(inputPath, outputDir, filename) {
  const analysisFilename = `analysis_${filename.replace(/\.[^.]+$/, '.webp')}`;
  const analysisPath = path.join(outputDir, analysisFilename);

  try {
    await sharp(inputPath)
      .resize({ width: ANALYSIS_WIDTH, withoutEnlargement: true })
      .webp({ quality: 90 })
      .toFile(analysisPath);
    return analysisFilename;
  } catch (e) {
    console.error('Analysis image generation failed:', e.message);
    return null;
  }
}

/**
 * Generate an analysis frame from a video (512px, single frame at midpoint).
 */
function generateVideoAnalysisFrame(inputPath, outputDir, filename, duration) {
  return new Promise((resolve) => {
    const analysisFilename = `analysis_${filename.replace(/\.[^.]+$/, '.webp')}`;
    const tempPng = path.join(outputDir, `temp_analysis_${filename}.png`);
    const seekTime = duration && duration > 1 ? Math.min(1, duration / 2) : 0;

    ffmpeg(inputPath)
      .screenshots({
        count: 1,
        timemarks: [String(seekTime)],
        filename: path.basename(tempPng),
        folder: outputDir,
        size: `${ANALYSIS_WIDTH}x?`,
      })
      .on('end', async () => {
        try {
          const analysisPath = path.join(outputDir, analysisFilename);
          await sharp(tempPng).webp({ quality: 90 }).toFile(analysisPath);
          const fs = require('fs');
          if (fs.existsSync(tempPng)) fs.unlinkSync(tempPng);
          resolve(analysisFilename);
        } catch (e) {
          resolve(null);
        }
      })
      .on('error', () => resolve(null));
  });
}

/**
 * Generate a thumbnail — auto-detects image vs video.
 * For videos, also generates a compressed preview clip and analysis frame.
 * For images, also generates an analysis image.
 */
async function generateThumbnail(inputPath, outputDir, filename) {
  if (isVideo(filename)) {
    const result = await generateVideoThumbnail(inputPath, outputDir, filename);
    // Also generate low-res preview for grid playback
    const previewFilename = await generateVideoPreview(inputPath, outputDir, filename);
    result.previewPath = previewFilename ? `thumbnails/${previewFilename}` : null;
    // Generate analysis frame for ML tagging
    const analysisFilename = await generateVideoAnalysisFrame(inputPath, outputDir, filename, result.duration);
    result.analysisPath = analysisFilename ? `thumbnails/${analysisFilename}` : null;
    return result;
  }
  const result = await generateImageThumbnail(inputPath, outputDir, filename);
  result.previewPath = null;
  // Generate analysis image for ML tagging
  const analysisFilename = await generateAnalysisImage(inputPath, outputDir, filename);
  result.analysisPath = analysisFilename ? `thumbnails/${analysisFilename}` : null;
  return result;
}

module.exports = { generateThumbnail, isVideo };
