import express from 'express';
import { supabaseAdmin, db } from '../db/db.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';

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

// Register a new user
router.post('/register', requireAuth, async (req, res) => {
  const { username, email, password, confirm_password, acc_type, status } = req.body;
  if (!email || !password || !username) return res.status(400).json({ error: 'Missing required fields' });
  if (password !== confirm_password) return res.status(400).json({ error: 'Passwords do not match' });

  try {
    const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existingUser.length) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    // Register with Supabase
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (error) return res.status(400).json({ error: error.message });

    const supabaseId = data.user.id;

    // Insert into local DB
    const [newUser] = await db.insert(users).values({
      email: email.trim(),
      username: username.trim(),
      acc_type: acc_type || 'User',
      status: status || 'Active',
      inactivity_timeout_minutes: DEFAULT_INACTIVITY_MINUTES,
      supabase_id: supabaseId
    }).returning();

    const { password: _password, ...safeUser } = newUser;
    res.status(201).json({ message: 'User registered successfully', user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password
    });

    if (error) return res.status(400).json({ error: error.message });
    
    // Fetch local user details to get acc_type
    const localUser = await db.select(publicUserColumns).from(users).where(eq(users.email, email)).limit(1);
    
    res.json({ 
      token: data.session.access_token, 
      user: { ...data.user, ...localUser[0] }
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user details
router.get('/me', requireAuth, async (req, res) => {
  try {
    const localUser = await getLocalUserByAuthUser(req.user);
    if (!localUser) return res.status(404).json({ error: 'User not found in local DB' });
    
    res.json(localUser);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update profile / settings
router.put('/profile', requireAuth, async (req, res) => {
  const { email: newEmail, username, status, acc_type, password } = req.body;
   try {
     if (!password) {
       return res.status(400).json({ error: 'Password confirmation is required' });
     }

    const localUser = await getLocalUserByAuthUser(req.user);

    if (!localUser) {
      return res.status(404).json({ error: 'User not found in local DB' });
     }

    const currentEmail = localUser.email;

     const { error: passwordError } = await supabaseAdmin.auth.signInWithPassword({
      email: currentEmail,
      password
     });

     if (passwordError) {
      return res.status(401).json({ error: 'Incorrect password. Account details not updated.' });
     }

     if (newEmail && newEmail !== currentEmail) {
      const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
        email: newEmail
      });

      if (updateAuthError) {
        return res.status(400).json({ error: updateAuthError.message });
      }
     }

     const [updatedUser] = await db.update(users)
       .set({
        email: newEmail || currentEmail,
        username,
        status,
        acc_type,
        supabase_id: req.user.id
       })
       .where(eq(users.user_id, localUser.user_id))
       .returning();

     const { password: _password, ...safeUser } = updatedUser;
     res.json(safeUser);
   } catch (error) {
     res.status(500).json({ error: 'Internal server error' });
   }
});

router.put('/session-timeout', requireAuth, async (req, res) => {
  const { inactivity_timeout_minutes } = req.body;

  try {
    const localUser = await getLocalUserByAuthUser(req.user);

    if (!localUser) {
      return res.status(404).json({ error: 'User not found in local DB' });
    }

    const normalizedTimeout = normalizeInactivityTimeout(inactivity_timeout_minutes);

    const [updatedUser] = await db.update(users)
      .set({
        inactivity_timeout_minutes: normalizedTimeout,
      })
      .where(eq(users.user_id, localUser.user_id))
      .returning(publicUserColumns);

    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (new_password !== confirm_password) {
    return res.status(400).json({ error: 'New password and confirm password do not match.' });
  }

  try {
    const { error: verifyError } = await supabaseAdmin.auth.signInWithPassword({
      email: req.user.email,
      password: current_password
    });

    if (verifyError) {
      return res.status(401).json({ error: 'Invalid current password.' });
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
      password: new_password
    });

    if (updateError) {
      return res.status(400).json({ error: updateError.message });
    }

    res.json({ message: 'Password changed successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
