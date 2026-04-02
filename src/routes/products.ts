import express from 'express';
import { db } from '../db/db.js';
import { products, orderItems, purchases } from '../db/schema.js';
import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, requireRole } from '../middleware/rbac.js';
import { asyncHandler, AppError } from '../utils/errors.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import { productPayloadSchema } from '../validators/entity.js';
import { buildPaginatedResponse, parseListQuery } from '../utils/pagination.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', requireRole('Admin', 'User'), asyncHandler(async (req, res) => {
  const { page, limit, offset, sort, search } = parseListQuery(req.query);
  const sortDirection = sort === 'asc' ? asc(products.product_id) : desc(products.product_id);
  const whereClause = search
    ? and(ilike(products.product_name, `%${search}%`))
    : undefined;

  console.info('[DEBUG_PAGINATION]', {
    route: 'products.list',
    query: req.query,
    parsed: { page, limit, offset, sort, search },
  });

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        product_id: products.product_id,
        product_name: products.product_name,
        quantity: products.quantity,
        price: products.price,
        status: products.status,
      })
      .from(products)
      .where(whereClause)
      .orderBy(sortDirection)
      .limit(limit)
      .offset(offset),
    db.select({ count: sql`count(*)::int` }).from(products).where(whereClause),
  ]);

  res.json(buildPaginatedResponse({
    data: rows,
    total: Number(totalRows[0]?.count || 0),
    page,
    limit,
  }));
}));

router.get('/:id', requireRole('Admin', 'User'), validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  const productId = Number(req.params.id);
  const product = await db.select().from(products).where(eq(products.product_id, productId));
  if (!product.length) {
    throw new AppError(404, 'Product not found.');
  }

  res.json(product[0]);
}));

router.post('/', requireAdmin, validate(productPayloadSchema), asyncHandler(async (req, res) => {
  const [newProduct] = await db.insert(products).values(req.body).returning();
  res.status(201).json(newProduct);
}));

router.put('/:id', requireAdmin, validate(idParamSchema, 'params'), validate(productPayloadSchema), asyncHandler(async (req, res) => {
  const productId = Number(req.params.id);
  const [updatedProduct] = await db.update(products).set(req.body).where(eq(products.product_id, productId)).returning();

  if (!updatedProduct) {
    throw new AppError(404, 'Product not found.');
  }

  res.json(updatedProduct);
}));

router.delete('/:id', requireAdmin, validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  const productId = Number(req.params.id);

  const [inOrderItems, inPurchases] = await Promise.all([
    db.select({ order_item_id: orderItems.order_item_id }).from(orderItems).where(eq(orderItems.product_id, productId)).limit(1),
    db.select({ purchase_id: purchases.purchase_id }).from(purchases).where(eq(purchases.product_id, productId)).limit(1),
  ]);

  if (inOrderItems.length || inPurchases.length) {
    throw new AppError(409, 'This record cannot be deleted because it is used in other records.');
  }

  await db.delete(products).where(eq(products.product_id, productId));
  res.json({ success: true });
}));

export default router;
