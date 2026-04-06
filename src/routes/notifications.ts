import express from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/db.js';
import { notifications } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../utils/errors.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import { buildPaginatedResponse, parseListQuery } from '../utils/pagination.js';

const router = express.Router();
router.use(requireAuth);

router.get('/summary', asyncHandler(async (req, res) => {
  const recipientUserId = Number(req.localUser?.user_id);

  const unreadRows = await db
    .select({ count: sql`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.recipient_user_id, recipientUserId), eq(notifications.is_read, false)));

  res.json({
    unread: Number(unreadRows[0]?.count || 0),
  });
}));

router.get('/', asyncHandler(async (req, res) => {
  const recipientUserId = Number(req.localUser?.user_id);
  const { page, limit, offset } = parseListQuery(req.query);
  const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : 'all';

  if (!['all', 'unread'].includes(statusFilter)) {
    throw new AppError(400, 'Invalid notification status filter.');
  }

  const conditions = [eq(notifications.recipient_user_id, recipientUserId)];
  if (statusFilter === 'unread') {
    conditions.push(eq(notifications.is_read, false));
  }

  const whereClause = and(...conditions);

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        notification_id: notifications.notification_id,
        event_type: notifications.event_type,
        title: notifications.title,
        message: notifications.message,
        order_id: notifications.order_id,
        is_read: notifications.is_read,
        read_at: notifications.read_at,
        created_at: notifications.created_at,
      })
      .from(notifications)
      .where(whereClause)
      .orderBy(desc(notifications.notification_id))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql`count(*)::int` })
      .from(notifications)
      .where(whereClause),
  ]);

  res.json(buildPaginatedResponse({
    data: rows,
    total: Number(totalRows[0]?.count || 0),
    page,
    limit,
  }));
}));

router.patch('/read-all', asyncHandler(async (req, res) => {
  const recipientUserId = Number(req.localUser?.user_id);

  const updatedRows = await db
    .update(notifications)
    .set({
      is_read: true,
      read_at: new Date(),
    })
    .where(and(eq(notifications.recipient_user_id, recipientUserId), eq(notifications.is_read, false)))
    .returning({ notification_id: notifications.notification_id });

  res.json({
    success: true,
    updated: updatedRows.length,
  });
}));

router.patch('/:id/read', validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  const recipientUserId = Number(req.localUser?.user_id);
  const notificationId = Number(req.params.id);

  const [row] = await db
    .update(notifications)
    .set({
      is_read: true,
      read_at: new Date(),
    })
    .where(and(eq(notifications.notification_id, notificationId), eq(notifications.recipient_user_id, recipientUserId)))
    .returning({
      notification_id: notifications.notification_id,
      is_read: notifications.is_read,
      read_at: notifications.read_at,
    });

  if (!row) {
    throw new AppError(404, 'Notification not found.');
  }

  res.json(row);
}));

export default router;
