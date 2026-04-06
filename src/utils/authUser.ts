import { eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { users } from '../db/schema.js';
import type { AuthUser, LocalUser } from '../types/auth.js';

export const publicUserColumns = {
  user_id: users.user_id,
  email: users.email,
  username: users.username,
  name: users.name,
  acc_type: users.acc_type,
  status: users.status,
  inactivity_timeout_minutes: users.inactivity_timeout_minutes,
  session_timeout_enabled: users.session_timeout_enabled,
  supabase_id: users.supabase_id,
};

export const getLocalUserByAuthUser = async (authUser: AuthUser): Promise<LocalUser | null> => {
  let localUser = await db
    .select(publicUserColumns)
    .from(users)
    .where(eq(users.supabase_id, authUser.id))
    .limit(1);

  if (!localUser.length && authUser.email) {
    localUser = await db
      .select(publicUserColumns)
      .from(users)
      .where(eq(users.email, authUser.email))
      .limit(1);
  }

  return localUser[0] || null;
};
