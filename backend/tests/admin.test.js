const request = require('supertest');
const { createApp } = require('./setup');

const app = createApp();

describe('Admin', () => {
  let adminToken, memberToken, adminId, memberId;

  beforeAll(async () => {
    // First user is admin
    const admin = await request(app)
      .post('/api/auth/register')
      .send({ username: 'admintestuser', password: 'Admin123!', display_name: 'Admin' });
    adminToken = admin.body.token;
    adminId = admin.body.user.id;

    // Second user is member
    const member = await request(app)
      .post('/api/auth/register')
      .send({ username: 'membertestuser', password: 'Member123!', display_name: 'Member' });
    memberToken = member.body.token;
    memberId = member.body.user.id;
  });

  // ─── Authorization ───
  describe('Authorization', () => {
    it('should reject unauthenticated requests', async () => {
      const res = await request(app).get('/api/admin/stats');
      expect(res.status).toBe(401);
    });

    it('should reject non-admin users', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/admin/i);
    });
  });

  // ─── GET /api/admin/stats ───
  describe('GET /api/admin/stats', () => {
    it('should return system stats for admin', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('users');
      expect(res.body).toHaveProperty('images');
      expect(res.body).toHaveProperty('videos');
      expect(res.body).toHaveProperty('favorites');
      expect(res.body).toHaveProperty('storage');
      expect(res.body).toHaveProperty('orphans');
      expect(res.body).toHaveProperty('orphanFiles');
      expect(res.body.users).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── GET /api/admin/users ───
  describe('GET /api/admin/users', () => {
    it('should list all users with stats', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);

      const admin = res.body.find(u => u.username === 'admintestuser');
      expect(admin).toBeDefined();
      expect(admin.role).toBe('admin');
      expect(admin).toHaveProperty('image_count');
      expect(admin).toHaveProperty('storage_used');
    });
  });

  // ─── PUT /api/admin/users/:id/role ───
  describe('PUT /api/admin/users/:id/role', () => {
    it('should change user role', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${memberId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Revert back to member
      await request(app)
        .put(`/api/admin/users/${memberId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'member' });
    });

    it('should reject invalid role', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${memberId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'superadmin' });

      expect(res.status).toBe(400);
    });

    it('should prevent admin from demoting self', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${adminId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'member' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/demote yourself/i);
    });
  });

  // ─── POST /api/admin/users/:id/reset-password ───
  describe('POST /api/admin/users/:id/reset-password', () => {
    it('should reset user password', async () => {
      const res = await request(app)
        .post(`/api/admin/users/${memberId}/reset-password`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newPassword: 'ResetPass123!' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify login with new password
      const login = await request(app)
        .post('/api/auth/login')
        .send({ username: 'membertestuser', password: 'ResetPass123!' });
      expect(login.status).toBe(200);
    });

    it('should reject short password', async () => {
      const res = await request(app)
        .post(`/api/admin/users/${memberId}/reset-password`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newPassword: 'ab' });

      expect(res.status).toBe(400);
    });
  });

  // ─── PUT /api/admin/users/:id/disable ───
  describe('PUT /api/admin/users/:id/disable', () => {
    it('should toggle user disabled state', async () => {
      // Disable
      const res = await request(app)
        .put(`/api/admin/users/${memberId}/disable`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.disabled).toBe(true);

      // Re-enable
      const res2 = await request(app)
        .put(`/api/admin/users/${memberId}/disable`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res2.status).toBe(200);
      expect(res2.body.disabled).toBe(false);
    });

    it('should prevent admin from disabling self', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${adminId}/disable`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/yourself/i);
    });
  });

  // ─── PUT /api/admin/users/:id/quota ───
  describe('PUT /api/admin/users/:id/quota', () => {
    it('should set storage quota for user', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${memberId}/quota`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quota_gb: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.quota_bytes).toBe(Math.round(5 * 1024 * 1024 * 1024));
    });

    it('should reject missing quota_gb', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${memberId}/quota`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/admin/recalculate-storage ───
  describe('POST /api/admin/recalculate-storage', () => {
    it('should recalculate storage for all users', async () => {
      const res = await request(app)
        .post('/api/admin/recalculate-storage')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.recalculated).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── GET /api/admin/generation-stats ───
  describe('GET /api/admin/generation-stats', () => {
    it('should return generation statistics', async () => {
      const res = await request(app)
        .get('/api/admin/generation-stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('models');
      expect(res.body).toHaveProperty('samplers');
      expect(res.body).toHaveProperty('resolutions');
      expect(res.body).toHaveProperty('mediaTypes');
      expect(res.body).toHaveProperty('uploadsOverTime');
      expect(res.body).toHaveProperty('topTags');
      expect(res.body).toHaveProperty('perUser');
      expect(Array.isArray(res.body.models)).toBe(true);
      expect(Array.isArray(res.body.perUser)).toBe(true);
    });
  });

  // ─── GET /api/admin/audit ───
  describe('GET /api/admin/audit', () => {
    it('should return audit logs', async () => {
      const res = await request(app)
        .get('/api/admin/audit')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('logs');
      expect(res.body).toHaveProperty('total');
    });

    it('should support limit and offset', async () => {
      const res = await request(app)
        .get('/api/admin/audit?limit=5&offset=0')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBeLessThanOrEqual(5);
    });
  });

  // ─── DELETE /api/admin/orphans ───
  describe('DELETE /api/admin/orphans', () => {
    it('should purge orphaned DB records', async () => {
      // Insert an orphan image (no user_id)
      const { getDb } = require('../db');
      const db = getDb();
      db.prepare(`
        INSERT INTO images (user_id, filename, original_name, filepath, title, format, visibility)
        VALUES (NULL, 'orphan.png', 'orphan.png', 'orphan.png', 'Orphan', 'png', 'public')
      `).run();

      const res = await request(app)
        .delete('/api/admin/orphans')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.deleted).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── POST /api/admin/assign-orphans/:userId ───
  describe('POST /api/admin/assign-orphans/:userId', () => {
    it('should assign unowned images to specified user', async () => {
      // Insert orphan images
      const { getDb } = require('../db');
      const db = getDb();
      db.prepare(`
        INSERT INTO images (user_id, filename, original_name, filepath, title, format, visibility)
        VALUES (NULL, 'orphan2.png', 'orphan2.png', 'orphan2.png', 'Orphan2', 'png', 'public')
      `).run();

      const res = await request(app)
        .post(`/api/admin/assign-orphans/${memberId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.assigned).toBeGreaterThanOrEqual(1);

      // Verify the image is now owned by member
      const img = db.prepare("SELECT user_id FROM images WHERE filename = 'orphan2.png'").get();
      expect(img.user_id).toBe(memberId);
    });
  });
});
