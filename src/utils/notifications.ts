import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../db/db.js';
import { notifications, users } from '../db/schema.js';

type NotificationAudienceRole = 'Admin' | 'User';

type NotificationPayload = {
  eventType: string;
  title: string;
  message: string;
  orderId?: number | null;
};

const ACTIVE_STATUS = 'Active';

export const createNotificationsForRole = async ({
  role,
  payload,
  excludeUserId,
}: {
  role: NotificationAudienceRole;
  payload: NotificationPayload;
  excludeUserId?: number;
}) => {
  const conditions = [eq(users.acc_type, role), eq(users.status, ACTIVE_STATUS)];

  if (excludeUserId) {
    conditions.push(ne(users.user_id, excludeUserId));
  }

  const recipients = await db
    .select({ user_id: users.user_id })
    .from(users)
    .where(and(...conditions));

  if (!recipients.length) {
    return 0;
  }

  await db.insert(notifications).values(
    recipients.map(({ user_id }) => ({
      recipient_user_id: user_id,
      event_type: payload.eventType,
      title: payload.title,
      message: payload.message,
      order_id: payload.orderId ?? null,
    })),
  );

  return recipients.length;
};

export const createNotificationsForUsers = async ({
  userIds,
  payload,
}: {
  userIds: number[];
  payload: NotificationPayload;
}) => {
  const dedupedUserIds = [...new Set(userIds.filter((value) => Number.isFinite(value)))];

  if (!dedupedUserIds.length) {
    return 0;
  }

  const activeRecipients = await db
    .select({ user_id: users.user_id })
    .from(users)
    .where(and(inArray(users.user_id, dedupedUserIds), eq(users.status, ACTIVE_STATUS)));

  if (!activeRecipients.length) {
    return 0;
  }

  await db.insert(notifications).values(
    activeRecipients.map(({ user_id }) => ({
      recipient_user_id: user_id,
      event_type: payload.eventType,
      title: payload.title,
      message: payload.message,
      order_id: payload.orderId ?? null,
    })),
  );

  return activeRecipients.length;
};
