import { eq, inArray } from 'drizzle-orm';
import { customers, orders, orderItems, products } from '../db/schema.js';
import { AppError } from '../utils/errors.js';
import { DELIVERY_STATUSES, parseDeliveryDate, parseOrderDate } from './orders.helpers.js';

export type OrderItemPayload = {
  product_id: number;
  quantity: number;
  price: number;
};

export type OrderPayload = {
  customer_id: number;
  order_date?: string;
  delivery_date?: string;
  items_data: OrderItemPayload[];
  discount?: number;
  delivery_fee?: number;
};

type OrderUpdatePayload = {
  customer_id: number;
  order_date?: Date;
  delivery_date?: Date | null;
  delivery_status?: string;
  delivery_user_id?: number | null;
  delivered_at?: Date | null;
  delivered_by?: number | null;
};

export const getUniqueProductIds = (items: OrderItemPayload[]): number[] => [...new Set(items.map((item) => item.product_id))];

export const ensureCustomerExists = async (
  tx: {
    select: Function;
  },
  customerId: number,
) => {
  const customerRows = await tx
    .select({ customer_id: customers.customer_id })
    .from(customers)
    .where(eq(customers.customer_id, customerId))
    .limit(1);

  if (!customerRows.length) {
    throw new AppError(404, `Customer ${customerId} not found.`);
  }
};

export const ensureProductsAreActive = async (
  tx: {
    select: Function;
  },
  uniqueProductIds: number[],
) => {
  const productRows = uniqueProductIds.length
    ? await tx
        .select({
          product_id: products.product_id,
          status: products.status,
        })
        .from(products)
        .where(inArray(products.product_id, uniqueProductIds))
    : [];

  const productById = new Map(productRows.map((row: { product_id: number }) => [row.product_id, row]));

  for (const productId of uniqueProductIds) {
    const product = productById.get(productId) as { status: string } | undefined;
    if (!product) {
      throw new AppError(404, `Product ${productId} not found.`);
    }

    if (String(product.status).toLowerCase() !== 'active') {
      throw new AppError(400, `Product ${productId} is not active.`);
    }
  }
};

export const insertOrderItems = async (
  tx: {
    insert: Function;
  },
  orderId: number,
  items: OrderItemPayload[],
) => {
  const createdItems = [];

  for (const item of items) {
    const [createdItem] = await tx.insert(orderItems).values({
      order_id: orderId,
      product_id: item.product_id,
      quantity: item.quantity,
      price: item.price,
    }).returning();

    createdItems.push(createdItem);
  }

  return createdItems;
};

export const calculateOrderTotal = (items: Array<{ quantity: number | string; price: number | string }>) =>
  items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.price)), 0);

export const resolveInitialDeliveryStatus = (deliveryDate: string | undefined) => {
  const parsedDeliveryDate = parseDeliveryDate(deliveryDate);
  const initialDeliveryStatus = parsedDeliveryDate
    ? DELIVERY_STATUSES.pending
    : DELIVERY_STATUSES.unassigned;

  return {
    parsedDeliveryDate,
    initialDeliveryStatus,
  };
};

export const buildOrderUpdatePayload = (args: {
  customerId: number;
  orderDate: string | undefined;
  deliveryDate: string | undefined;
  existingDeliveryStatus: string;
}) => {
  const { customerId, orderDate, deliveryDate, existingDeliveryStatus } = args;

  const parsedDeliveryDate = deliveryDate === undefined ? undefined : parseDeliveryDate(deliveryDate);
  const updatePayload: OrderUpdatePayload = {
    customer_id: customerId,
  };

  if (orderDate !== undefined) {
    updatePayload.order_date = parseOrderDate(orderDate);
  }

  if (deliveryDate !== undefined) {
    updatePayload.delivery_date = parsedDeliveryDate;

    if (!parsedDeliveryDate) {
      updatePayload.delivery_status = DELIVERY_STATUSES.unassigned;
      updatePayload.delivery_user_id = null;
      updatePayload.delivered_at = null;
      updatePayload.delivered_by = null;
    } else if (existingDeliveryStatus === DELIVERY_STATUSES.unassigned) {
      updatePayload.delivery_status = DELIVERY_STATUSES.pending;
    }
  }

  return updatePayload;
};

export const orderReturningFields = {
  order_id: orders.order_id,
  customer_id: orders.customer_id,
  order_date: orders.order_date,
  delivery_date: orders.delivery_date,
  delivery_status: orders.delivery_status,
  delivery_user_id: orders.delivery_user_id,
  delivered_at: orders.delivered_at,
  delivered_by: orders.delivered_by,
};