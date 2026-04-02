import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
const mockSelectLimit = vi.fn();

vi.mock('../src/db/db.js', () => ({
  supabaseAdmin: {
    auth: {
      getUser: mockGetUser,
    },
  },
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockSelectLimit,
        })),
      })),
    })),
  },
}));

describe('requireAuth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks requests with missing authorization header', async () => {
    const { requireAuth } = await import('../src/middleware/auth.js');
    const req = { headers: {} };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('blocks disabled users', async () => {
    const { requireAuth } = await import('../src/middleware/auth.js');

    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'user@test.com' } },
      error: null,
    });

    mockSelectLimit
      .mockResolvedValueOnce([
        {
          user_id: 1,
          email: 'user@test.com',
          username: 'User',
          acc_type: 'User',
          status: 'Disabled',
          inactivity_timeout_minutes: 60,
          supabase_id: 'user-1',
        },
      ]);

    const req = { headers: { authorization: 'Bearer token' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows active users', async () => {
    const { requireAuth } = await import('../src/middleware/auth.js');

    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@test.com' } },
      error: null,
    });

    mockSelectLimit
      .mockResolvedValueOnce([
        {
          user_id: 1,
          email: 'admin@test.com',
          username: 'Admin',
          acc_type: 'Admin',
          status: 'Active',
          inactivity_timeout_minutes: 60,
          supabase_id: 'admin-1',
        },
      ]);

    const req = { headers: { authorization: 'Bearer token' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.localUser.acc_type).toBe('Admin');
  });
});
