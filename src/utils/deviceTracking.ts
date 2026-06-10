import type { Request } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/db.js';
import { revokedDeviceSessions, userDevices } from '../db/schema.js';

type DeviceSessionRecord = {
  device_id: string;
  device_label: string | null;
  user_agent: string;
  timezone: string | null;
  last_ip: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
};

const DEVICE_HEADER = 'x-client-device-id';
const DEVICE_LABEL_HEADER = 'x-client-device-label';
const TIMEZONE_HEADER = 'x-client-timezone';
const UNKNOWN_DEVICE = 'Unknown device';

const parseClientIp = (request: Request): string | null => {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  return request.ip || null;
};

export const getCurrentDeviceId = (request: Request): string | null => {
  const headerValue = request.headers[DEVICE_HEADER];
  if (typeof headerValue !== 'string') {
    return null;
  }

  const normalized = headerValue.trim();
  return normalized ? normalized.slice(0, 80) : null;
};

export const trackUserDevice = async (request: Request, userId: number): Promise<void> => {
  const deviceId = getCurrentDeviceId(request);
  if (!deviceId) {
    return;
  }

  const userAgent = request.headers['user-agent']?.trim() || UNKNOWN_DEVICE;
  const timezoneHeader = request.headers[TIMEZONE_HEADER];
  const timezone = typeof timezoneHeader === 'string' ? timezoneHeader.trim().slice(0, 80) : null;
  const labelHeader = request.headers[DEVICE_LABEL_HEADER];
  const deviceLabel = typeof labelHeader === 'string' ? labelHeader.trim().slice(0, 200) : null;
  const lastIp = parseClientIp(request);

  await db.insert(userDevices).values({
    device_id: deviceId,
    user_id: userId,
    device_label: deviceLabel,
    user_agent: userAgent,
    timezone,
    last_ip: lastIp,
  }).onConflictDoUpdate({
    target: userDevices.device_id,
    set: {
      user_id: userId,
      device_label: deviceLabel,
      user_agent: userAgent,
      timezone,
      last_ip: lastIp,
      last_seen_at: new Date(),
    },
  });
};

export const listUserDevices = async (userId: number): Promise<DeviceSessionRecord[]> => {
  return db
    .select({
      device_id: userDevices.device_id,
      device_label: userDevices.device_label,
      user_agent: userDevices.user_agent,
      timezone: userDevices.timezone,
      last_ip: userDevices.last_ip,
      first_seen_at: userDevices.first_seen_at,
      last_seen_at: userDevices.last_seen_at,
    })
    .from(userDevices)
    .where(eq(userDevices.user_id, userId))
    .orderBy(desc(userDevices.last_seen_at));
};

export const removeUserDevice = async (userId: number, deviceId: string): Promise<boolean> => {
  const deletedRows = await db
    .delete(userDevices)
    .where(and(eq(userDevices.user_id, userId), eq(userDevices.device_id, deviceId)))
    .returning({ device_id: userDevices.device_id });

  return deletedRows.length > 0;
};

export const revokeDeviceSession = async (userId: number, deviceId: string): Promise<void> => {
  await db
    .insert(revokedDeviceSessions)
    .values({
      user_id: userId,
      device_id: deviceId,
    })
    .onConflictDoUpdate({
      target: [revokedDeviceSessions.user_id, revokedDeviceSessions.device_id],
      set: {
        revoked_at: new Date(),
      },
    });
};

export const revokeAllTrackedDeviceSessions = async (): Promise<number> => {
  const revokedRows = await db.execute(sql`
    INSERT INTO ims_revoked_device_sessions (user_id, device_id, revoked_at)
    SELECT user_id, device_id, NOW()
    FROM ims_user_devices
    ON CONFLICT (user_id, device_id)
    DO UPDATE SET revoked_at = EXCLUDED.revoked_at
    RETURNING user_id, device_id
  `);

  return revokedRows.rowCount ?? 0;
};

export const clearDeviceRevocation = async (userId: number, deviceId: string): Promise<void> => {
  await db
    .delete(revokedDeviceSessions)
    .where(and(eq(revokedDeviceSessions.user_id, userId), eq(revokedDeviceSessions.device_id, deviceId)));
};

export const isDeviceSessionRevoked = async (userId: number, deviceId: string): Promise<boolean> => {
  const revoked = await db
    .select({ revoked_session_id: revokedDeviceSessions.revoked_session_id })
    .from(revokedDeviceSessions)
    .where(and(eq(revokedDeviceSessions.user_id, userId), eq(revokedDeviceSessions.device_id, deviceId)))
    .limit(1);

  return revoked.length > 0;
};

