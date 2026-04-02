import express from 'express';
import { db } from '../db/db.js';
import { customers, orders } from '../db/schema.js';
import { asc, desc, eq, ilike, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, requireRole } from '../middleware/rbac.js';
import { asyncHandler, AppError } from '../utils/errors.js';
import { validate } from '../middleware/validate.js';
import { customerPayloadSchema } from '../validators/entity.js';
import { idParamSchema } from '../validators/common.js';
import { buildPaginatedResponse, logPaginationDebug, parseListQuery } from '../utils/pagination.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', requireRole('Admin', 'User'), asyncHandler(async (req, res) => {
  const { page, limit, offset, sort, search } = parseListQuery(req.query);
  const sortDirection = sort === 'asc' ? asc(customers.customer_id) : desc(customers.customer_id);
  const whereClause = search
    ? ilike(customers.name, `%${search}%`)
    : undefined;

  logPaginationDebug({
    route: 'customers.list',
    query: req.query,
    parsed: { page, limit, offset, sort, search },
  });

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        customer_id: customers.customer_id,
        name: customers.name,
        address: customers.address,
        contact_no: customers.contact_no,
      })
      .from(customers)
      .where(whereClause)
      .orderBy(sortDirection)
      .limit(limit)
      .offset(offset),
    db.select({ count: sql`count(*)::int` }).from(customers).where(whereClause),
  ]);

  res.json(buildPaginatedResponse({
    data: rows,
    total: Number(totalRows[0]?.count || 0),
    page,
    limit,
  }));
}));

router.get('/:id', requireRole('Admin', 'User'), validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  const customerId = Number(req.params.id);
  const customer = await db.select().from(customers).where(eq(customers.customer_id, customerId));
  if (!customer.length) {
    throw new AppError(404, 'Customer not found.');
  }

  res.json(customer[0]);
}));

router.post('/', requireAdmin, validate(customerPayloadSchema), asyncHandler(async (req, res) => {
  const [newCustomer] = await db.insert(customers).values(req.body).returning();
  res.status(201).json(newCustomer);
}));

router.put('/:id', requireAdmin, validate(idParamSchema, 'params'), validate(customerPayloadSchema), asyncHandler(async (req, res) => {
  const customerId = Number(req.params.id);
  const [updatedCustomer] = await db.update(customers).set(req.body).where(eq(customers.customer_id, customerId)).returning();

  if (!updatedCustomer) {
    throw new AppError(404, 'Customer not found.');
  }

  res.json(updatedCustomer);
}));

router.delete('/:id', requireAdmin, validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  const customerId = Number(req.params.id);
  const customerOrders = await db.select({ order_id: orders.order_id }).from(orders).where(eq(orders.customer_id, customerId)).limit(1);
  if (customerOrders.length > 0) {
    throw new AppError(409, 'This record cannot be deleted because it is used in other records.');
  }

  await db.delete(customers).where(eq(customers.customer_id, customerId));
  res.json({ success: true });
}));

export default router;
