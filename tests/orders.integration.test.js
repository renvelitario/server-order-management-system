import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTransaction = vi.fn();

vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    req.user = { id: 'admin-1', email: 'admin@test.com' };
    req.localUser = { user_id: 1, acc_type: 'Admin', status: 'Active' };
    next();
  },
}));

vi.mock('../src/db/db.js', () => ({
  db: {
    transaction: mockTransaction,
  },
}));

describe('orders route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates order and updates inventory in a transaction', async () => {
    const router = (await import('../src/routes/orders.js')).default;

    mockTransaction.mockImplementation(async (handler) => {
      let insertCallCount = 0;
      const tx = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => ([
              { product_id: 1, quantity: 20, price: 50, status: 'active' },
            ])),
          })),
        })),
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            returning: vi.fn(async () => {
              insertCallCount += 1;
              if (insertCallCount === 1) {
                return [{ order_id: 100, customer_id: 2, order_date: new Date() }];
              }

              return [{ order_item_id: 200, order_id: 100, product_id: 1, quantity: 3, price: 50 }];
            }),
          })),
        })),
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(async () => []),
          })),
        })),
      };

      return handler(tx);
    });

    const app = express();
    app.use(express.json());
    app.use('/api/orders', router);

    const response = await request(app)
      .post('/api/orders')
      .send({
        customer_id: 2,
        items_data: [{ product_id: 1, quantity: 3 }],
      });

    expect(response.status).toBe(201);
    expect(response.body.total_amount).toBe(150);
    expect(mockTransaction).toHaveBeenCalled();
  });
});
