import { describe, expect, it, vi } from 'vitest';
import { requireAdmin } from '../src/middleware/rbac.js';

describe('RBAC middleware', () => {
  it('blocks non-admin users', () => {
    const req = { localUser: { acc_type: 'User' } };
    const res = {};
    const next = vi.fn();

    expect(() => requireAdmin(req, res, next)).toThrowError('You are not authorized to perform this action.');
    expect(next).not.toHaveBeenCalled();
  });

  it('allows admin users', () => {
    const req = { localUser: { acc_type: 'Admin' } };
    const res = {};
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
