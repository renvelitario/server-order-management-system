import { AppError } from '../utils/errors.js';

export const DELIVERY_STATUSES = {
  unassigned: 'unassigned',
  pending: 'pending',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  failed: 'failed',
  cancelled: 'cancelled',
};

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const deliveryTransitionMap = {
  [DELIVERY_STATUSES.unassigned]: new Set([DELIVERY_STATUSES.pending, DELIVERY_STATUSES.cancelled]),
  [DELIVERY_STATUSES.pending]: new Set([DELIVERY_STATUSES.out_for_delivery, DELIVERY_STATUSES.cancelled]),
  [DELIVERY_STATUSES.out_for_delivery]: new Set([DELIVERY_STATUSES.delivered, DELIVERY_STATUSES.failed]),
  [DELIVERY_STATUSES.failed]: new Set([DELIVERY_STATUSES.pending, DELIVERY_STATUSES.out_for_delivery, DELIVERY_STATUSES.cancelled]),
  [DELIVERY_STATUSES.delivered]: new Set([DELIVERY_STATUSES.out_for_delivery]),
  [DELIVERY_STATUSES.cancelled]: new Set(),
};

export const parseOrderDate = (value) => {
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

export const parseDeliveryDate = (value) => {
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

export const isAdminRequest = (req) => String(req.localUser?.acc_type || '').toLowerCase() === 'admin';

export const assertValidDeliveryStatus = (value) => {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim();
  if (!Object.values(DELIVERY_STATUSES).includes(normalized)) {
    throw new AppError(400, 'Invalid delivery status filter.');
  }

  return normalized;
};

export const canTransitionDeliveryStatus = (currentStatus, nextStatus) => {
  if (currentStatus === nextStatus) {
    return true;
  }

  return deliveryTransitionMap[currentStatus]?.has(nextStatus) || false;
};

export const resolveTodayRange = (utcOffsetMinutes = null) => {
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

export const parseClientUtcOffsetMinutes = (req) => {
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

export const parseDeliveryDateRangeFilter = (value) => {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized || normalized === 'all_time') {
    return 'all_time';
  }

  if (['weekly', 'monthly', 'yearly'].includes(normalized)) {
    return normalized;
  }

  throw new AppError(400, 'Invalid delivery date range filter.');
};

export const resolveDeliveryDateRange = (range) => {
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

export const isTodayDeliveryDate = (value, utcOffsetMinutes = null) => {
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

export const canDeliveryUserAccessOrderToday = (order, utcOffsetMinutes = null) => {
  if (!order) {
    return false;
  }

  return order.delivery_status === DELIVERY_STATUSES.out_for_delivery
    && isTodayDeliveryDate(order.delivery_date, utcOffsetMinutes);
};

export const formatDeliveryStatusLabel = (value: string): string => String(value || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());