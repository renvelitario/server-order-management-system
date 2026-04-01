import { supabaseAdmin } from '../db/db.js';
import { db } from '../db/db.js';
import { users } from '../db/schema.js';
import { eq, or } from 'drizzle-orm';

const ACTIVE_STATUS = 'active';

const findLocalUser = async (authUser) => {
  const byIdentity = await db
    .select({
      user_id: users.user_id,
      email: users.email,
      username: users.username,
      acc_type: users.acc_type,
      status: users.status,
      inactivity_timeout_minutes: users.inactivity_timeout_minutes,
      supabase_id: users.supabase_id,
    })
    .from(users)
    .where(or(
      eq(users.supabase_id, authUser.id),
      eq(users.email, authUser.email),
    ))
    .limit(1);

  return byIdentity[0] || null;
};

export const requireAuth = async (req, res, next) => {
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

    const localUser = await findLocalUser(user);
    if (!localUser) {
      return res.status(403).json({ error: 'Account is not provisioned.' });
    }

    if (String(localUser.status || '').toLowerCase() !== ACTIVE_STATUS) {
      return res.status(403).json({ error: 'Account is not active.' });
    }

    req.user = user;
    req.localUser = localUser;
    next();
  } catch (err) {
    console.error('[AUTH_ERROR]', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
