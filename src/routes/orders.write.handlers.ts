import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { orders, orderItems } from '../db/schema.js';
import { AppError } from '../utils/errors.js';
import { createNotificationsForRole } from '../utils/notifications.js';
import {
  buildOrderUpdatePayload,
  calculateOrderTotal,
  ensureCustomerExists,
  ensureProductsAreActive,
  getUniqueProductIds,
  insertOrderItems,
  orderReturningFields,
  resolveInitialDeliveryStatus,
  type OrderPayload,
} from './orders.write.service.js';
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

export const createOrderHandler = async (req: Request, res: Response) => {
  const { customer_id, order_date, items_data, delivery_date, discount = 0, delivery_fee = 0 } = req.body as OrderPayload;
  const uniqueProductIds = getUniqueProductIds(items_data);

  const result = await db.transaction(async (tx) => {
    await ensureCustomerExists(tx, customer_id);
    await ensureProductsAreActive(tx, uniqueProductIds);

    const { parsedDeliveryDate, initialDeliveryStatus } = resolveInitialDeliveryStatus(delivery_date);

    const [newOrder] = await tx.insert(orders).values({
      customer_id,
      order_date: parseOrderDate(order_date),
      delivery_date: parsedDeliveryDate,
      delivery_status: initialDeliveryStatus,
      delivery_user_id: null,
      discount,
      delivery_fee,
    }).returning();

    const createdItems = await insertOrderItems(tx, newOrder.order_id, items_data);
    const totalAmount = calculateOrderTotal(createdItems);
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
  const uniqueProductIds = getUniqueProductIds(items_data);

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

    await ensureCustomerExists(tx, customer_id);
    await ensureProductsAreActive(tx, uniqueProductIds);

    const updatePayload = buildOrderUpdatePayload({
      customerId: customer_id,
      orderDate: order_date,
      deliveryDate: delivery_date,
      existingDeliveryStatus: existingOrderRows[0].delivery_status,
    });

    const [updatedOrder] = await tx
      .update(orders)
      .set(updatePayload)
      .where(eq(orders.order_id, orderId))
      .returning(orderReturningFields);

    await tx.delete(orderItems).where(eq(orderItems.order_id, orderId));

    const updatedItems = await insertOrderItems(tx, orderId, items_data);
    const totalAmount = calculateOrderTotal(updatedItems);

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