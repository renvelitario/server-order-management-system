import express from 'express';
import { and, desc, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db/db.js';
import { customers, orderItems, orders, products } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';

const router = express.Router();
router.use(requireAuth);

const DELIVERY_BACKLOG_STATUSES = new Set(['unassigned', 'pending', 'out_for_delivery']);

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
    db
      .select({
        order_id: orders.order_id,
        customer_id: orders.customer_id,
        order_date: orders.order_date,
        delivery_status: orders.delivery_status,
        discount: orders.discount,
        delivery_fee: orders.delivery_fee,
      })
      .from(orders)
      .where(orderFilters.length ? and(...orderFilters) : undefined),
  ]);

  const filteredOrderIds = new Set(filteredOrders.map((order) => order.order_id));
  const deliveredOrderIds = new Set(
    filteredOrders
      .filter((order) => String(order.delivery_status || '') === 'delivered')
      .map((order) => order.order_id),
  );
  const relevantItems = filteredOrderIds.size
    ? await db
      .select({ order_id: orderItems.order_id, product_id: orderItems.product_id, quantity: orderItems.quantity, price: orderItems.price })
      .from(orderItems)
      .where(inArray(orderItems.order_id, [...filteredOrderIds]))
    : [];

  const deliveredOrders = filteredOrders.filter((order) => String(order.delivery_status || '') === 'delivered');
  const deliveredItems = relevantItems.filter((item) => deliveredOrderIds.has(item.order_id));

  const grossSales = deliveredItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.price), 0);
  const totalDiscounts = deliveredOrders.reduce((sum, order) => sum + Number(order.discount || 0), 0);
  const totalDeliveryFees = deliveredOrders.reduce((sum, order) => sum + Number(order.delivery_fee || 0), 0);
  const totalSales = Math.max(0, grossSales - totalDiscounts + totalDeliveryFees);

  const monthlyTrendByMonth = new Map();

  filteredOrders.forEach((order) => {
    const date = new Date(order.order_date);
    if (Number.isNaN(date.getTime())) {
      return;
    }

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const current = monthlyTrendByMonth.get(key) || { revenue: 0, orders: 0 };
    monthlyTrendByMonth.set(key, {
      revenue: current.revenue,
      orders: current.orders + 1,
    });
  });

  const orderDateById = new Map(filteredOrders.map((order) => [order.order_id, order.order_date]));

  deliveredItems.forEach((item) => {
    const orderDate = orderDateById.get(item.order_id);
    if (!orderDate) {
      return;
    }

    const date = new Date(orderDate);
    if (Number.isNaN(date.getTime())) {
      return;
    }

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const current = monthlyTrendByMonth.get(key) || { revenue: 0, orders: 0 };
    monthlyTrendByMonth.set(key, {
      revenue: current.revenue + Number(item.quantity) * Number(item.price),
      orders: current.orders,
    });
  });

  const productSales = new Map();
  const productRevenue = new Map();
  deliveredItems.forEach((item) => {
    productSales.set(item.product_id, (productSales.get(item.product_id) || 0) + Number(item.quantity));
    productRevenue.set(item.product_id, (productRevenue.get(item.product_id) || 0) + Number(item.quantity) * Number(item.price));
  });

  const topProductEntries = [...productSales.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topProductIds = topProductEntries.map(([productId]) => productId);
  const topProductRows = topProductIds.length
    ? await db
      .select({ product_id: products.product_id, sku: products.sku, product_name: products.product_name })
      .from(products)
      .where(inArray(products.product_id, topProductIds))
    : [];

  const productById = new Map(topProductRows.map((entry) => [entry.product_id, { sku: entry.sku, product_name: entry.product_name }]));

  const topProducts = topProductEntries.map(([productId, soldQuantity]) => ({
    sku: productById.get(productId)?.sku || String(productId),
    product_name: productById.get(productId)?.product_name || `Product #${productId}`,
    sold_quantity: soldQuantity,
    revenue: Number(productRevenue.get(productId) || 0),
  }));

  const monthlyTrends = [...monthlyTrendByMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, stats]) => ({
      month,
      revenue: Number(stats.revenue || 0),
      orders: Number(stats.orders || 0),
    }));

  const monthlyRevenue = monthlyTrends.map(({ month, revenue }) => ({ month, revenue }));

  const activeCustomerCount = new Set(filteredOrders.map((order) => order.customer_id)).size;
  const unassignedDeliveries = filteredOrders.filter((order) => String(order.delivery_status || '') === 'unassigned').length;
  const scheduledDeliveries = filteredOrders.filter((order) => String(order.delivery_status || '') === 'pending').length;
  const outForDelivery = filteredOrders.filter((order) => String(order.delivery_status || '') === 'out_for_delivery').length;
  const pendingDeliveries = filteredOrders.filter((order) => DELIVERY_BACKLOG_STATUSES.has(String(order.delivery_status || ''))).length;
  const deliveredOrdersCount = deliveredOrders.length;
  const failedDeliveries = filteredOrders.filter((order) => String(order.delivery_status || '') === 'failed').length;
  const cancelledOrders = filteredOrders.filter((order) => String(order.delivery_status || '') === 'cancelled').length;
  const totalUnitsSold = deliveredItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const averageOrderValue = deliveredOrdersCount ? totalSales / deliveredOrdersCount : 0;

  res.json({
    summary: {
      totalSales,
      grossSales,
      totalDiscounts,
      totalDeliveryFees,
      totalOrders: filteredOrders.length,
      totalProducts: Number(productCountRow[0]?.count || 0),
      totalCustomers: Number(customerCountRow[0]?.count || 0),
      activeCustomers: activeCustomerCount,
      unassignedDeliveries,
      scheduledDeliveries,
      outForDelivery,
      pendingDeliveries,
      deliveredOrders: deliveredOrdersCount,
      failedDeliveries,
      cancelledOrders,
      totalUnitsSold,
      averageOrderValue,
    },
    monthlyRevenue,
    monthlyTrends,
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
      delivery_date: orders.delivery_date,
      delivery_status: orders.delivery_status,
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
        delivery_date: orders.delivery_date,
        delivery_status: orders.delivery_status,
      })
      .from(orders)
      .orderBy(desc(orders.order_date))
      .limit(10);
  }

  const orderIds = latestOrders.map((entry) => entry.order_id);
  const customerIds = [...new Set(latestOrders.map((entry) => entry.customer_id))];
  const [items, customersList] = await Promise.all([
    orderIds.length
      ? db.select({ order_id: orderItems.order_id, product_id: orderItems.product_id, quantity: orderItems.quantity, price: orderItems.price }).from(orderItems).where(inArray(orderItems.order_id, orderIds))
      : Promise.resolve([]),
    customerIds.length
      ? db.select({ customer_id: customers.customer_id, name: customers.name }).from(customers).where(inArray(customers.customer_id, customerIds))
      : Promise.resolve([]),
  ]);

  const productIds = [...new Set(items.map((item) => item.product_id))];
  const productsList = productIds.length
    ? await db.select({ product_id: products.product_id, sku: products.sku, product_name: products.product_name }).from(products).where(inArray(products.product_id, productIds))
    : [];

  const productById = new Map(productsList.map((entry) => [entry.product_id, { sku: entry.sku, product_name: entry.product_name }]));
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
        sku: productById.get(item.product_id)?.sku || String(item.product_id),
        product_name: productById.get(item.product_id)?.product_name || `Product #${item.product_id}`,
      })),
      customer_name: customerById.get(order.customer_id) || `Customer #${order.customer_id}`,
      total_amount: totalAmount,
    };
  });

  res.json({ data: response });
}));

export default router;
