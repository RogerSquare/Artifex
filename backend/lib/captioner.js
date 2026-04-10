/**
 * Image captioning using Salesforce/blip-image-captioning-large.
 * Runs via persistent Python HTTP server (same pattern as WD Tagger).
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { getDb } = require('../db');

const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'captioner.py');
const SERVER_PORT = 7866;
const PYTHON_CMD = process.env.PYTHON_CMD || 'python';

let serverProcess = null;
let serverReady = false;
let serverStarting = false;
let startQueue = [];

async function ensureServer() {
  if (serverReady) return true;
  if (serverStarting) {
    return new Promise((resolve) => startQueue.push(resolve));
  }

  serverStarting = true;
  console.log('[Captioner] Starting Python server...');

  return new Promise((resolve) => {
    serverProcess = spawn(PYTHON_CMD, [SCRIPT_PATH, '--server', String(SERVER_PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log('[Captioner]', msg);
      if (msg.includes('Server listening')) {
        serverReady = true;
        serverStarting = false;
        resolve(true);
        startQueue.forEach(cb => cb(true));
        startQueue = [];
      }
    });

    serverProcess.on('error', (err) => {
      console.error('[Captioner] Failed to start Python server:', err.message);
      serverReady = false;
      serverStarting = false;
      resolve(false);
      startQueue.forEach(cb => cb(false));
      startQueue = [];
    });

    serverProcess.on('exit', (code) => {
      console.log('[Captioner] Python server exited with code', code);
      serverReady = false;
      serverProcess = null;
    });

    // Timeout — BLIP large takes time to download on first run
    setTimeout(() => {
      if (!serverReady) {
        console.error('[Captioner] Server start timed out');
        serverStarting = false;
        resolve(false);
        startQueue.forEach(cb => cb(false));
        startQueue = [];
      }
    }, 120000);
  });
}

function callServer(imagePath) {
  return new Promise((resolve, reject) => {
    const url = `http://127.0.0.1:${SERVER_PORT}/?image=${encodeURIComponent(imagePath)}`;
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error));
          else resolve(parsed.caption);
        } catch (e) {
          reject(new Error('Invalid JSON from captioner server'));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Generate a caption for an image
 * @param {string} imagePath
 * @returns {Promise<string>}
 */
async function caption(imagePath) {
  const ready = await ensureServer();
  if (!ready) throw new Error('Captioner server not available');
  return await callServer(imagePath);
}

/**
 * Caption an image and store in the database
 * @param {number} imageId
 * @param {string} imagePath
 * @returns {Promise<string>}
 */
async function captionAndStore(imageId, imagePath) {
  const text = await caption(imagePath);
  const db = getDb();
  db.prepare('UPDATE images SET caption = ? WHERE id = ?').run(text, imageId);
  return text;
}

function isReady() {
  return serverReady;
}

function isAvailable() {
  return fs.existsSync(SCRIPT_PATH);
}

function shutdown() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    serverReady = false;
  }
}

process.on('exit', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { caption, captionAndStore, isReady, isAvailable, shutdown };
