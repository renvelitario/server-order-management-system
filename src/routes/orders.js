import express from 'express';
import { db } from '../db/db.js';
import { customers, orders, orderItems, products } from '../db/schema.js';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, requireRole } from '../middleware/rbac.js';
import { asyncHandler, AppError } from '../utils/errors.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import { orderPayloadSchema, updateDeliveryStatusSchema } from '../validators/entity.js';
import { buildPaginatedResponse, parseListQuery } from '../utils/pagination.js';

const router = express.Router();
router.use(requireAuth);

const DELIVERY_STATUSES = {
  pending: 'pending',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  failed_delivery: 'failed_delivery',
};

const resolveTodayRange = () => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
};

router.get('/', requireRole('Admin', 'User'), asyncHandler(async (req, res) => {
  const { page, limit, offset, sort, search } = parseListQuery(req.query);
  const sortDirection = sort === 'asc' ? asc(orders.order_id) : desc(orders.order_id);
  const whereClause = search
    ? sql`(${orders.order_id}::text ILIKE ${`%${search}%`} OR ${orders.customer_id}::text ILIKE ${`%${search}%`})`
    : undefined;

  console.info('[DEBUG_PAGINATION]', {
    route: 'orders.list',
    query: req.query,
    parsed: { page, limit, offset, sort, search },
  });

  const [ordersPage, totalRows] = await Promise.all([
    db
      .select({
        order_id: orders.order_id,
        customer_id: orders.customer_id,
        order_date: orders.order_date,
        delivery_date: orders.delivery_date,
        delivery_status: orders.delivery_status,
        delivered_at: orders.delivered_at,
        delivered_by: orders.delivered_by,
      })
      .from(orders)
      .where(whereClause)
      .orderBy(sortDirection)
      .limit(limit)
      .offset(offset),
    db.select({ count: sql`count(*)::int` }).from(orders).where(whereClause),
  ]);

  const orderIds = ordersPage.map((order) => order.order_id);
  const pageItems = orderIds.length
    ? await db.select().from(orderItems).where(inArray(orderItems.order_id, orderIds))
    : [];

  const itemsByOrderId = pageItems.reduce((acc, item) => {
    const key = item.order_id;
    if (!acc.has(key)) {
      acc.set(key, []);
    }
    acc.get(key).push(item);
    return acc;
  }, new Map());

  const responseData = ordersPage.map((order) => {
    const items = itemsByOrderId.get(order.order_id) || [];
    const totalAmount = items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.price)), 0);

    return {
      ...order,
      items,
      total_amount: totalAmount,
    };
  });

  res.json(buildPaginatedResponse({
    data: responseData,
    total: Number(totalRows[0]?.count || 0),
    page,
    limit,
  }));
}));

router.get('/delivery/today', requireRole('Admin', 'User'), asyncHandler(async (req, res) => {
  const { page, limit, offset, sort, search } = parseListQuery(req.query);
  const sortDirection = sort === 'asc' ? asc(orders.order_id) : desc(orders.order_id);
  const { start, end } = resolveTodayRange();
  const filters = [
    gte(orders.delivery_date, start),
    lt(orders.delivery_date, end),
  ];

  if (search) {
    filters.push(sql`(
      ${orders.order_id}::text ILIKE ${`%${search}%`}
      OR ${customers.name} ILIKE ${`%${search}%`}
      OR ${customers.address} ILIKE ${`%${search}%`}
      OR ${customers.contact_no} ILIKE ${`%${search}%`}
      OR ${orders.delivery_status} ILIKE ${`%${search}%`}
    )`);
  }

  const whereClause = and(...filters);

  const [ordersPage, totalRows] = await Promise.all([
    db
      .select({
        order_id: orders.order_id,
        customer_id: orders.customer_id,
        order_date: orders.order_date,
        delivery_date: orders.delivery_date,
        delivery_status: orders.delivery_status,
        delivered_at: orders.delivered_at,
        delivered_by: orders.delivered_by,
        customer_name: customers.name,
        address: customers.address,
        contact_no: customers.contact_no,
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customer_id, customers.customer_id))
      .where(whereClause)
      .orderBy(sortDirection)
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql`count(*)::int` })
      .from(orders)
      .leftJoin(customers, eq(orders.customer_id, customers.customer_id))
      .where(whereClause),
  ]);

  const orderIds = ordersPage.map((order) => order.order_id);
  const pageItems = orderIds.length
    ? await db.select().from(orderItems).where(inArray(orderItems.order_id, orderIds))
    : [];

  const itemsByOrderId = pageItems.reduce((acc, item) => {
    const key = item.order_id;
    if (!acc.has(key)) {
      acc.set(key, []);
    }
    acc.get(key).push(item);
    return acc;
  }, new Map());

  const responseData = ordersPage.map((order) => {
    const items = itemsByOrderId.get(order.order_id) || [];
    const totalAmount = items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.price)), 0);

    return {
      ...order,
      items_count: items.length,
      total_amount: totalAmount,
    };
  });

  res.json(buildPaginatedResponse({
    data: responseData,
    total: Number(totalRows[0]?.count || 0),
    page,
    limit,
  }));
}));

router.get('/:id', requireRole('Admin', 'User'), validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  const order = await db
    .select({
      order_id: orders.order_id,
      customer_id: orders.customer_id,
      order_date: orders.order_date,
      delivery_date: orders.delivery_date,
      delivery_status: orders.delivery_status,
      delivered_at: orders.delivered_at,
      delivered_by: orders.delivered_by,
      customer_name: customers.name,
      address: customers.address,
      contact_no: customers.contact_no,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customer_id, customers.customer_id))
    .where(eq(orders.order_id, req.params.id))
    .limit(1);

  if (!order.length) {
    throw new AppError(404, 'Order not found.');
  }

  const items = await db.select().from(orderItems).where(eq(orderItems.order_id, order[0].order_id));
  const totalAmount = items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.price)), 0);

  res.json({
    ...order[0],
    items,
    total_amount: totalAmount,
  });
}));

router.post('/', requireAdmin, validate(orderPayloadSchema), asyncHandler(async (req, res) => {
  const { customer_id, items_data, delivery_date } = req.body;
  const uniqueProductIds = [...new Set(items_data.map((item) => item.product_id))];
  const quantityByProduct = items_data.reduce((acc, item) => {
    acc.set(item.product_id, (acc.get(item.product_id) || 0) + Number(item.quantity));
    return acc;
  }, new Map());

  const result = await db.transaction(async (tx) => {
    const productRows = await tx
      .select({
        product_id: products.product_id,
        quantity: products.quantity,
        price: products.price,
        status: products.status,
      })
      .from(products)
      .where(inArray(products.product_id, uniqueProductIds));

    const productById = new Map(productRows.map((row) => [row.product_id, row]));

    for (const productId of uniqueProductIds) {
      const product = productById.get(productId);
      if (!product) {
        throw new AppError(404, `Product ${productId} not found.`);
      }

      if (String(product.status).toLowerCase() !== 'active') {
        throw new AppError(400, `Product ${productId} is not active.`);
      }

      const requestedQty = quantityByProduct.get(productId) || 0;
      if (Number(product.quantity) < requestedQty) {
        throw new AppError(409, `Insufficient quantity for product ${productId}.`);
      }
    }

    const [newOrder] = await tx.insert(orders).values({
      customer_id,
      order_date: new Date(),
      delivery_date: delivery_date ? new Date(delivery_date) : new Date(),
      delivery_status: DELIVERY_STATUSES.pending,
    }).returning();

    const createdItems = [];

    for (const item of items_data) {
      const product = productById.get(item.product_id);
      const [createdItem] = await tx.insert(orderItems).values({
        order_id: newOrder.order_id,
        product_id: item.product_id,
        quantity: item.quantity,
        price: product.price,
      }).returning();

      createdItems.push(createdItem);
    }

    for (const [productId, requestedQty] of quantityByProduct.entries()) {
      const product = productById.get(productId);
      await tx
        .update(products)
        .set({ quantity: Number(product.quantity) - requestedQty })
        .where(eq(products.product_id, productId));
    }

    const totalAmount = createdItems.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.price)), 0);
    return {
      ...newOrder,
      items: createdItems,
      total_amount: totalAmount,
    };
  });

  res.status(201).json(result);
}));

router.patch('/:id/delivery-status', requireRole('Admin', 'User'), validate(idParamSchema, 'params'), validate(updateDeliveryStatusSchema), asyncHandler(async (req, res) => {
  const { delivery_status } = req.body;

  const updates = {
    delivery_status,
    delivered_at: null,
    delivered_by: null,
  };

  if (delivery_status === DELIVERY_STATUSES.delivered) {
    updates.delivered_at = new Date();
    updates.delivered_by = req.localUser.user_id;
  }

  const [updatedOrder] = await db
    .update(orders)
    .set(updates)
    .where(eq(orders.order_id, req.params.id))
    .returning({
      order_id: orders.order_id,
      customer_id: orders.customer_id,
      order_date: orders.order_date,
      delivery_date: orders.delivery_date,
      delivery_status: orders.delivery_status,
      delivered_at: orders.delivered_at,
      delivered_by: orders.delivered_by,
    });

  if (!updatedOrder) {
    throw new AppError(404, 'Order not found.');
  }

  res.json(updatedOrder);
}));

router.delete('/:id', requireAdmin, validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  const orderId = req.params.id;

  await db.transaction(async (tx) => {
    const existingOrder = await tx.select({ order_id: orders.order_id }).from(orders).where(eq(orders.order_id, orderId)).limit(1);
    if (!existingOrder.length) {
      throw new AppError(404, 'Order not found.');
    }

    const items = await tx.select().from(orderItems).where(eq(orderItems.order_id, orderId));
    const restoreByProduct = items.reduce((acc, item) => {
      acc.set(item.product_id, (acc.get(item.product_id) || 0) + Number(item.quantity));
      return acc;
    }, new Map());

    const productIds = [...restoreByProduct.keys()];
    const productRows = productIds.length
      ? await tx.select({ product_id: products.product_id, quantity: products.quantity }).from(products).where(inArray(products.product_id, productIds))
      : [];
    const productById = new Map(productRows.map((row) => [row.product_id, row]));

    for (const [productId, restoreQty] of restoreByProduct.entries()) {
      const product = productById.get(productId);
      if (!product) {
        continue;
      }

      await tx.update(products)
        .set({ quantity: Number(product.quantity) + restoreQty })
        .where(eq(products.product_id, productId));
    }

    await tx.delete(orderItems).where(eq(orderItems.order_id, orderId));
    await tx.delete(orders).where(eq(orders.order_id, orderId));
  });

  res.json({ success: true });
}));

export default router;
