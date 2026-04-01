import express from 'express';
import { supabaseAdmin, db } from '../db/db.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { asyncHandler, AppError } from '../utils/errors.js';
import { validate } from '../middleware/validate.js';
import {
  changePasswordSchema,
  registerUserSchema,
  updateProfileSchema,
  updateSessionTimeoutSchema,
  updateUserByAdminSchema,
} from '../validators/auth.js';
import { idParamSchema } from '../validators/common.js';

const router = express.Router();
const DEFAULT_INACTIVITY_MINUTES = 60;
const MIN_INACTIVITY_MINUTES = 10;
const MAX_INACTIVITY_MINUTES = 480;

const publicUserColumns = {
  user_id: users.user_id,
  email: users.email,
  username: users.username,
  acc_type: users.acc_type,
  status: users.status,
  inactivity_timeout_minutes: users.inactivity_timeout_minutes,
  supabase_id: users.supabase_id
};

const normalizeInactivityTimeout = (value) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    return DEFAULT_INACTIVITY_MINUTES;
  }

  return Math.min(MAX_INACTIVITY_MINUTES, Math.max(MIN_INACTIVITY_MINUTES, Math.round(parsedValue)));
};

const getLocalUserByAuthUser = async (authUser) => {
  let localUser = await db.select(publicUserColumns).from(users).where(eq(users.supabase_id, authUser.id)).limit(1);

  if (!localUser.length) {
    localUser = await db.select(publicUserColumns).from(users).where(eq(users.email, authUser.email)).limit(1);
  }

  return localUser[0] || null;
};

router.post('/register', requireAuth, requireAdmin, validate(registerUserSchema), asyncHandler(async (req, res) => {
  const { username, email, password, acc_type, status } = req.body;

  const existingUser = await db.select({ user_id: users.user_id }).from(users).where(eq(users.email, email)).limit(1);
  if (existingUser.length) {
    throw new AppError(409, 'Email already exists.');
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

  const normalizedTimeout = normalizeInactivityTimeout(req.body.inactivity_timeout_minutes);

  const [updatedUser] = await db.update(users)
    .set({
      inactivity_timeout_minutes: normalizedTimeout,
    })
    .where(eq(users.user_id, localUser.user_id))
    .returning(publicUserColumns);

  res.json(updatedUser);
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
  const userId = req.params.id;

  const [updatedUser] = await db.update(users)
    .set(req.body)
    .where(eq(users.user_id, userId))
    .returning(publicUserColumns);

  if (!updatedUser) {
    throw new AppError(404, 'User not found.');
  }

  res.json(updatedUser);
}));

export default router;
