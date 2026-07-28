/**
 * Directory client — keeps this instance listed on the configured Artifex
 * directory while discovery is enabled. Registers on boot and every 6 hours
 * (the directory hides entries unseen for 24h). After 3 consecutive failures
 * the status turns 'unreachable', which the admin Federation tab surfaces as
 * a warning banner.
 */
const { getDb } = require('../db');

const HEARTBEAT_MS = 6 * 60 * 60 * 1000;
const FAIL_THRESHOLD = 3;

let timer = null;
let state = { status: 'idle', last_success: null, last_error: null, failures: 0 };

function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM instance_settings WHERE key = ?').get(key);
  return row?.value ?? null;
}

function isEnabled() {
  return getSetting('discovery_enabled') === 'true' && !!getSetting('directory_url');
}

async function post(route, body) {
  const base = (getSetting('directory_url') || '').replace(/\/+$/, '');
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } finally { clearTimeout(t); }
}

async function registerOnce() {
  if (!isEnabled()) { state = { status: 'disabled', last_success: state.last_success, last_error: null, failures: 0 }; return; }
  const selfUrl = getSetting('instance_url');
  if (!selfUrl) {
    state = { ...state, status: 'error', last_error: 'Set this instance\'s Public URL first — the directory must be able to reach it' };
    return;
  }
  try {
    await post('/api/directory/register', { url: selfUrl });
    state = { status: 'ok', last_success: new Date().toISOString(), last_error: null, failures: 0 };
  } catch (e) {
    state.failures += 1;
    state.last_error = e.message;
    state.status = state.failures >= FAIL_THRESHOLD ? 'unreachable' : 'degraded';
    if (state.status === 'unreachable') {
      console.error(`[Directory] Unreachable after ${state.failures} attempts: ${e.message}`);
    }
  }
}

// Best-effort removal when discovery gets turned off
async function unregister() {
  const selfUrl = getSetting('instance_url');
  if (!selfUrl || !getSetting('directory_url')) return;
  try { await post('/api/directory/unregister', { url: selfUrl }); } catch { /* directory will age us out */ }
}

function start() {
  if (timer) return;
  timer = setInterval(() => { registerOnce(); }, HEARTBEAT_MS);
  setTimeout(() => { registerOnce(); }, 15000);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

function getStatus() {
  return { enabled: isEnabled(), ...state };
}

module.exports = { start, stop, registerOnce, unregister, getStatus };
