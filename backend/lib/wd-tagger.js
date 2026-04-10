/**
 * WaifuDiffusion Tagger v3 (SmilingWolf/wd-swinv2-tagger-v3)
 * Runs via Python subprocess to avoid onnxruntime-node opset 24 crash on Windows.
 * Uses a persistent HTTP server for fast repeated calls.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'wd-tagger.py');
const MODEL_DIR = path.join(__dirname, '..', 'models', 'wd-swinv2-tagger-v3');
const MODEL_PATH = path.join(MODEL_DIR, 'model.onnx');
const TAGS_PATH = path.join(MODEL_DIR, 'selected_tags.csv');

const SERVER_PORT = 7865;
const PYTHON_CMD = process.env.PYTHON_CMD || 'python';

let serverProcess = null;
let serverReady = false;
let serverStarting = false;
let startQueue = [];

/**
 * Start the persistent Python WD Tagger server
 */
async function ensureServer() {
  if (serverReady) return true;

  if (serverStarting) {
    return new Promise((resolve) => startQueue.push(resolve));
  }

  serverStarting = true;
  console.log('[WD Tagger] Starting Python server...');

  return new Promise((resolve) => {
    serverProcess = spawn(PYTHON_CMD, [SCRIPT_PATH, '--server', String(SERVER_PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log('[WD Tagger]', msg);
      if (msg.includes('Server listening')) {
        serverReady = true;
        serverStarting = false;
        resolve(true);
        startQueue.forEach(cb => cb(true));
        startQueue = [];
      }
    });

    serverProcess.on('error', (err) => {
      console.error('[WD Tagger] Failed to start Python server:', err.message);
      serverReady = false;
      serverStarting = false;
      resolve(false);
      startQueue.forEach(cb => cb(false));
      startQueue = [];
    });

    serverProcess.on('exit', (code) => {
      console.log('[WD Tagger] Python server exited with code', code);
      serverReady = false;
      serverProcess = null;
    });

    // Timeout after 30s
    setTimeout(() => {
      if (!serverReady) {
        console.error('[WD Tagger] Server start timed out');
        serverStarting = false;
        resolve(false);
        startQueue.forEach(cb => cb(false));
        startQueue = [];
      }
    }, 30000);
  });
}

/**
 * Call the Python WD Tagger server
 */
function callServer(imagePath, options = {}) {
  const threshold = options.generalThreshold || 0.35;
  const maxTags = options.maxTags || 30;
  const allowNsfw = options.allowNsfw || false;

  return new Promise((resolve, reject) => {
    const url = `http://127.0.0.1:${SERVER_PORT}/?image=${encodeURIComponent(imagePath)}&threshold=${threshold}&max_tags=${maxTags}&allow_nsfw=${allowNsfw}`;

    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error));
          else resolve(parsed);
        } catch (e) {
          reject(new Error('Invalid JSON from WD Tagger server'));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Classify an image using WD Tagger
 * @param {string} imagePath
 * @param {Object} options
 * @returns {Array<{name: string, category: string, score: number}>}
 */
async function classify(imagePath, options = {}) {
  const ready = await ensureServer();
  if (!ready) throw new Error('WD Tagger server not available');
  return await callServer(imagePath, options);
}

function isReady() {
  return serverReady;
}

function isAvailable() {
  return fs.existsSync(MODEL_PATH) && fs.existsSync(TAGS_PATH) && fs.existsSync(SCRIPT_PATH);
}

function shutdown() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    serverReady = false;
  }
}

// Clean up on process exit
process.on('exit', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { classify, isReady, isAvailable, shutdown };
