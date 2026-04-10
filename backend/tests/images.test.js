const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { createApp } = require('./setup');

const app = createApp();

describe('Images', () => {
  let token;
  let userId;
  let imageId;

  // Register a user first
  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'imguser', password: 'TestPass123' });
    token = res.body.token;
    userId = res.body.user.id;
  });

  describe('GET /api/images', () => {
    it('should return empty image list', async () => {
      const res = await request(app)
        .get('/api/images')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.images).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });
  });

  describe('GET /api/images/public', () => {
    it('should return public images without auth', async () => {
      const res = await request(app).get('/api/images/public');
      expect(res.status).toBe(200);
      expect(res.body.images).toBeDefined();
    });
  });

  describe('GET /api/images/search', () => {
    it('should require search query', async () => {
      const res = await request(app).get('/api/images/search');
      expect(res.status).toBe(400);
    });

    it('should search with query', async () => {
      const res = await request(app)
        .get('/api/images/search?q=test')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.images).toBeDefined();
    });
  });

  describe('Image CRUD via DB', () => {
    // Since upload requires multer/files, test via direct DB insert + API read
    beforeAll(() => {
      const { getDb } = require('../db');
      const db = getDb();
      const info = db.prepare(`
        INSERT INTO images (user_id, filename, original_name, filepath, title, width, height, file_size, format, visibility, prompt, model)
        VALUES (?, 'test.png', 'test.png', 'test.png', 'Test Image', 1024, 768, 50000, 'png', 'private', 'a beautiful sunset', 'sd-v1-5')
      `).run(userId);
      imageId = info.lastInsertRowid;

      // Add a public image
      db.prepare(`
        INSERT INTO images (user_id, filename, original_name, filepath, title, width, height, file_size, format, visibility)
        VALUES (?, 'pub.png', 'pub.png', 'pub.png', 'Public Image', 512, 512, 25000, 'png', 'public')
      `).run(userId);
    });

    it('should return user images on /mine', async () => {
      const res = await request(app)
        .get('/api/images/mine')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
    });

    it('should get single image by id', async () => {
      const res = await request(app)
        .get(`/api/images/${imageId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Test Image');
      expect(res.body.prompt).toBe('a beautiful sunset');
      expect(res.body.tags).toBeDefined();
      expect(res.body.tagging_status).toBeDefined();
    });

    it('should not expose private images without auth', async () => {
      const res = await request(app).get(`/api/images/${imageId}`);
      expect(res.status).toBe(404);
    });

    it('should toggle visibility', async () => {
      const res = await request(app)
        .put(`/api/images/${imageId}/visibility`)
        .set('Authorization', `Bearer ${token}`)
        .send({ visibility: 'public' });

      expect(res.status).toBe(200);
      expect(res.body.visibility).toBe('public');

      // Now accessible without auth
      const pub = await request(app).get(`/api/images/${imageId}`);
      expect(pub.status).toBe(200);

      // Revert
      await request(app)
        .put(`/api/images/${imageId}/visibility`)
        .set('Authorization', `Bearer ${token}`)
        .send({ visibility: 'private' });
    });

    it('should favorite and unfavorite', async () => {
      const fav = await request(app)
        .post(`/api/images/${imageId}/favorite`)
        .set('Authorization', `Bearer ${token}`);

      expect(fav.status).toBe(200);
      expect(fav.body.favorited).toBe(true);

      // Check favorites list
      const list = await request(app)
        .get('/api/images/favorites')
        .set('Authorization', `Bearer ${token}`);

      expect(list.status).toBe(200);
      expect(list.body.images.length).toBeGreaterThanOrEqual(1);

      // Unfavorite
      const unfav = await request(app)
        .post(`/api/images/${imageId}/favorite`)
        .set('Authorization', `Bearer ${token}`);

      expect(unfav.body.favorited).toBe(false);
    });
  });

  describe('Collections', () => {
    let collectionId;

    it('should create a collection', async () => {
      const res = await request(app)
        .post('/api/collections')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Test Collection', description: 'A test' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Test Collection');
      collectionId = res.body.id;
    });

    it('should list collections', async () => {
      const res = await request(app)
        .get('/api/collections')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('should add image to collection', async () => {
      const res = await request(app)
        .post(`/api/collections/${collectionId}/images`)
        .set('Authorization', `Bearer ${token}`)
        .send({ imageIds: [imageId] });

      expect(res.status).toBe(200);
      expect(res.body.added).toBe(1);
    });

    it('should get collection detail', async () => {
      const res = await request(app)
        .get(`/api/collections/${collectionId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.image_count).toBe(1);
    });

    it('should delete collection', async () => {
      const res = await request(app)
        .delete(`/api/collections/${collectionId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });
  });

  describe('Tags', () => {
    it('should list tags', async () => {
      const res = await request(app).get('/api/tags');
      expect(res.status).toBe(200);
      expect(res.body.tags).toBeDefined();
    });

    it('should add manual tag to image', async () => {
      const res = await request(app)
        .post(`/api/tags/image/${imageId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'sunset', category: 'manual' });

      expect(res.status).toBe(200);
      expect(res.body.tags.some(t => t.name === 'sunset')).toBe(true);
    });

    it('should get tags for image', async () => {
      const res = await request(app).get(`/api/tags/image/${imageId}`);
      expect(res.status).toBe(200);
      expect(res.body.tags.some(t => t.name === 'sunset')).toBe(true);
    });

    it('should remove tag from image', async () => {
      const tagRes = await request(app).get(`/api/tags/image/${imageId}`);
      const tag = tagRes.body.tags.find(t => t.name === 'sunset');

      const res = await request(app)
        .delete(`/api/tags/image/${imageId}/${tag.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.tags.some(t => t.name === 'sunset')).toBe(false);
    });

    it('should get job queue stats', async () => {
      const res = await request(app)
        .get('/api/tags/jobs/stats')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.pending).toBeDefined();
      expect(res.body.done).toBeDefined();
    });
  });
});
