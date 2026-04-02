import express from 'express';
import { db } from '../db/db.js';
import { purchases, products } from '../db/schema.js';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, requireRole } from '../middleware/rbac.js';
import { asyncHandler, AppError } from '../utils/errors.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import { purchasePayloadSchema } from '../validators/entity.js';
import { buildPaginatedResponse, parseListQuery } from '../utils/pagination.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', requireRole('Admin', 'User'), asyncHandler(async (req, res) => {
  const { page, limit, offset, sort, search } = parseListQuery(req.query);
  const sortDirection = sort === 'asc' ? asc(purchases.purchase_id) : desc(purchases.purchase_id);
  const whereClause = search
    ? sql`(${purchases.purchase_id}::text ILIKE ${`%${search}%`} OR ${purchases.product_id}::text ILIKE ${`%${search}%`})`
    : undefined;

  console.info('[DEBUG_PAGINATION]', {
    route: 'purchases.list',
    query: req.query,
    parsed: { page, limit, offset, sort, search },
  });

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        purchase_id: purchases.purchase_id,
        product_id: purchases.product_id,
        quantity: purchases.quantity,
        purchase_date: purchases.purchase_date,
      })
      .from(purchases)
      .where(whereClause)
      .orderBy(sortDirection)
      .limit(limit)
      .offset(offset),
    db.select({ count: sql`count(*)::int` }).from(purchases).where(whereClause),
  ]);

  res.json(buildPaginatedResponse({
    data: rows,
    total: Number(totalRows[0]?.count || 0),
    page,
    limit,
  }));
}));

router.post('/', requireAdmin, validate(purchasePayloadSchema), asyncHandler(async (req, res) => {
  const { product_id, quantity } = req.body;

  const result = await db.transaction(async (tx) => {
    const targetProductQuery = await tx.select().from(products).where(eq(products.product_id, product_id)).limit(1);
    if (!targetProductQuery.length) {
      throw new AppError(404, 'Product not found.');
    }

    const product = targetProductQuery[0];
    await tx.update(products)
      .set({ quantity: Number(product.quantity) + Number(quantity) })
      .where(eq(products.product_id, product_id));

    const [newPurchase] = await tx.insert(purchases).values({
      product_id,
      quantity,
    }).returning();

    return newPurchase;
  });

  res.status(201).json(result);
}));

router.delete('/:id', requireAdmin, validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  const purchaseId = Number(req.params.id);

  await db.transaction(async (tx) => {
    const existingPurchase = await tx
      .select()
      .from(purchases)
      .where(eq(purchases.purchase_id, purchaseId))
      .limit(1);

    if (!existingPurchase.length) {
      throw new AppError(404, 'Purchase not found.');
    }

    const purchase = existingPurchase[0];
    const targetProductQuery = await tx
      .select()
      .from(products)
      .where(eq(products.product_id, purchase.product_id))
      .limit(1);

    if (!targetProductQuery.length) {
      throw new AppError(404, 'Product not found.');
    }

    const product = targetProductQuery[0];
    const nextQuantity = Number(product.quantity) - Number(purchase.quantity);
    if (nextQuantity < 0) {
      throw new AppError(409, 'Purchase deletion would result in negative stock.');
    }

    await tx
      .update(products)
      .set({ quantity: nextQuantity })
      .where(eq(products.product_id, purchase.product_id));

    await tx.delete(purchases).where(eq(purchases.purchase_id, purchaseId));
  });

  res.json({ success: true });
}));

export default router;
