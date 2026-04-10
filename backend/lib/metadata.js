const fs = require('fs');

/**
 * Extract AI generation metadata from an image file.
 * Supports: ComfyUI (PNG tEXt chunks), A1111/Forge (PNG tEXt or EXIF), NovelAI
 */
async function extractMetadata(filePath) {
  const result = {
    prompt: null,
    negative_prompt: null,
    model: null,
    sampler: null,
    steps: null,
    cfg_scale: null,
    seed: null,
    prompt_json: null,
    workflow_json: null,
    metadata_raw: null,
    has_metadata: false,
  };

  try {
    const ext = filePath.toLowerCase().split('.').pop();
    if (ext === 'png') {
      const chunks = readPngTextChunks(filePath);
      parsePngChunks(chunks, result);
    } else if (ext === 'jpg' || ext === 'jpeg') {
      parseJpegExif(filePath, result);
    } else if (ext === 'webp') {
      parseWebpExif(filePath, result);
    }
  } catch (err) {
    console.error(`Metadata extraction failed for ${filePath}:`, err.message);
  }

  result.has_metadata = !!(result.prompt || result.workflow_json || result.metadata_raw);
  return result;
}

/**
 * Read PNG tEXt and iTXt chunks — this is where ComfyUI and A1111 store metadata.
 */
function readPngTextChunks(filePath) {
  const buf = fs.readFileSync(filePath);
  const chunks = {};

  // Verify PNG signature
  if (buf.toString('ascii', 1, 4) !== 'PNG') return chunks;

  let offset = 8; // skip PNG signature
  while (offset < buf.length - 8) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);

    if (type === 'tEXt') {
      const data = buf.slice(offset + 8, offset + 8 + length);
      const nullIdx = data.indexOf(0);
      if (nullIdx !== -1) {
        const key = data.toString('latin1', 0, nullIdx);
        const value = data.toString('latin1', nullIdx + 1);
        chunks[key] = value;
      }
    } else if (type === 'iTXt') {
      const data = buf.slice(offset + 8, offset + 8 + length);
      const nullIdx = data.indexOf(0);
      if (nullIdx !== -1) {
        const key = data.toString('utf8', 0, nullIdx);
        // iTXt has: keyword\0 compressionFlag\0 compressionMethod\0 languageTag\0 translatedKeyword\0 text
        let pos = nullIdx + 1;
        const compressionFlag = data[pos]; pos++;
        pos++; // compression method
        const langEnd = data.indexOf(0, pos); pos = langEnd + 1;
        const transEnd = data.indexOf(0, pos); pos = transEnd + 1;
        const value = compressionFlag === 0
          ? data.toString('utf8', pos)
          : data.slice(pos).toString('utf8'); // compressed iTXt not commonly used for AI metadata
        chunks[key] = value;
      }
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length; // 4 length + 4 type + data + 4 CRC
  }

  return chunks;
}

/**
 * Parse PNG text chunks into structured metadata.
 * ComfyUI uses "prompt" and "workflow" keys.
 * A1111/Forge uses "parameters" key.
 */
function parsePngChunks(chunks, result) {
  // Collect all raw chunks
  const rawParts = [];
  for (const [key, value] of Object.entries(chunks)) {
    if (['prompt', 'workflow', 'parameters', 'Comment', 'Description', 'Software'].includes(key)) {
      rawParts.push(`${key}: ${value.substring(0, 5000)}`);
    }
  }
  if (rawParts.length > 0) result.metadata_raw = rawParts.join('\n\n');

  // ComfyUI: "prompt" contains the executed prompt JSON, "workflow" contains the full workflow
  if (chunks.prompt) {
    try {
      const promptData = JSON.parse(chunks.prompt);
      // Store the prompt JSON separately (flat dict with class_type + inputs)
      result.prompt_json = chunks.prompt;
      // Store workflow JSON separately (graph format with nodes[] + links[])
      if (chunks.workflow) result.workflow_json = chunks.workflow;
      parseComfyUIPrompt(promptData, result);
    } catch (e) {
      // Not valid JSON — might be a plain text prompt
      result.prompt = chunks.prompt;
    }
  } else if (chunks.workflow) {
    // Some exports only have workflow, not prompt
    result.workflow_json = chunks.workflow;
  }

  // A1111/Forge/SDXL: "parameters" key with structured text
  if (chunks.parameters) {
    parseA1111Parameters(chunks.parameters, result);
  }

  // NovelAI uses "Comment" key with JSON
  if (chunks.Comment) {
    try {
      const commentData = JSON.parse(chunks.Comment);
      if (commentData.prompt) result.prompt = result.prompt || commentData.prompt;
      if (commentData.uc) result.negative_prompt = result.negative_prompt || commentData.uc;
      if (commentData.sampler) result.sampler = result.sampler || commentData.sampler;
      if (commentData.steps) result.steps = result.steps || commentData.steps;
      if (commentData.scale) result.cfg_scale = result.cfg_scale || commentData.scale;
      if (commentData.seed) result.seed = result.seed || String(commentData.seed);
    } catch (e) { /* not JSON */ }
  }

  // Some tools put the prompt in "Description"
  if (chunks.Description && !result.prompt) {
    result.prompt = chunks.Description;
  }
}

/**
 * Parse ComfyUI prompt JSON to extract human-readable parameters.
 * The prompt is a dict of node_id -> {class_type, inputs}
 */
function parseComfyUIPrompt(promptData, result) {
  if (typeof promptData !== 'object') return;

  for (const [nodeId, node] of Object.entries(promptData)) {
    const cls = node.class_type || '';
    const inputs = node.inputs || {};

    // Extract positive/negative prompt from text encode and prompt saver nodes
    // Check multiple field names: text, prompt_text, string, value
    const promptFields = ['prompt_text', 'text', 'string', 'value'];
    const isPromptNode = cls.includes('CLIPTextEncode') || cls.includes('TextEncode') ||
        cls.includes('StringLiteral') || cls.includes('Text Multiline') ||
        cls.includes('PromptStash') || cls.includes('ShowText') ||
        cls.includes('String');

    if (isPromptNode) {
      for (const field of promptFields) {
        if (inputs[field] && typeof inputs[field] === 'string' && inputs[field].trim().length > 5) {
          const title = (node._meta?.title || '').toLowerCase();
          const isNegative = title.includes('negative') || title.includes('neg ');
          const isPositive = title.includes('positive') || title.includes('pos ') || title.includes('prompt stash') || title.includes('prompt_text');

          if (isNegative) {
            result.negative_prompt = result.negative_prompt || inputs[field];
          } else if (isPositive || !result.prompt) {
            result.prompt = result.prompt || inputs[field];
          } else if (!result.negative_prompt && inputs[field] !== result.prompt) {
            result.negative_prompt = inputs[field];
          }
          break;
        }
      }
    }

    // Extract sampler parameters from KSampler and variants
    // Note: array values like ["68", 0] are node connections — skip them
    if (cls.includes('KSampler') || cls.includes('SamplerCustom') || cls.includes('SamplerAdvanced')) {
      if (inputs.sampler_name && typeof inputs.sampler_name === 'string') result.sampler = result.sampler || inputs.sampler_name;
      if (inputs.steps && typeof inputs.steps === 'number') result.steps = result.steps || inputs.steps;
      if (inputs.cfg && typeof inputs.cfg === 'number') result.cfg_scale = result.cfg_scale || inputs.cfg;
      if (inputs.seed !== undefined && !Array.isArray(inputs.seed)) result.seed = result.seed || String(inputs.seed);
      if (inputs.scheduler && typeof inputs.scheduler === 'string') result.sampler = result.sampler ? `${result.sampler} (${inputs.scheduler})` : inputs.scheduler;
      if (inputs.noise_seed !== undefined && !Array.isArray(inputs.noise_seed)) result.seed = result.seed || String(inputs.noise_seed);
    }

    // Extract model name from checkpoint loaders
    if (cls.includes('CheckpointLoader') || cls.includes('CheckpointSimple') || cls.includes('CheckpointLoaderNF4')) {
      if (inputs.ckpt_name && typeof inputs.ckpt_name === 'string') result.model = result.model || inputs.ckpt_name;
    }

    // UNETLoader / DiffusionModelLoader
    if ((cls.includes('UNETLoader') || cls.includes('DiffusionModel')) && inputs.unet_name && typeof inputs.unet_name === 'string') {
      result.model = result.model || inputs.unet_name;
    }

    // LoRA loader — extract as extra info
    if (cls.includes('LoraLoader') || cls.includes('LoRA')) {
      if (inputs.lora_name && typeof inputs.lora_name === 'string') {
        result.model = result.model
          ? `${result.model} + ${inputs.lora_name}`
          : inputs.lora_name;
      }
    }

    // Seed nodes (rgthree, custom)
    if ((cls.includes('Seed') || cls.includes('seed')) && inputs.seed !== undefined && !Array.isArray(inputs.seed) && typeof inputs.seed === 'number') {
      result.seed = result.seed || String(inputs.seed);
    }

    // INTConstant nodes labeled as "Steps"
    if (cls.includes('INTConstant') && node._meta?.title?.toLowerCase().includes('step') && inputs.value && typeof inputs.value === 'number') {
      result.steps = result.steps || inputs.value;
    }

    // VAE loader
    if (cls.includes('VAELoader') && inputs.vae_name) {
      // Store VAE info in metadata but don't overwrite model
    }

    // Image size from EmptyLatentImage
    if (cls.includes('EmptyLatentImage') || cls.includes('EmptyImage')) {
      // Size info already comes from the image dimensions
    }
  }
}

/**
 * Parse A1111/Forge parameter string format:
 * "prompt text\nNegative prompt: negative text\nSteps: 20, Sampler: Euler a, CFG scale: 7, Seed: 12345, Size: 512x512, Model: v1-5"
 */
function parseA1111Parameters(params, result) {
  if (!params || typeof params !== 'string') return;

  result.metadata_raw = result.metadata_raw || params;

  const lines = params.split('\n');
  let promptLines = [];
  let negativeLines = [];
  let paramsLine = '';
  let inNegative = false;

  for (const line of lines) {
    if (line.startsWith('Negative prompt:')) {
      inNegative = true;
      negativeLines.push(line.replace('Negative prompt:', '').trim());
    } else if (line.match(/^(Steps|Sampler|CFG scale|Seed|Size|Model):/i) || line.match(/^Steps:\s*\d/)) {
      inNegative = false;
      paramsLine = line;
    } else if (inNegative) {
      negativeLines.push(line);
    } else {
      promptLines.push(line);
    }
  }

  if (promptLines.length > 0) result.prompt = result.prompt || promptLines.join('\n').trim();
  if (negativeLines.length > 0) result.negative_prompt = result.negative_prompt || negativeLines.join('\n').trim();

  // Parse the key-value parameters line
  if (paramsLine) {
    const kvPairs = paramsLine.split(',').map(s => s.trim());
    for (const pair of kvPairs) {
      const colonIdx = pair.indexOf(':');
      if (colonIdx === -1) continue;
      const key = pair.substring(0, colonIdx).trim().toLowerCase();
      const value = pair.substring(colonIdx + 1).trim();

      if (key === 'steps') result.steps = result.steps || parseInt(value);
      else if (key === 'sampler') result.sampler = result.sampler || value;
      else if (key === 'cfg scale') result.cfg_scale = result.cfg_scale || parseFloat(value);
      else if (key === 'seed') result.seed = result.seed || value;
      else if (key === 'model' || key === 'model hash') result.model = result.model || value;
    }
  }
}

/**
 * Parse JPEG EXIF for A1111 metadata (stored in UserComment).
 */
function parseJpegExif(filePath, result) {
  const buf = fs.readFileSync(filePath);
  // Look for "parameters" text in the EXIF UserComment or XMP
  const text = buf.toString('latin1');

  // A1111 sometimes embeds the full parameter string in the file
  const paramsMatch = text.match(/parameters[\x00\s]*:?\s*([\s\S]*?)(?:UNICODE|$)/i);
  if (paramsMatch) {
    parseA1111Parameters(paramsMatch[1].trim(), result);
  }
}

/**
 * Parse WebP EXIF — similar approach to JPEG.
 */
function parseWebpExif(filePath, result) {
  const buf = fs.readFileSync(filePath);
  const text = buf.toString('latin1');
  const paramsMatch = text.match(/parameters[\x00\s]*:?\s*([\s\S]*?)(?:\x00\x00|$)/i);
  if (paramsMatch) {
    parseA1111Parameters(paramsMatch[1].trim(), result);
  }
}

/**
 * Extract video metadata using ffprobe.
 * Returns technical info (codec, fps, bitrate) and any embedded AI generation data.
 */
function extractVideoMetadata(filePath) {
  const ffmpeg = require('fluent-ffmpeg');

  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        resolve({ video_metadata: null, has_metadata: false });
        return;
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
      const format = metadata.format || {};

      const result = {
        has_metadata: true,
        metadata_raw: null,
        prompt: null,
        negative_prompt: null,
        model: null,
        sampler: null,
        steps: null,
        cfg_scale: null,
        seed: null,
        prompt_json: null,
        workflow_json: null,
        video_metadata: {
          // Video track
          video_codec: videoStream?.codec_name || null,
          video_codec_long: videoStream?.codec_long_name || null,
          width: videoStream?.width || null,
          height: videoStream?.height || null,
          fps: videoStream?.r_frame_rate ? (videoStream.r_frame_rate.includes('/') ? parseInt(videoStream.r_frame_rate.split('/')[0]) / parseInt(videoStream.r_frame_rate.split('/')[1]) : parseFloat(videoStream.r_frame_rate)) : null,
          bitrate: format.bit_rate ? parseInt(format.bit_rate) : null,
          duration: format.duration ? parseFloat(format.duration) : null,
          // Audio track
          audio_codec: audioStream?.codec_name || null,
          audio_channels: audioStream?.channels || null,
          audio_sample_rate: audioStream?.sample_rate || null,
          // Container
          container: format.format_long_name || format.format_name || null,
          // Total streams
          stream_count: metadata.streams.length,
        },
      };

      // Check for embedded metadata in format tags
      const tags = { ...format.tags, ...videoStream?.tags };
      const rawParts = [];

      if (tags) {
        // Check comment field — may contain ComfyUI workflow JSON or plain text
        if (tags.comment) {
          try {
            const commentData = JSON.parse(tags.comment);
            // ComfyUI embeds workflow as {"prompt": "{...}", "workflow": "{...}"}
            if (commentData.prompt) {
              const promptData = typeof commentData.prompt === 'string' ? JSON.parse(commentData.prompt) : commentData.prompt;
              // Parse ComfyUI nodes to extract human-readable prompt/model/sampler
              parseComfyUIPrompt(promptData, result);
              result.prompt_json = typeof commentData.prompt === 'string' ? commentData.prompt : JSON.stringify(commentData.prompt);
              if (commentData.workflow) result.workflow_json = typeof commentData.workflow === 'string' ? commentData.workflow : JSON.stringify(commentData.workflow);
              rawParts.push(tags.comment.substring(0, 5000));
            } else if (commentData.class_type || Object.values(commentData).some(n => n?.class_type)) {
              // Direct prompt format (flat dict of nodes)
              parseComfyUIPrompt(commentData, result);
              result.prompt_json = tags.comment;
              rawParts.push(tags.comment.substring(0, 5000));
            } else {
              // Other JSON — check for common fields
              if (commentData.model) result.model = commentData.model;
              if (commentData.seed) result.video_metadata.seed = String(commentData.seed);
              rawParts.push(tags.comment.substring(0, 2000));
            }
          } catch (e) {
            // Not JSON — treat as plain text prompt
            if (tags.comment.length < 2000) {
              result.prompt = tags.comment;
              rawParts.push(tags.comment);
            }
          }
        }

        if (tags.description && !result.prompt) { rawParts.push(tags.description); result.prompt = tags.description; }
        if (tags.title && tags.title !== filePath) { rawParts.push(`Title: ${tags.title}`); }
        if (tags.encoder && !result.model) { result.model = tags.encoder; }
        if (tags.creation_time) { rawParts.push(`Created: ${tags.creation_time}`); }

        // Check other tags for JSON metadata (Runway, Pika, Kling)
        for (const [key, val] of Object.entries(tags)) {
          if (key === 'comment' || key === 'description' || key === 'encoder') continue;
          if (typeof val === 'string' && val.startsWith('{')) {
            try {
              const parsed = JSON.parse(val);
              if (parsed.prompt && !result.prompt) result.prompt = parsed.prompt;
              if (parsed.model && !result.model) result.model = parsed.model;
              if (parsed.seed) result.video_metadata.seed = String(parsed.seed);
              rawParts.push(`${key}: ${val.substring(0, 1000)}`);
            } catch (e) { /* not JSON */ }
          }
        }
      }

      if (rawParts.length > 0) result.metadata_raw = rawParts.join('\n');
      result.has_metadata = !!(result.prompt || result.metadata_raw || result.video_metadata.video_codec);

      resolve(result);
    });
  });
}

module.exports = { extractMetadata, extractVideoMetadata };
