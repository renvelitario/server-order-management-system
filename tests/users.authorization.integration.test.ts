import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    req.user = { id: 'user-1', email: 'user@test.com' };
    req.localUser = { user_id: 10, acc_type: 'User', status: 'Active' };
    next();
  },
}));

vi.mock('../src/db/db.js', () => ({
  db: {
    select: vi.fn(),
  },
}));

describe('users endpoint authorization', () => {
  it('blocks non-admin user from listing users', async () => {
    const usersRouter = (await import('../src/routes/users.js')).default;
    const { errorHandler } = await import('../src/utils/errors.js');

    const app = express();
    app.use(express.json());
    app.use('/api/users', usersRouter);
    app.use(errorHandler);

    const response = await request(app).get('/api/users');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('You are not authorized to perform this action.');
  });
});
