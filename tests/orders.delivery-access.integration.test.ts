import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSelect = vi.fn();
const mockUpdate = vi.fn();

const mockLocalUser = {
  user_id: 7,
  acc_type: 'User',
  status: 'Active',
  name: 'Delivery Rider',
};

vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'delivery-1', email: 'delivery@test.com' };
    req.localUser = { ...mockLocalUser };
    next();
  },
}));

vi.mock('../src/db/db.js', () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
}));

vi.mock('../src/utils/notifications.js', () => ({
  createNotificationsForRole: vi.fn(async () => 0),
}));

const createOrderLookupBuilder = (result) => ({
  from: () => ({
    leftJoin: () => ({
      where: () => ({
        limit: async () => result,
      }),
    }),
    where: () => ({
      limit: async () => result,
    }),
  }),
});

const createItemsLookupBuilder = (result) => ({
  from: () => ({
    leftJoin: () => ({
      where: async () => result,
    }),
  }),
});

const createUpdateBuilder = (result) => ({
  set: () => ({
    where: () => ({
      returning: async () => result,
    }),
  }),
});

const buildTodayDate = () => new Date().toISOString();
const buildYesterdayDate = () => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString();
};

const createApp = async () => {
  const router = (await import('../src/routes/orders.js')).default;
  const { errorHandler } = await import('../src/utils/errors.js');
  const app = express();
  app.use(express.json());
  app.use('/api/orders', router);
  app.use(errorHandler);
  return app;
};

describe('delivery user order access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalUser.acc_type = 'User';
  });

  it('blocks delivery users from opening orders that are not out for delivery today', async () => {
    const app = await createApp();

    mockSelect.mockImplementationOnce(() => createOrderLookupBuilder([
      {
        order_id: 123,
        customer_id: 4,
        order_date: buildTodayDate(),
        delivery_date: buildTodayDate(),
        delivery_status: 'pending',
        delivery_user_id: null,
        delivered_at: null,
        delivered_by: null,
        customer_name: 'Customer A',
        address: 'Address',
        contact_no: '1234567',
      },
    ]));

    const response = await request(app)
      .get('/api/orders/123')
      .set('X-Client-Utc-Offset-Minutes', '0');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Delivery users can only access orders that are out for delivery today.');
  });

  it('allows delivery users to open orders that are out for delivery today', async () => {
    const app = await createApp();

    mockSelect
      .mockImplementationOnce(() => createOrderLookupBuilder([
        {
          order_id: 123,
          customer_id: 4,
          order_date: buildTodayDate(),
          delivery_date: buildTodayDate(),
          delivery_status: 'out_for_delivery',
          delivery_user_id: null,
          delivered_at: null,
          delivered_by: null,
          customer_name: 'Customer A',
          address: 'Address',
          contact_no: '1234567',
        },
      ]))
      .mockImplementationOnce(() => createItemsLookupBuilder([
        {
          product_id: 50,
          sku: 'ABC12345',
          quantity: 2,
          price: 75,
          product_name: 'Notebook',
        },
      ]));

    const response = await request(app)
      .get('/api/orders/123')
      .set('X-Client-Utc-Offset-Minutes', '0');

    expect(response.status).toBe(200);
    expect(response.body.order_id).toBe(123);
    expect(response.body.total_amount).toBe(150);
  });

  it('allows delivery users to open delivered orders that are scheduled for today', async () => {
    const app = await createApp();

    mockSelect
      .mockImplementationOnce(() => createOrderLookupBuilder([
        {
          order_id: 124,
          customer_id: 4,
          order_date: buildTodayDate(),
          delivery_date: buildTodayDate(),
          delivery_status: 'delivered',
          delivery_user_id: null,
          delivered_at: buildTodayDate(),
          delivered_by: 7,
          customer_name: 'Customer B',
          address: 'Address',
          contact_no: '1234567',
        },
      ]))
      .mockImplementationOnce(() => createItemsLookupBuilder([
        {
          product_id: 51,
          sku: 'XYZ98765',
          quantity: 1,
          price: 50,
          product_name: 'Planner',
        },
      ]));

    const response = await request(app)
      .get('/api/orders/124')
      .set('X-Client-Utc-Offset-Minutes', '0');

    expect(response.status).toBe(200);
    expect(response.body.order_id).toBe(124);
  });

  it('blocks delivery users from updating orders outside today\'s out-for-delivery queue', async () => {
    const app = await createApp();

    mockSelect.mockImplementationOnce(() => createOrderLookupBuilder([
      {
        order_id: 123,
        delivery_status: 'out_for_delivery',
        delivery_user_id: null,
        delivery_date: buildYesterdayDate(),
      },
    ]));

    const response = await request(app)
      .patch('/api/orders/123/delivery-status')
      .set('X-Client-Utc-Offset-Minutes', '0')
      .send({ delivery_status: 'delivered' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Delivery users can only update orders that are out for delivery today.');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('allows delivery users to complete today\'s out-for-delivery orders', async () => {
    const app = await createApp();

    mockSelect.mockImplementationOnce(() => createOrderLookupBuilder([
      {
        order_id: 123,
        delivery_status: 'out_for_delivery',
        delivery_user_id: null,
        delivery_date: buildTodayDate(),
      },
    ]));
    mockUpdate.mockImplementationOnce(() => createUpdateBuilder([{ order_id: 123 }]));

    const response = await request(app)
      .patch('/api/orders/123/delivery-status')
      .set('X-Client-Utc-Offset-Minutes', '0')
      .send({ delivery_status: 'delivered' });

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('allows delivery users to undo a delivered order scheduled for today', async () => {
    const app = await createApp();

    mockSelect.mockImplementationOnce(() => createOrderLookupBuilder([
      {
        order_id: 125,
        delivery_status: 'delivered',
        delivery_user_id: null,
        delivery_date: buildTodayDate(),
      },
    ]));
    mockUpdate.mockImplementationOnce(() => createUpdateBuilder([{ order_id: 125 }]));

    const response = await request(app)
      .patch('/api/orders/125/delivery-status')
      .set('X-Client-Utc-Offset-Minutes', '0')
      .send({ delivery_status: 'out_for_delivery' });

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });
});