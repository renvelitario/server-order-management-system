import express from 'express';
import { supabaseAdmin, db } from '../db/db.js';
import { users } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { asyncHandler, AppError } from '../utils/errors.js';
import { validate } from '../middleware/validate.js';
import { getLocalUserByAuthUser, publicUserColumns } from '../utils/authUser.js';
import {
  loginSchema,
  changePasswordSchema,
  registerUserSchema,
  updateProfileSchema,
  updateSessionTimeoutSchema,
  updateUserByAdminSchema,
} from '../validators/auth.js';
import { idParamSchema } from '../validators/common.js';
import {
  clearDeviceRevocation,
  getCurrentDeviceId,
  listUserDevices,
  removeUserDevice,
  revokeDeviceSession,
} from '../utils/deviceTracking.js';

const router = express.Router();
const ACTIVE_STATUS = 'active';
const DEFAULT_INACTIVITY_MINUTES = 60;
const MIN_INACTIVITY_MINUTES = 10;
const MAX_INACTIVITY_MINUTES = 480;
const DEVICE_ACTIVE_FALLBACK_MINUTES = 24 * 60;

const normalizeInactivityTimeout = (value: unknown) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    return DEFAULT_INACTIVITY_MINUTES;
  }

  return Math.min(MAX_INACTIVITY_MINUTES, Math.max(MIN_INACTIVITY_MINUTES, Math.round(parsedValue)));
};

// Custom login endpoint that supports email, username, or phone
router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;

  // Determine if identifier is email, username, or phone
  const isEmail = identifier.includes('@');
  const isPhone = /^\d{7,}$/.test(identifier); // More robust phone detection
  
  let userEmail: string;

  if (isEmail) {
    userEmail = identifier;
  } else {
    // Look up user by username or phone to get their email
    // For username, make it case-insensitive by converting to lowercase
    const query = db.select({ email: users.email }).from(users);
    
    const whereClause = isPhone 
      ? eq(users.phone_number, identifier)
      : sql`LOWER(${users.username}) = LOWER(${identifier})`; // Case-insensitive username

    const [user] = await query.where(whereClause).limit(1);

    if (!user) {
      console.warn('Login failed: no matching local user for identifier type.', { isPhone });
      throw new AppError(401, 'Invalid credentials.');
    }

    userEmail = user.email;
  }

  // Authenticate with Supabase using the email
  const { data, error } = await supabaseAdmin.auth.signInWithPassword({
    email: userEmail,
    password,
  });

  if (error || !data?.session) {
    console.error('Supabase auth error:', error?.message || 'No session returned');
    throw new AppError(401, 'Invalid credentials.');
  }

  const localUser = await getLocalUserByAuthUser(data.user);
  if (!localUser) {
    throw new AppError(403, 'Account is not provisioned.');
  }

  if (String(localUser.status || '').toLowerCase() !== ACTIVE_STATUS) {
    throw new AppError(403, 'Your account has been disabled. Please contact your organization admin to activate your account.');
  }

  const currentDeviceId = getCurrentDeviceId(req);
  if (currentDeviceId) {
    await clearDeviceRevocation(Number(localUser.user_id), currentDeviceId);
  }

  res.json({
    message: 'Login successful.',
    session: data.session,
    user: data.user,
    local_user: localUser,
  });
}));

router.post('/register', requireAuth, requireAdmin, validate(registerUserSchema), asyncHandler(async (req, res) => {
  const { username, email, password, name, phone_number, acc_type, status } = req.body;

  const existingUser = await db.select({ user_id: users.user_id }).from(users).where(eq(users.email, email)).limit(1);
  if (existingUser.length) {
    throw new AppError(409, 'Email already exists.');
  }

  const existingUsername = await db.select({ user_id: users.user_id }).from(users).where(sql`LOWER(${users.username}) = LOWER(${username})`).limit(1);
  if (existingUsername.length) {
    throw new AppError(409, 'Username already exists.');
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data?.user?.id) {
    throw new AppError(400, 'Unable to create user account.');
  }

  const [newUser] = await db.insert(users).values({
    email,
    username,
    name,
    phone_number: phone_number || null,
    acc_type,
    status,
    inactivity_timeout_minutes: DEFAULT_INACTIVITY_MINUTES,
    supabase_id: data.user.id,
  }).returning(publicUserColumns);

  res.status(201).json({ message: 'User registered successfully.', user: newUser });
}));

// Get current user details
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const localUser = await getLocalUserByAuthUser(req.user);
  if (!localUser) {
    throw new AppError(404, 'User not found.');
  }

  res.json(localUser);
}));

router.put('/profile', requireAuth, validate(updateProfileSchema), asyncHandler(async (req, res) => {
  const { email: newEmail, username, password } = req.body;

  const localUser = await getLocalUserByAuthUser(req.user);
  if (!localUser) {
    throw new AppError(404, 'User not found.');
  }

  const { error: passwordError } = await supabaseAdmin.auth.signInWithPassword({
    email: localUser.email,
    password,
  });

  if (passwordError) {
    throw new AppError(401, 'Incorrect password.');
  }

  if (newEmail && newEmail !== localUser.email) {
    const duplicate = await db
      .select({ user_id: users.user_id })
      .from(users)
      .where(eq(users.email, newEmail))
      .limit(1);

    if (duplicate.length && duplicate[0].user_id !== localUser.user_id) {
      throw new AppError(409, 'Email already exists.');
    }

    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
      email: newEmail,
    });

    if (updateAuthError) {
      throw new AppError(400, 'Unable to update email.');
    }
  }

  const [updatedUser] = await db.update(users)
    .set({
      email: newEmail || localUser.email,
      username: username || localUser.username,
      supabase_id: req.user.id,
    })
    .where(eq(users.user_id, localUser.user_id))
    .returning(publicUserColumns);

  res.json(updatedUser);
}));

router.put('/session-timeout', requireAuth, validate(updateSessionTimeoutSchema), asyncHandler(async (req, res) => {
  const localUser = await getLocalUserByAuthUser(req.user);

  if (!localUser) {
    throw new AppError(404, 'User not found.');
  }

  const normalizedTimeout = req.body.session_timeout_enabled
    ? normalizeInactivityTimeout(req.body.inactivity_timeout_minutes)
    : normalizeInactivityTimeout(localUser.inactivity_timeout_minutes);

  const [updatedUser] = await db.update(users)
    .set({
      inactivity_timeout_minutes: normalizedTimeout,
      session_timeout_enabled: Boolean(req.body.session_timeout_enabled),
    })
    .where(eq(users.user_id, localUser.user_id))
    .returning(publicUserColumns);

  res.json(updatedUser);
}));

router.get('/session-devices', requireAuth, asyncHandler(async (req, res) => {
  const localUser = await getLocalUserByAuthUser(req.user);
  if (!localUser) {
    throw new AppError(404, 'User not found.');
  }

  const currentDeviceId = getCurrentDeviceId(req);
  const records = await listUserDevices(localUser.user_id);
  const now = Date.now();

  const activeWindowMinutes = localUser.session_timeout_enabled
    ? Math.max(MIN_INACTIVITY_MINUTES, localUser.inactivity_timeout_minutes)
    : DEVICE_ACTIVE_FALLBACK_MINUTES;
  const activeWindowMs = activeWindowMinutes * 60 * 1000;

  const devices = records.map((record) => {
    const lastSeenMs = new Date(record.last_seen_at).getTime();
    const isActive = Number.isFinite(lastSeenMs) && (now - lastSeenMs) <= activeWindowMs;

    return {
      ...record,
      is_current: currentDeviceId ? record.device_id === currentDeviceId : false,
      is_active: isActive,
    };
  });

  res.json({
    devices,
    total_devices: devices.length,
    active_devices: devices.filter((device) => device.is_active).length,
  });
}));

router.delete('/session-devices/:deviceId', requireAuth, asyncHandler(async (req, res) => {
  const localUser = await getLocalUserByAuthUser(req.user);
  if (!localUser) {
    throw new AppError(404, 'User not found.');
  }

  const deviceId = String(req.params.deviceId || '').trim();
  if (!deviceId) {
    throw new AppError(400, 'Device id is required.');
  }

  const currentDeviceId = getCurrentDeviceId(req);
  if (currentDeviceId && deviceId === currentDeviceId) {
    throw new AppError(400, 'Current device cannot be removed from this action.');
  }

  const removed = await removeUserDevice(localUser.user_id, deviceId);
  if (!removed) {
    throw new AppError(404, 'Device not found.');
  }

  await revokeDeviceSession(localUser.user_id, deviceId);

  res.json({ message: 'Device removed and signed out from this account.' });
}));

router.post('/change-password', requireAuth, validate(changePasswordSchema), asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;

  const { error: verifyError } = await supabaseAdmin.auth.signInWithPassword({
    email: req.user.email,
    password: current_password,
  });

  if (verifyError) {
    throw new AppError(401, 'Invalid current password.');
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
    password: new_password,
  });

  if (updateError) {
    throw new AppError(400, 'Unable to change password.');
  }

  res.json({ message: 'Password changed successfully.' });
}));

router.patch('/users/:id', requireAuth, requireAdmin, validate(idParamSchema, 'params'), validate(updateUserByAdminSchema), asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  const localAdminUserId = Number(req.localUser?.user_id);
  const {
    name,
    email,
    username,
    acc_type,
    status,
    new_password,
  } = req.body;

  const [targetUser] = await db.select(publicUserColumns)
    .from(users)
    .where(eq(users.user_id, userId))
    .limit(1);

  if (!targetUser) {
    throw new AppError(404, 'User not found.');
  }

  if (targetUser.acc_type === 'Admin' && targetUser.user_id !== localAdminUserId) {
    throw new AppError(403, 'Co-admin accounts cannot be modified.');
  }

  if (email && email !== targetUser.email) {
    const duplicate = await db
      .select({ user_id: users.user_id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (duplicate.length && duplicate[0].user_id !== targetUser.user_id) {
      throw new AppError(409, 'Email already exists.');
    }

    const { error: updateEmailError } = await supabaseAdmin.auth.admin.updateUserById(targetUser.supabase_id, {
      email,
    });

    if (updateEmailError) {
      throw new AppError(400, 'Unable to update email.');
    }
  }

  if (new_password) {
    const { error: updatePasswordError } = await supabaseAdmin.auth.admin.updateUserById(targetUser.supabase_id, {
      password: new_password,
    });

    if (updatePasswordError) {
      throw new AppError(400, 'Unable to update password.');
    }
  }

  const localUpdatePayload = {
    ...(email ? { email } : {}),
    ...(username ? { username } : {}),
    ...(name ? { name } : {}),
    ...(acc_type ? { acc_type } : {}),
    ...(status ? { status } : {}),
  };

  if (!Object.keys(localUpdatePayload).length) {
    const [freshUser] = await db.select(publicUserColumns)
      .from(users)
      .where(eq(users.user_id, userId))
      .limit(1);

    res.json(freshUser);
    return;
  }

  const [updatedUser] = await db.update(users)
    .set(localUpdatePayload)
    .where(eq(users.user_id, userId))
    .returning(publicUserColumns);

  res.json(updatedUser);
}));

export default router;
