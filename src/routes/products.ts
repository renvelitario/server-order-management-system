import express from 'express';
import { db } from '../db/db.js';
import { products, orderItems } from '../db/schema.js';
import { asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, requireRole } from '../middleware/rbac.js';
import { asyncHandler, AppError } from '../utils/errors.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import { productPayloadSchema } from '../validators/entity.js';
import { buildPaginatedResponse, logPaginationDebug, parseListQuery } from '../utils/pagination.js';

const router = express.Router();
router.use(requireAuth);

const normalizeSku = (value: unknown): string => String(value || '').trim().toUpperCase();

const ensureUniqueSku = async (candidateSku: string): Promise<boolean> => {
  const normalized = normalizeSku(candidateSku);
  const existing = await db
    .select({ sku: products.sku })
    .from(products)
    .where(eq(products.sku, normalized))
    .limit(1);

  return existing.length === 0;
};

router.get('/', requireRole('Admin', 'User'), asyncHandler(async (req, res) => {
  const { page, limit, offset, sort, search } = parseListQuery(req.query);
  const sortDirection = sort === 'asc' ? asc(products.sku) : desc(products.sku);
  const whereClause = search
    ? or(ilike(products.product_name, `%${search}%`), ilike(products.sku, `%${search}%`))
    : undefined;

  logPaginationDebug({
    route: 'products.list',
    query: req.query,
    parsed: { page, limit, offset, sort, search },
  });

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        product_id: products.product_id,
        sku: products.sku,
        product_name: products.product_name,
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
  const payload = req.body as {
    sku?: string;
    product_name: string;
    price: number;
    status: string;
  };

  const normalizedSku = normalizeSku(payload.sku);

  if (normalizedSku) {
    const available = await ensureUniqueSku(normalizedSku);
    if (!available) {
      throw new AppError(409, 'SKU already exists. Please choose a different SKU.');
    }
  }

  const [newProduct] = await db.insert(products).values({
    sku: normalizedSku || null,
    product_name: payload.product_name,
    price: payload.price,
    status: payload.status,
  }).returning();

  res.status(201).json(newProduct);
}));

router.put('/:id', requireAdmin, validate(idParamSchema, 'params'), validate(productPayloadSchema), asyncHandler(async (req, res) => {
  const productId = Number(req.params.id);
  const payload = req.body as {
    sku?: string;
    product_name: string;
    price: number;
    status: string;
  };

  const existingRows = await db
    .select({ product_id: products.product_id, sku: products.sku })
    .from(products)
    .where(eq(products.product_id, productId))
    .limit(1);

  if (!existingRows.length) {
    throw new AppError(404, 'Product not found.');
  }

  const normalizedSku = normalizeSku(payload.sku);

  if (normalizedSku && normalizedSku !== (existingRows[0].sku || '')) {
    const available = await ensureUniqueSku(normalizedSku);
    if (!available) {
      throw new AppError(409, 'SKU already exists. Please choose a different SKU.');
    }
  }

  const [updatedProduct] = await db.update(products).set({
    sku: normalizedSku || null,
    product_name: payload.product_name,
    price: payload.price,
    status: payload.status,
  }).where(eq(products.product_id, productId)).returning();

  res.json(updatedProduct);
}));

router.delete('/:id', requireAdmin, validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  const productId = Number(req.params.id);

  const productRows = await db
    .select({ product_id: products.product_id })
    .from(products)
    .where(eq(products.product_id, productId))
    .limit(1);

  if (!productRows.length) {
    throw new AppError(404, 'Product not found.');
  }

  const inOrderItems = await db
    .select({ order_item_id: orderItems.order_item_id })
    .from(orderItems)
    .where(eq(orderItems.product_id, productRows[0].product_id))
    .limit(1);

  if (inOrderItems.length) {
    throw new AppError(409, 'This record cannot be deleted because it is used in other records.');
  }

  await db.delete(products).where(eq(products.product_id, productId));
  res.json({ success: true });
}));

export default router;
