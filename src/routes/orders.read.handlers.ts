import type { Request, Response } from 'express';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../db/db.js';
import { customers, notifications, orders, orderItems, products } from '../db/schema.js';
import { createNotificationsForRole } from '../utils/notifications.js';
import { buildPaginatedResponse, logPaginationDebug, parseListQuery } from '../utils/pagination.js';
import { AppError } from '../utils/errors.js';
import {
  DELIVERY_STATUSES,
  assertValidDeliveryStatus,
  canDeliveryUserAccessOrderToday,
  isAdminRequest,
  parseClientUtcOffsetMinutes,
  parseDeliveryDateRangeFilter,
  resolveDeliveryDateRange,
  resolveTodayRange,
} from './orders.helpers.js';

const isDevelopment = process.env.NODE_ENV !== 'production';

const DELIVERY_PENDING_START_TODAY_EVENT = 'delivery_pending_start_today';
const DELIVERY_AUTO_FAILED_EVENT = 'delivery_auto_failed_overdue';

const applyDeliveryAutomation = async (utcOffsetMinutes: number | null) => {
  const { start, end } = resolveTodayRange(utcOffsetMinutes);

  const overdueRows = await db
    .update(orders)
    .set({
      delivery_status: DELIVERY_STATUSES.failed,
      delivered_at: null,
      delivered_by: null,
    })
    .where(and(
      lt(orders.delivery_date, start),
      inArray(orders.delivery_status, [DELIVERY_STATUSES.pending, DELIVERY_STATUSES.out_for_delivery]),
    ))
    .returning({
      order_id: orders.order_id,
    });

  if (overdueRows.length) {
    await Promise.all(overdueRows.map((row) => createNotificationsForRole({
      role: 'Admin',
      payload: {
        eventType: DELIVERY_AUTO_FAILED_EVENT,
        title: 'Overdue delivery auto-failed',
        message: `Order #${row.order_id} was automatically moved to failed because its delivery date has passed.`,
        orderId: row.order_id,
      },
    })));
  }

  const pendingTodayRows = await db
    .select({
      order_id: orders.order_id,
    })
    .from(orders)
    .where(and(
      eq(orders.delivery_status, DELIVERY_STATUSES.pending),
      gte(orders.delivery_date, start),
      lt(orders.delivery_date, end),
    ));

  if (!pendingTodayRows.length) {
    return;
  }

  const pendingTodayOrderIds = pendingTodayRows.map((row) => row.order_id);
  const alreadyNotifiedRows = await db
    .select({
      order_id: notifications.order_id,
    })
    .from(notifications)
    .where(and(
      eq(notifications.event_type, DELIVERY_PENDING_START_TODAY_EVENT),
      inArray(notifications.order_id, pendingTodayOrderIds),
      gte(notifications.created_at, start),
      lt(notifications.created_at, end),
    ));

  const alreadyNotifiedSet = new Set(alreadyNotifiedRows.map((row) => Number(row.order_id)));
  const orderIdsToNotify = pendingTodayOrderIds.filter((orderId) => !alreadyNotifiedSet.has(orderId));

  if (!orderIdsToNotify.length) {
    return;
  }

  await Promise.all(orderIdsToNotify.map((orderId) => createNotificationsForRole({
    role: 'Admin',
    payload: {
      eventType: DELIVERY_PENDING_START_TODAY_EVENT,
      title: 'Delivery pending to start today',
      message: `Order #${orderId} is still pending and scheduled for today. Please start delivery.`,
      orderId,
    },
  })));
};

export const listOrdersHandler = async (req: Request, res: Response) => {
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
};

export const listAdminDeliveryOrdersHandler = async (req: Request, res: Response) => {
  await applyDeliveryAutomation(null);

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
};

export const listTodayDeliveryOrdersHandler = async (req: Request, res: Response) => {
  const utcOffsetMinutes = parseClientUtcOffsetMinutes(req);
  await applyDeliveryAutomation(utcOffsetMinutes);

  const { page, limit, offset, sort, search } = parseListQuery(req.query);
  const sortDirection = sort === 'asc' ? asc(orders.order_id) : desc(orders.order_id);
  const { start, end } = resolveTodayRange(utcOffsetMinutes);
  const filters = [
    gte(orders.delivery_date, start),
    lt(orders.delivery_date, end),
  ];

  if (isAdminRequest(req)) {
    filters.push(inArray(orders.delivery_status, [
      DELIVERY_STATUSES.pending,
      DELIVERY_STATUSES.out_for_delivery,
      DELIVERY_STATUSES.delivered,
      DELIVERY_STATUSES.failed,
    ]));
  } else {
    filters.push(eq(orders.delivery_status, DELIVERY_STATUSES.out_for_delivery));
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
};

export const getOrderByIdHandler = async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  const utcOffsetMinutes = parseClientUtcOffsetMinutes(req);
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

  if (!isAdminRequest(req) && !canDeliveryUserAccessOrderToday(order[0], utcOffsetMinutes)) {
    throw new AppError(403, 'Delivery users can only access orders that are out for delivery today.');
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
};