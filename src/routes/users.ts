import express from 'express';
import { db } from '../db/db.js';
import { users } from '../db/schema.js';
import { asc, desc, ilike, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { asyncHandler } from '../utils/errors.js';
import { buildPaginatedResponse, logPaginationDebug, parseListQuery } from '../utils/pagination.js';

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset, sort, search } = parseListQuery(req.query);
  const sortDirection = sort === 'asc' ? asc(users.user_id) : desc(users.user_id);
  const whereClause = search
    ? ilike(users.username, `%${search}%`)
    : undefined;

  logPaginationDebug({
    route: 'users.list',
    query: req.query,
    parsed: { page, limit, offset, sort, search },
  });

  const [allUsers, totalRows] = await Promise.all([
    db.select({
      user_id: users.user_id,
      email: users.email,
      username: users.username,
      acc_type: users.acc_type,
      status: users.status,
      inactivity_timeout_minutes: users.inactivity_timeout_minutes,
    }).from(users).where(whereClause).orderBy(sortDirection).limit(limit).offset(offset),
    db.select({ count: sql`count(*)::int` }).from(users).where(whereClause),
  ]);

  res.json(buildPaginatedResponse({
    data: allUsers,
    total: Number(totalRows[0]?.count || 0),
    page,
    limit,
  }));
}));

export default router;
