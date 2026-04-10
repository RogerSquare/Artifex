const request = require('supertest');
const { createApp } = require('./setup');

const app = createApp();

describe('Auth', () => {
  let token;
  let userId;

  describe('POST /api/auth/register', () => {
    it('should register the first user as admin', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'admin', password: 'TestPass123', display_name: 'Admin' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.role).toBe('admin');
      expect(res.body.user.username).toBe('admin');
      token = res.body.token;
      userId = res.body.user.id;
    });

    it('should register second user as member', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser', password: 'TestPass456', display_name: 'Test User' });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('member');
    });

    it('should reject duplicate username', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'admin', password: 'TestPass789' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already taken/i);
    });

    it('should reject weak password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'weakuser', password: 'abc' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/password/i);
    });

    it('should reject password without uppercase', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'weakuser', password: 'testpass123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/uppercase/i);
    });

    it('should reject missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'TestPass123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.username).toBe('admin');
    });

    it('should reject invalid password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'wrongpass' });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid/i);
    });

    it('should reject non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'nobody', password: 'TestPass123' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user with valid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.username).toBe('admin');
      expect(res.body.id).toBe(userId);
    });

    it('should reject without token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('should reject invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/auth/change-password', () => {
    it('should change password with correct current password', async () => {
      const res = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_password: 'TestPass123', new_password: 'NewPass456!' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject wrong current password', async () => {
      const res = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_password: 'wrongpass', new_password: 'NewPass789!' });

      expect(res.status).toBe(401);
    });

    it('should reject weak new password', async () => {
      const res = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_password: 'NewPass456!', new_password: 'weak' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/password-strength', () => {
    it('should rate weak password', async () => {
      const res = await request(app)
        .post('/api/auth/password-strength')
        .send({ password: 'abc' });

      expect(res.body.valid).toBe(false);
      expect(res.body.strength).toBe(0);
    });

    it('should rate strong password', async () => {
      const res = await request(app)
        .post('/api/auth/password-strength')
        .send({ password: 'MyStr0ngP@ss!' });

      expect(res.body.valid).toBe(true);
      expect(res.body.strength).toBeGreaterThanOrEqual(3);
    });
  });
});
