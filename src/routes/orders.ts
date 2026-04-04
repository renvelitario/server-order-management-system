import express from 'express';
import { db } from '../db/db.js';
import { customers, orders, orderItems, products } from '../db/schema.js';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, requireRole } from '../middleware/rbac.js';
import { asyncHandler, AppError } from '../utils/errors.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import { deliveryAssignmentSchema, orderPayloadSchema, updateDeliveryStatusSchema } from '../validators/entity.js';
import { buildPaginatedResponse, logPaginationDebug, parseListQuery } from '../utils/pagination.js';

const router = express.Router();
router.use(requireAuth);

const isDevelopment = process.env.NODE_ENV !== 'production';

const DELIVERY_STATUSES = {
  unassigned: 'unassigned',
  pending: 'pending',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  failed: 'failed',
  cancelled: 'cancelled',
};

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type OrderPayload = {
  customer_id: number;
  order_date?: string;
  delivery_date?: string;
  items_data: Array<{ product_id: number; quantity: number; price: number }>;
};

const parseOrderDate = (value) => {
  if (value == null || String(value).trim() === '') {
    throw new AppError(400, 'Order date is required. Use YYYY-MM-DD.');
  }

  const raw = String(value).trim();
  const [year, month, day] = raw.split('-').map(Number);
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);

  if (
    !Number.isFinite(year)
    || !Number.isFinite(month)
    || !Number.isFinite(day)
    || parsed.getFullYear() !== year
    || (parsed.getMonth() + 1) !== month
    || parsed.getDate() !== day
  ) {
    throw new AppError(400, 'Invalid order date. Use YYYY-MM-DD.');
  }

  return parsed;
};

const parseDeliveryDate = (value) => {
  if (value == null || String(value).trim() === '') {
    return null;
  }

  const raw = String(value).trim();
  const [year, month, day] = raw.split('-').map(Number);
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);

  if (
    !Number.isFinite(year)
    || !Number.isFinite(month)
    || !Number.isFinite(day)
    || parsed.getFullYear() !== year
    || (parsed.getMonth() + 1) !== month
    || parsed.getDate() !== day
  ) {
    throw new AppError(400, 'Invalid delivery date. Use YYYY-MM-DD.');
  }

  return parsed;
};

const isAdminRequest = (req) => String(req.localUser?.acc_type || '').toLowerCase() === 'admin';

const assertValidDeliveryStatus = (value) => {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim();
  if (!Object.values(DELIVERY_STATUSES).includes(normalized)) {
    throw new AppError(400, 'Invalid delivery status filter.');
  }

  return normalized;
};

const deliveryTransitionMap = {
  [DELIVERY_STATUSES.unassigned]: new Set([DELIVERY_STATUSES.pending, DELIVERY_STATUSES.cancelled]),
  [DELIVERY_STATUSES.pending]: new Set([DELIVERY_STATUSES.out_for_delivery, DELIVERY_STATUSES.cancelled]),
  [DELIVERY_STATUSES.out_for_delivery]: new Set([DELIVERY_STATUSES.delivered, DELIVERY_STATUSES.failed]),
  [DELIVERY_STATUSES.failed]: new Set([DELIVERY_STATUSES.pending, DELIVERY_STATUSES.cancelled]),
  [DELIVERY_STATUSES.delivered]: new Set([DELIVERY_STATUSES.out_for_delivery]),
  [DELIVERY_STATUSES.cancelled]: new Set(),
};

const canTransitionDeliveryStatus = (currentStatus, nextStatus) => {
  if (currentStatus === nextStatus) {
    return true;
  }

  return deliveryTransitionMap[currentStatus]?.has(nextStatus) || false;
};

const resolveTodayRange = (utcOffsetMinutes = null) => {
  if (!Number.isFinite(utcOffsetMinutes)) {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    return { start, end };
  }

  const offsetMs = utcOffsetMinutes * MS_PER_MINUTE;
  const nowUtcMs = Date.now();
  const localNowMs = nowUtcMs - offsetMs;
  const localDayStartMs = Math.floor(localNowMs / MS_PER_DAY) * MS_PER_DAY;

  const start = new Date(localDayStartMs + offsetMs);
  const end = new Date(localDayStartMs + MS_PER_DAY + offsetMs);

  return { start, end };
};

const parseClientUtcOffsetMinutes = (req) => {
  const raw = req.get('x-client-utc-offset-minutes');
  if (raw == null || raw === '') {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
};

const parseDeliveryDateRangeFilter = (value) => {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized || normalized === 'all_time') {
    return 'all_time';
  }

  if (['weekly', 'monthly', 'yearly'].includes(normalized)) {
    return normalized;
  }

  throw new AppError(400, 'Invalid delivery date range filter.');
};

const resolveDeliveryDateRange = (range) => {
  if (!range || range === 'all_time') {
    return null;
  }

  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);

  if (range === 'weekly') {
    const day = start.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diffToMonday);
    start.setHours(0, 0, 0, 0);

    end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }

  if (range === 'monthly') {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    return { start, end };
  }

  start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  end = new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
  return { start, end };
};

const isTodayDeliveryDate = (value, utcOffsetMinutes = null) => {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const { start, end } = resolveTodayRange(utcOffsetMinutes);
  return date >= start && date < end;
};

router.get('/', requireRole('Admin', 'User'), asyncHandler(async (req, res) => {
  const { page, limit, offset, sort, search } = parseListQuery(req.query);
  const sortDirection = sort === 'asc' ? asc(orders.order_id) : desc(orders.order_id);
  const whereClause = search
    ? sql`(
      ${orders.order_id}::text ILIKE ${`%${search}%`}
      OR ${orders.customer_id}::text ILIKE ${`%${search}%`}
      OR ${customers.name} ILIKE ${`%${search}%`}
      OR ${orders.order_date}::text ILIKE ${`%${search}%`}
      OR ${orders.delivery_date}::text ILIKE ${`%${search}%`}
      OR ${orders.delivery_status} ILIKE ${`%${search}%`}
      OR (
        SELECT COUNT(*)::text
        FROM ${orderItems}
        WHERE ${orderItems.order_id} = ${orders.order_id}
      ) ILIKE ${`%${search}%`}
      OR (
        SELECT COALESCE(SUM(${orderItems.quantity} * ${orderItems.price}), 0)::text
        FROM ${orderItems}
        WHERE ${orderItems.order_id} = ${orders.order_id}
      ) ILIKE ${`%${search}%`}
    )`
    : undefined;

  logPaginationDebug({
    route: 'orders.list',
    query: req.query,
    parsed: { page, limit, offset, sort, search },
    enabled: isDevelopment,
  });

  const [ordersPage, totalRows] = await Promise.all([
    db
      .select({
        order_id: orders.order_id,
        customer_id: orders.customer_id,
        customer_name: customers.name,
        order_date: orders.order_date,
        delivery_date: orders.delivery_date,
        delivery_status: orders.delivery_status,
        delivery_user_id: orders.delivery_user_id,
        delivered_at: orders.delivered_at,
        delivered_by: orders.delivered_by,
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
      ? await db
          .select({
            order_id: orderItems.order_id,
            product_id: orderItems.product_id,
            sku: products.sku,
            quantity: orderItems.quantity,
            price: orderItems.price,
            product_name: products.product_name,
          })
          .from(orderItems)
          .leftJoin(products, eq(orderItems.product_id, products.product_id))
          .where(inArray(orderItems.order_id, orderIds))
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

router.get('/delivery/admin', requireAdmin, asyncHandler(async (req, res) => {
  const { page, limit, offset, sort, search } = parseListQuery(req.query);
  const requestedStatus = assertValidDeliveryStatus(req.query.delivery_status);
  const dateRangeFilter = parseDeliveryDateRangeFilter(req.query.date_range);
  const sortDirection = sort === 'asc' ? asc(orders.order_id) : desc(orders.order_id);
  const filters = [];

  if (requestedStatus) {
    filters.push(eq(orders.delivery_status, requestedStatus));
  }

  const resolvedDateRange = resolveDeliveryDateRange(dateRangeFilter);
  if (resolvedDateRange) {
    filters.push(gte(orders.delivery_date, resolvedDateRange.start));
    filters.push(lt(orders.delivery_date, resolvedDateRange.end));
  }

  if (search) {
    filters.push(sql`(
      ${orders.order_id}::text ILIKE ${`%${search}%`}
      OR ${customers.name} ILIKE ${`%${search}%`}
      OR ${customers.address} ILIKE ${`%${search}%`}
      OR ${customers.contact_no} ILIKE ${`%${search}%`}
      OR ${orders.order_date}::text ILIKE ${`%${search}%`}
      OR ${orders.delivery_date}::text ILIKE ${`%${search}%`}
      OR ${orders.delivery_status} ILIKE ${`%${search}%`}
      OR (
        SELECT COUNT(*)::text
        FROM ${orderItems}
        WHERE ${orderItems.order_id} = ${orders.order_id}
      ) ILIKE ${`%${search}%`}
      OR (
        SELECT COALESCE(SUM(${orderItems.quantity} * ${orderItems.price}), 0)::text
        FROM ${orderItems}
        WHERE ${orderItems.order_id} = ${orders.order_id}
      ) ILIKE ${`%${search}%`}
    )`);
  }

  const whereClause = filters.length ? and(...filters) : undefined;

  const [ordersPage, totalRows] = await Promise.all([
    db
      .select({
        order_id: orders.order_id,
        customer_id: orders.customer_id,
        order_date: orders.order_date,
        delivery_date: orders.delivery_date,
        delivery_status: orders.delivery_status,
        delivery_user_id: orders.delivery_user_id,
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

router.get('/delivery/today', requireRole('Admin', 'User'), asyncHandler(async (req, res) => {
  const utcOffsetMinutes = parseClientUtcOffsetMinutes(req);
  const { page, limit, offset, sort, search } = parseListQuery(req.query);
  const sortDirection = sort === 'asc' ? asc(orders.order_id) : desc(orders.order_id);
  const { start, end } = resolveTodayRange(utcOffsetMinutes);
  const filters = [
    gte(orders.delivery_date, start),
    lt(orders.delivery_date, end),
    inArray(orders.delivery_status, [
      DELIVERY_STATUSES.pending,
      DELIVERY_STATUSES.out_for_delivery,
      DELIVERY_STATUSES.delivered,
      DELIVERY_STATUSES.failed,
    ]),
  ];

  if (search) {
    filters.push(sql`(
      ${orders.order_id}::text ILIKE ${`%${search}%`}
      OR ${customers.name} ILIKE ${`%${search}%`}
      OR ${customers.address} ILIKE ${`%${search}%`}
      OR ${customers.contact_no} ILIKE ${`%${search}%`}
      OR ${orders.order_date}::text ILIKE ${`%${search}%`}
      OR ${orders.delivery_date}::text ILIKE ${`%${search}%`}
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
        delivery_user_id: orders.delivery_user_id,
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
  const orderId = Number(req.params.id);
  const order = await db
    .select({
      order_id: orders.order_id,
      customer_id: orders.customer_id,
      order_date: orders.order_date,
      delivery_date: orders.delivery_date,
      delivery_status: orders.delivery_status,
      delivery_user_id: orders.delivery_user_id,
      delivered_at: orders.delivered_at,
      delivered_by: orders.delivered_by,
      customer_name: customers.name,
      address: customers.address,
      contact_no: customers.contact_no,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customer_id, customers.customer_id))
    .where(eq(orders.order_id, orderId))
    .limit(1);

  if (!order.length) {
    throw new AppError(404, 'Order not found.');
  }

  const items = await db
    .select({
      product_id: orderItems.product_id,
      sku: products.sku,
      quantity: orderItems.quantity,
      price: orderItems.price,
      product_name: products.product_name,
    })
    .from(orderItems)
    .leftJoin(products, eq(orderItems.product_id, products.product_id))
    .where(eq(orderItems.order_id, order[0].order_id));
  const totalAmount = items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.price)), 0);

  res.json({
    ...order[0],
    items,
    total_amount: totalAmount,
  });
}));

router.post('/', requireAdmin, validate(orderPayloadSchema), asyncHandler(async (req, res) => {
  const { customer_id, order_date, items_data, delivery_date } = req.body as OrderPayload;
  const uniqueProductIds: number[] = [...new Set(items_data.map((item) => item.product_id))];

  const result = await db.transaction(async (tx) => {
    const customerRows = await tx
      .select({ customer_id: customers.customer_id })
      .from(customers)
      .where(eq(customers.customer_id, customer_id))
      .limit(1);

    if (!customerRows.length) {
      throw new AppError(404, `Customer ${customer_id} not found.`);
    }

    const productRows = await tx
      .select({
        product_id: products.product_id,
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
    }

    const parsedDeliveryDate = parseDeliveryDate(delivery_date);
    const initialDeliveryStatus = parsedDeliveryDate
      ? DELIVERY_STATUSES.pending
      : DELIVERY_STATUSES.unassigned;

    const [newOrder] = await tx.insert(orders).values({
      customer_id,
      order_date: parseOrderDate(order_date),
      delivery_date: parsedDeliveryDate,
      delivery_status: initialDeliveryStatus,
      delivery_user_id: null,
    }).returning();

    const createdItems = [];

    for (const item of items_data) {
      const [createdItem] = await tx.insert(orderItems).values({
        order_id: newOrder.order_id,
        product_id: item.product_id,
        quantity: item.quantity,
        price: item.price,
      }).returning();

      createdItems.push(createdItem);
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

router.put('/:id', requireAdmin, validate(idParamSchema, 'params'), validate(orderPayloadSchema), asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  const { customer_id, order_date, items_data, delivery_date } = req.body as OrderPayload;
  const uniqueProductIds: number[] = [...new Set(items_data.map((item) => item.product_id))];

  const result = await db.transaction(async (tx) => {
    const existingOrderRows = await tx
      .select({
        order_id: orders.order_id,
        order_date: orders.order_date,
        delivery_date: orders.delivery_date,
        delivery_status: orders.delivery_status,
        delivery_user_id: orders.delivery_user_id,
        delivered_at: orders.delivered_at,
        delivered_by: orders.delivered_by,
      })
      .from(orders)
      .where(eq(orders.order_id, orderId))
      .limit(1);

    if (!existingOrderRows.length) {
      throw new AppError(404, 'Order not found.');
    }

    const customerRows = await tx
      .select({ customer_id: customers.customer_id })
      .from(customers)
      .where(eq(customers.customer_id, customer_id))
      .limit(1);

    if (!customerRows.length) {
      throw new AppError(404, `Customer ${customer_id} not found.`);
    }

    const productRows = uniqueProductIds.length
      ? await tx
          .select({
            product_id: products.product_id,
            status: products.status,
          })
          .from(products)
          .where(inArray(products.product_id, uniqueProductIds))
      : [];

    const productById = new Map(productRows.map((row) => [row.product_id, row]));

    for (const productId of uniqueProductIds) {
      const product = productById.get(productId);
      if (!product) {
        throw new AppError(404, `Product ${productId} not found.`);
      }

      if (String(product.status).toLowerCase() !== 'active') {
        throw new AppError(400, `Product ${productId} is not active.`);
      }
    }

    const parsedDeliveryDate = delivery_date === undefined ? undefined : parseDeliveryDate(delivery_date);
    const updatePayload: {
      customer_id: number;
      order_date?: Date;
      delivery_date?: Date | null;
      delivery_status?: string;
      delivery_user_id?: number | null;
      delivered_at?: Date | null;
      delivered_by?: number | null;
    } = {
      customer_id,
    };

    if (order_date !== undefined) {
      updatePayload.order_date = parseOrderDate(order_date);
    }

    if (delivery_date !== undefined) {
      updatePayload.delivery_date = parsedDeliveryDate;

      if (!parsedDeliveryDate) {
        updatePayload.delivery_status = DELIVERY_STATUSES.unassigned;
        updatePayload.delivery_user_id = null;
        updatePayload.delivered_at = null;
        updatePayload.delivered_by = null;
      } else if (existingOrderRows[0].delivery_status === DELIVERY_STATUSES.unassigned) {
        updatePayload.delivery_status = DELIVERY_STATUSES.pending;
      }
    }

    const [updatedOrder] = await tx
      .update(orders)
      .set(updatePayload)
      .where(eq(orders.order_id, orderId))
      .returning({
        order_id: orders.order_id,
        customer_id: orders.customer_id,
        order_date: orders.order_date,
        delivery_date: orders.delivery_date,
        delivery_status: orders.delivery_status,
        delivery_user_id: orders.delivery_user_id,
        delivered_at: orders.delivered_at,
        delivered_by: orders.delivered_by,
      });

    await tx.delete(orderItems).where(eq(orderItems.order_id, orderId));

    const updatedItems = [];
    for (const item of items_data) {
      const [createdItem] = await tx
        .insert(orderItems)
        .values({
          order_id: orderId,
          product_id: item.product_id,
          quantity: item.quantity,
          price: item.price,
        })
        .returning();

      updatedItems.push(createdItem);
    }

    const totalAmount = updatedItems.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.price)), 0);

    return {
      ...updatedOrder,
      items: updatedItems,
      total_amount: totalAmount,
    };
  });

  res.json(result);
}));

router.patch('/:id/delivery-status', requireRole('Admin', 'User'), validate(idParamSchema, 'params'), validate(updateDeliveryStatusSchema), asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  const { delivery_status } = req.body;
  const existingOrderRows = await db
    .select({
      order_id: orders.order_id,
      delivery_status: orders.delivery_status,
      delivery_user_id: orders.delivery_user_id,
    })
    .from(orders)
    .where(eq(orders.order_id, orderId))
    .limit(1);

  const existingOrder = existingOrderRows[0];
  if (!existingOrder) {
    throw new AppError(404, 'Order not found.');
  }

  const adminRequest = isAdminRequest(req);
  if (!adminRequest) {
    if (![DELIVERY_STATUSES.pending, DELIVERY_STATUSES.out_for_delivery, DELIVERY_STATUSES.delivered, DELIVERY_STATUSES.failed].includes(delivery_status)) {
      throw new AppError(403, 'Delivery users cannot set that status.');
    }
  }

  if (!canTransitionDeliveryStatus(existingOrder.delivery_status, delivery_status)) {
    throw new AppError(400, `Cannot change delivery status from ${existingOrder.delivery_status} to ${delivery_status}.`);
  }

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
    .where(eq(orders.order_id, orderId))
    .returning({
      order_id: orders.order_id,
      customer_id: orders.customer_id,
      order_date: orders.order_date,
      delivery_date: orders.delivery_date,
      delivery_status: orders.delivery_status,
      delivery_user_id: orders.delivery_user_id,
      delivered_at: orders.delivered_at,
      delivered_by: orders.delivered_by,
    });

  if (!updatedOrder) {
    throw new AppError(404, 'Order not found.');
  }

  res.json(updatedOrder);
}));

router.patch('/:id/delivery-assignment', requireAdmin, validate(idParamSchema, 'params'), validate(deliveryAssignmentSchema), asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  const { delivery_date } = req.body;
  const parsedDeliveryDate = parseDeliveryDate(delivery_date);

  if (!parsedDeliveryDate) {
    throw new AppError(400, 'Delivery date is required.');
  }

  const updatedOrder = await db.transaction(async (tx) => {
    const existingOrderRows = await tx
      .select({
        order_id: orders.order_id,
        delivery_status: orders.delivery_status,
      })
      .from(orders)
      .where(eq(orders.order_id, orderId))
      .limit(1);

    const existingOrder = existingOrderRows[0];
    if (!existingOrder) {
      throw new AppError(404, 'Order not found.');
    }

    if ([DELIVERY_STATUSES.delivered, DELIVERY_STATUSES.cancelled].includes(existingOrder.delivery_status)) {
      throw new AppError(400, 'Delivered or cancelled orders cannot be reassigned.');
    }

    const [order] = await tx
      .update(orders)
      .set({
        delivery_date: parsedDeliveryDate,
        delivery_user_id: null,
        delivery_status: DELIVERY_STATUSES.pending,
        delivered_at: null,
        delivered_by: null,
      })
      .where(eq(orders.order_id, orderId))
      .returning({
        order_id: orders.order_id,
        customer_id: orders.customer_id,
        order_date: orders.order_date,
        delivery_date: orders.delivery_date,
        delivery_status: orders.delivery_status,
        delivery_user_id: orders.delivery_user_id,
        delivered_at: orders.delivered_at,
        delivered_by: orders.delivered_by,
      });

    return order;
  });

  res.json(updatedOrder);
}));

router.delete('/:id', requireAdmin, validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);

  await db.transaction(async (tx) => {
    const existingOrder = await tx.select({ order_id: orders.order_id }).from(orders).where(eq(orders.order_id, orderId)).limit(1);
    if (!existingOrder.length) {
      throw new AppError(404, 'Order not found.');
    }

    await tx.delete(orderItems).where(eq(orderItems.order_id, orderId));
    await tx.delete(orders).where(eq(orders.order_id, orderId));
  });

  res.json({ success: true });
}));

export default router;
