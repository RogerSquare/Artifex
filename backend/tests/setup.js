/**
 * Test setup — creates an Express app using the real modules but with
 * a test database created via environment variable override.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// Set test DB path BEFORE any module loads
const TEST_DB = path.join(os.tmpdir(), `artifex-test-${Date.now()}.db`);
process.env.ARTIFEX_DB_PATH = TEST_DB;
process.env.NODE_ENV = 'test';

// Now require the app modules
const express = require('express');
const cors = require('cors');

function createApp() {
  const app = express();
  app.use(cors({ origin: '*' }));
  app.use(express.json());

  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/images', require('../routes/images'));
  app.use('/api/admin', require('../routes/admin'));
  app.use('/api/collections', require('../routes/collections'));
  app.use('/api/tags', require('../routes/tags'));

  return app;
}

// Cleanup
afterAll(() => {
  try {
    const { getDb } = require('../db');
    getDb().close();
  } catch (e) {}
  try { fs.unlinkSync(TEST_DB); } catch (e) {}
  try { fs.unlinkSync(TEST_DB + '-wal'); } catch (e) {}
  try { fs.unlinkSync(TEST_DB + '-shm'); } catch (e) {}
});

module.exports = { createApp, TEST_DB };
