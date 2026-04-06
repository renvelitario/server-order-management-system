import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../db/db.js';
import { getLocalUserByAuthUser } from '../utils/authUser.js';
import { getCurrentDeviceId, hasCurrentDeviceIdHeader, isDeviceSessionRevoked, trackUserDevice } from '../utils/deviceTracking.js';

const ACTIVE_STATUS = 'active';

export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized request.' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized request.' });
    }

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    const localUser = await getLocalUserByAuthUser(user);
    if (!localUser) {
      return res.status(403).json({ error: 'Account is not provisioned.' });
    }

    if (String(localUser.status || '').toLowerCase() !== ACTIVE_STATUS) {
      return res.status(403).json({ error: 'Your account has been disabled. Please contact your organization admin to activate your account.' });
    }

    req.user = user;
    req.localUser = localUser;

    const currentDeviceId = getCurrentDeviceId(req);
    if (hasCurrentDeviceIdHeader(req) && !currentDeviceId) {
      return res.status(400).json({ error: 'Invalid device identifier.' });
    }

    if (currentDeviceId && localUser.user_id) {
      const revoked = await isDeviceSessionRevoked(Number(localUser.user_id), currentDeviceId);
      if (revoked) {
        return res.status(401).json({ error: 'Session has been signed out for this device. Please sign in again.' });
      }
    }

    if (localUser.user_id) {
      trackUserDevice(req, Number(localUser.user_id)).catch((trackingError) => {
        console.warn('[AUTH_DEVICE_TRACKING] Unable to update device activity.', trackingError);
      });
    }

    next();
  } catch (err) {
    console.error('[AUTH_ERROR]', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};
