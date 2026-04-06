import type { Request, Response } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/db.js';
import { customers, orders, orderItems, products } from '../db/schema.js';
import { AppError } from '../utils/errors.js';
import { createNotificationsForRole } from '../utils/notifications.js';
import {
  DELIVERY_STATUSES,
  canDeliveryUserAccessOrderToday,
  canTransitionDeliveryStatus,
  formatDeliveryStatusLabel,
  isAdminRequest,
  parseClientUtcOffsetMinutes,
  parseDeliveryDate,
  parseOrderDate,
} from './orders.helpers.js';

type OrderPayload = {
  customer_id: number;
  order_date?: string;
  delivery_date?: string;
  items_data: Array<{ product_id: number; quantity: number; price: number }>;
  discount?: number;
  delivery_fee?: number;
};

export const createOrderHandler = async (req: Request, res: Response) => {
  const { customer_id, order_date, items_data, delivery_date, discount = 0, delivery_fee = 0 } = req.body as OrderPayload;
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
      discount,
      delivery_fee,
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
};

export const updateOrderHandler = async (req: Request, res: Response) => {
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
};

export const updateOrderDeliveryStatusHandler = async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  const utcOffsetMinutes = parseClientUtcOffsetMinutes(req);
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
    if (!canDeliveryUserAccessOrderToday(existingOrder, utcOffsetMinutes)) {
      throw new AppError(403, 'Delivery users can only update orders that are out for delivery today.');
    }

    const canCompleteActiveDelivery = [DELIVERY_STATUSES.delivered, DELIVERY_STATUSES.failed].includes(delivery_status);

    if (!canCompleteActiveDelivery) {
      throw new AppError(403, 'Delivery users can only mark today\'s out-for-delivery orders as delivered or failed.');
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

  const previousStatus = existingOrder.delivery_status;
  const hasStatusChanged = previousStatus !== delivery_status;
  if (hasStatusChanged) {
    const actorName = String(req.localUser?.name || req.localUser?.username || 'A user').trim();
    const previousStatusLabel = formatDeliveryStatusLabel(previousStatus);
    const nextStatusLabel = formatDeliveryStatusLabel(delivery_status);

    if (adminRequest) {
      await createNotificationsForRole({
        role: 'User',
        payload: {
          eventType: 'order_status_changed_by_admin',
          title: 'Order status updated by admin',
          message: `Admin ${actorName} changed order #${orderId} from ${previousStatusLabel} to ${nextStatusLabel}.`,
          orderId,
        },
      });
    } else {
      if (delivery_status === DELIVERY_STATUSES.delivered) {
        await createNotificationsForRole({
          role: 'Admin',
          payload: {
            eventType: 'order_delivered_by_rider',
            title: 'Delivery completed',
            message: `${actorName} marked order #${orderId} as delivered.`,
            orderId,
          },
        });
      } else if (delivery_status === DELIVERY_STATUSES.failed) {
        await createNotificationsForRole({
          role: 'Admin',
          payload: {
            eventType: 'delivery_failed_by_rider',
            title: 'Delivery failed',
            message: `${actorName} marked order #${orderId} as failed.`,
            orderId,
          },
        });
      } else {
        await createNotificationsForRole({
          role: 'Admin',
          payload: {
            eventType: 'order_status_edited_by_rider',
            title: 'Order status edited by rider',
            message: `${actorName} changed order #${orderId} from ${previousStatusLabel} to ${nextStatusLabel}.`,
            orderId,
          },
        });
      }
    }
  }

  res.json(updatedOrder);
};

export const updateOrderDeliveryAssignmentHandler = async (req: Request, res: Response) => {
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
};

export const deleteOrderHandler = async (req: Request, res: Response) => {
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
};