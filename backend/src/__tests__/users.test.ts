jest.mock('../db', () => ({
  query: jest.fn(),
}));

import request from 'supertest';
import express from 'express';
import usersRouter from '../routes/users';
import { query } from '../db';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_please_change_in_production';

// Helper to generate auth token cookie
const makeCookie = (payload: any) => {
  const token = jwt.sign(payload, JWT_SECRET);
  return `token=${token}`;
};

describe('Users API Router', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/users', usersRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Default query implementation to handle queries in testing cleanly
    (query as jest.Mock).mockImplementation((text: string) => {
      if (text.includes('SELECT COUNT(*)::integer')) {
        return Promise.resolve({ rows: [{ count: 1 }] });
      }
      if (text.includes('SELECT id, email, role, password_hash FROM users WHERE id = $1')) {
        return Promise.resolve({
          rows: [{ id: 'user-789', email: 'user@test.local', role: 'user', password_hash: 'old_hash' }]
        });
      }
      if (text.includes('SELECT id FROM users WHERE email = $1')) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('UPDATE users')) {
        return Promise.resolve({
          rows: [{ id: 'user-789', email: 'updated@test.local', role: 'user', created_at: new Date() }]
        });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  describe('GET /api/users', () => {
    it('should reject requests from non-admin users', async () => {
      const cookie = makeCookie({ id: 'user-1', email: 'user@test.local', role: 'user' });

      const res = await request(app)
        .get('/api/users')
        .set('Cookie', cookie);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should return user list for admin requesters', async () => {
      const cookie = makeCookie({ id: 'admin-1', email: 'admin@test.local', role: 'admin' });
      const mockUsers = [
        { id: 'user-1', email: 'user1@test.local', role: 'user', created_at: new Date() },
        { id: 'user-2', email: 'user2@test.local', role: 'viewer', created_at: new Date() }
      ];

      (query as jest.Mock).mockImplementation((text: string) => {
        if (text.includes('SELECT id, email, role, created_at FROM users')) {
          return Promise.resolve({ rows: mockUsers });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .get('/api/users')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });
  });

  describe('POST /api/users', () => {
    it('should allow admin to create a new user', async () => {
      const cookie = makeCookie({ id: 'admin-1', email: 'admin@test.local', role: 'admin' });
      
      (query as jest.Mock).mockImplementation((text: string) => {
        if (text.includes('SELECT id FROM users WHERE email = $1')) {
          return Promise.resolve({ rows: [] });
        }
        if (text.includes('INSERT INTO users')) {
          return Promise.resolve({
            rows: [{ id: 'new-user-123', email: 'new@test.local', role: 'user', created_at: new Date() }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .post('/api/users')
        .set('Cookie', cookie)
        .send({
          email: 'new@test.local',
          password: 'securePassword123',
          role: 'user'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('new@test.local');
    });

    it('should reject email collision', async () => {
      const cookie = makeCookie({ id: 'admin-1', email: 'admin@test.local', role: 'admin' });
      
      (query as jest.Mock).mockImplementation((text: string) => {
        if (text.includes('SELECT id FROM users WHERE email = $1')) {
          return Promise.resolve({ rows: [{ id: 'user-old' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .post('/api/users')
        .set('Cookie', cookie)
        .send({
          email: 'existing@test.local',
          password: 'securePassword123'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('already registered');
    });
  });

  describe('PUT /api/users/:id', () => {
    it('should allow user to update their own profile details', async () => {
      const selfCookie = makeCookie({ id: 'user-789', email: 'user@test.local', role: 'user' });

      const res = await request(app)
        .put('/api/users/user-789')
        .set('Cookie', selfCookie)
        .send({
          email: 'updated@test.local'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('updated@test.local');
    });

    it('should prevent non-admins from changing roles', async () => {
      const selfCookie = makeCookie({ id: 'user-789', email: 'user@test.local', role: 'user' });

      const res = await request(app)
        .put('/api/users/user-789')
        .set('Cookie', selfCookie)
        .send({
          role: 'admin'
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Only administrators can change account roles');
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('should allow admin to delete user', async () => {
      const cookie = makeCookie({ id: 'admin-1', email: 'admin@test.local', role: 'admin' });

      (query as jest.Mock).mockImplementation((text: string) => {
        if (text.includes('SELECT id, email, role FROM users WHERE id = $1')) {
          return Promise.resolve({
            rows: [{ id: 'user-789', email: 'user@test.local', role: 'user' }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .delete('/api/users/user-789')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should prevent admin from deleting themselves', async () => {
      const cookie = makeCookie({ id: 'admin-1', email: 'admin@test.local', role: 'admin' });

      const res = await request(app)
        .delete('/api/users/admin-1')
        .set('Cookie', cookie);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('cannot delete their own accounts');
    });
  });
});
