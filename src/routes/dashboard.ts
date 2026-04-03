import express from 'express';
import { and, desc, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db/db.js';
import { customers, orderItems, orders, products } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';

const router = express.Router();
router.use(requireAuth);

const isDevelopment = process.env.NODE_ENV !== 'production';

const debugLog = (message, payload) => {
  if (isDevelopment) {
    console.info(message, payload);
  }
};

const toSafeDate = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
};

const resolveRange = (query) => {
  const from = toSafeDate(query.from);
  const to = toSafeDate(query.to);

  if (!from && !to) {
    return null;
  }

  if (from && to && from > to) {
    return null;
  }

  return {
    from,
    to,
  };
};

router.get('/summary', asyncHandler(async (req, res) => {
  const range = resolveRange(req.query);
  const orderFilters = [];

  debugLog('[DEBUG_DASHBOARD]', {
    route: 'dashboard.summary',
    query: req.query,
    parsedRange: range,
  });

  if (range?.from) {
    orderFilters.push(gte(orders.order_date, range.from));
  }

  if (range?.to) {
    orderFilters.push(lte(orders.order_date, range.to));
  }

  const [productCountRow, customerCountRow, filteredOrders] = await Promise.all([
    db
      .select({
        count: sql`count(*)::int`,
      })
      .from(products),
    db.select({ count: sql`count(*)::int` }).from(customers),
    db.select({ order_id: orders.order_id, order_date: orders.order_date }).from(orders).where(orderFilters.length ? and(...orderFilters) : undefined),
  ]);

  const filteredOrderIds = new Set(filteredOrders.map((order) => order.order_id));
  const relevantItems = filteredOrderIds.size
    ? await db
      .select({ order_id: orderItems.order_id, sku: orderItems.sku, quantity: orderItems.quantity, price: orderItems.price })
      .from(orderItems)
      .where(inArray(orderItems.order_id, [...filteredOrderIds]))
    : [];

  const totalSales = relevantItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.price), 0);
  const revenueByMonth = new Map();

  filteredOrders.forEach((order) => {
    const date = new Date(order.order_date);
    if (Number.isNaN(date.getTime())) {
      return;
    }

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    revenueByMonth.set(key, 0);
  });

  const orderDateById = new Map(filteredOrders.map((order) => [order.order_id, order.order_date]));

  relevantItems.forEach((item) => {
    const orderDate = orderDateById.get(item.order_id);
    if (!orderDate) {
      return;
    }

    const date = new Date(orderDate);
    if (Number.isNaN(date.getTime())) {
      return;
    }

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    revenueByMonth.set(key, (revenueByMonth.get(key) || 0) + Number(item.quantity) * Number(item.price));
  });

  const productSales = new Map();
  relevantItems.forEach((item) => {
    productSales.set(item.sku, (productSales.get(item.sku) || 0) + Number(item.quantity));
  });

  const topProductEntries = [...productSales.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topSkus = topProductEntries.map(([sku]) => sku);
  const topProductRows = topSkus.length
    ? await db
      .select({ sku: products.sku, product_name: products.product_name })
      .from(products)
      .where(inArray(products.sku, topSkus))
    : [];

  const productNameBySku = new Map(topProductRows.map((entry) => [entry.sku, entry.product_name]));

  const topProducts = topProductEntries.map(([sku, soldQuantity]) => ({
    sku,
    product_name: productNameBySku.get(sku) || sku,
    sold_quantity: soldQuantity,
  }));

  const monthlyRevenue = [...revenueByMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, revenue]) => ({ month, revenue }));

  res.json({
    summary: {
      totalSales,
      totalOrders: filteredOrders.length,
      totalProducts: Number(productCountRow[0]?.count || 0),
      totalCustomers: Number(customerCountRow[0]?.count || 0),
    },
    monthlyRevenue,
    topProducts,
  });
}));

router.get('/recent-orders', asyncHandler(async (req, res) => {
  const range = resolveRange(req.query);
  const orderFilters = [];

  debugLog('[DEBUG_DASHBOARD]', {
    route: 'dashboard.recent-orders',
    query: req.query,
    parsedRange: range,
  });

  if (range?.from) {
    orderFilters.push(gte(orders.order_date, range.from));
  }

  if (range?.to) {
    orderFilters.push(lte(orders.order_date, range.to));
  }

  let latestOrders = await db
    .select({
      order_id: orders.order_id,
      customer_id: orders.customer_id,
      order_date: orders.order_date,
    })
    .from(orders)
    .where(orderFilters.length ? and(...orderFilters) : undefined)
    .orderBy(desc(orders.order_date))
    .limit(10);

  // Fallback to full dataset if a provided date range produces no rows.
  if (!latestOrders.length && orderFilters.length) {
    debugLog('[DEBUG_DASHBOARD]', {
      route: 'dashboard.recent-orders',
      fallback: 'all-time',
    });

    latestOrders = await db
      .select({
        order_id: orders.order_id,
        customer_id: orders.customer_id,
        order_date: orders.order_date,
      })
      .from(orders)
      .orderBy(desc(orders.order_date))
      .limit(10);
  }

  const orderIds = latestOrders.map((entry) => entry.order_id);
  const customerIds = [...new Set(latestOrders.map((entry) => entry.customer_id))];
  const [items, customersList] = await Promise.all([
    orderIds.length
      ? db.select({ order_id: orderItems.order_id, sku: orderItems.sku, quantity: orderItems.quantity, price: orderItems.price }).from(orderItems).where(inArray(orderItems.order_id, orderIds))
      : Promise.resolve([]),
    customerIds.length
      ? db.select({ customer_id: customers.customer_id, name: customers.name }).from(customers).where(inArray(customers.customer_id, customerIds))
      : Promise.resolve([]),
  ]);

  const skus = [...new Set(items.map((item) => item.sku))];
  const productsList = skus.length
    ? await db.select({ sku: products.sku, product_name: products.product_name }).from(products).where(inArray(products.sku, skus))
    : [];

  const productBySku = new Map(productsList.map((entry) => [entry.sku, entry.product_name]));
  const customerById = new Map(customersList.map((entry) => [entry.customer_id, entry.name]));

  const itemsByOrder = items.reduce((acc, item) => {
    const list = acc.get(item.order_id) || [];
    list.push(item);
    acc.set(item.order_id, list);
    return acc;
  }, new Map());

  const response = latestOrders.map((order) => {
    const orderItemsList = itemsByOrder.get(order.order_id) || [];
    const totalAmount = orderItemsList.reduce((sum, item) => sum + Number(item.quantity) * Number(item.price), 0);

    return {
      ...order,
      items: orderItemsList.map((item) => ({
        ...item,
        product_name: productBySku.get(item.sku) || item.sku,
      })),
      customer_name: customerById.get(order.customer_id) || `Customer #${order.customer_id}`,
      total_amount: totalAmount,
    };
  });

  res.json({ data: response });
}));

export default router;
