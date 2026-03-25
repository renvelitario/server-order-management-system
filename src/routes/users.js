import express from 'express';
import { db } from '../db/db.js';
import { users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const allUsers = await db.select({
      user_id: users.user_id,
      email: users.email,
      username: users.username,
      acc_type: users.acc_type,
      status: users.status
    }).from(users);
    res.json(allUsers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
